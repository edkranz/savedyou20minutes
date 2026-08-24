/**
 * Background orchestrator.
 *
 * Everything that needs a secret or a cross-origin request happens here: the
 * API key never enters a content script, so no page script can reach it, and
 * host_permissions let these fetches bypass the page's CORS rules.
 */
import { api } from './lib/browser.js';
import { videoIdFrom, metaFrom, pickTrack, fetchTrackBody } from './lib/innertube.js';
import { parseTimedText, flatten, condense } from './lib/transcript.js';
import { SYSTEM_PROMPT, RESULT_SCHEMA, buildUserMessage } from './lib/prompt.js';
import { PROVIDERS, activeProvider, getSettings } from './lib/settings.js';
import * as cache from './lib/cache.js';

/**
 * Ask a YouTube tab to fetch the player response on our behalf.
 *
 * YouTube 403s the /youtubei/v1/player endpoint when the request carries an
 * extension Origin, which every background-script POST does. The MAIN-world
 * bridge in the page has the right origin, so the call goes: background ->
 * content script -> page -> back. The caption download afterwards is fine from
 * here, so only this one hop is delegated.
 */
async function playerViaTab(videoId) {
  const tabs = await api.tabs.query({ url: 'https://www.youtube.com/*' });
  if (!tabs.length) {
    throw new Error('Open a YouTube tab first — the transcript has to be fetched from youtube.com.');
  }

  let lastError = 'No YouTube tab was able to fetch this video.';
  for (const tab of tabs) {
    try {
      const r = await api.tabs.sendMessage(tab.id, { type: 'ytPlayer', videoId });
      if (r?.ok && r.data) return r.data;
      if (r?.error) lastError = r.error;
    } catch {
      // That tab has no content script yet (still loading, or a stale tab).
    }
  }
  throw new Error(lastError);
}

/**
 * Clamp the model's output to the shape the UI actually renders.
 *
 * The schema carries maxItems, but OpenAI's strict json_schema mode rejects
 * array bounds outright, so they are stripped before the request — which means
 * the cap is advisory there. Enforcing it here keeps all three providers
 * rendering the same way instead of one of them quietly overflowing the card.
 */
function normalise(result) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const verdicts = ['watch', 'skim', 'skip', 'unclear'];
  const verdict = verdicts.includes(result.verdict) ? result.verdict : 'unclear';

  return {
    answer: str(result.answer),
    verdict,
    verdict_line: str(result.verdict_line),
    bait: Math.min(5, Math.max(0, Math.round(Number(result.bait) || 0))),
    // A note below 3 is the model ignoring the brief; drop it rather than show it.
    bait_note: (Number(result.bait) || 0) >= 3 ? str(result.bait_note) : '',
    takeaways: (Array.isArray(result.takeaways) ? result.takeaways : [])
      .map(str).filter(Boolean).slice(0, 5),
    jump_to: (Array.isArray(result.jump_to) ? result.jump_to : [])
      .filter((j) => j && Number.isFinite(Number(j.t)) && str(j.label))
      .map((j) => ({ t: Math.max(0, Math.round(Number(j.t))), label: str(j.label) }))
      .slice(0, 4),
    who_for: str(result.who_for),
  };
}

/** ~30k tokens of transcript. Comfortably inside every model we support. */
const MAX_TRANSCRIPT_CHARS = 120_000;

/** Requests in flight, so a double-click doesn't buy two summaries. */
const inFlight = new Map();

async function buildSummary(videoId) {
  const active = await activeProvider();
  if (!active.ok) {
    const err = new Error(active.reason);
    err.needsKey = true;
    throw err;
  }

  const player = await playerViaTab(videoId);
  const meta = metaFrom(player);

  if (meta.isLive) throw new Error('This is a live stream — no transcript to read yet.');

  const track = pickTrack(player);
  if (!track) {
    throw new Error('This video has no captions, so there is nothing to summarise.');
  }

  const body = await fetchTrackBody(track);
  const allCues = parseTimedText(body);
  if (allCues.length < 5) {
    throw new Error('The caption track is empty or unreadable.');
  }

  const { cues, thinned } = condense(allCues, MAX_TRANSCRIPT_CHARS);
  const transcript = flatten(cues);

  const provider = PROVIDERS[active.provider];
  const result = await provider.summarise({
    apiKey: active.key,
    model: active.model,
    system: SYSTEM_PROMPT,
    user: buildUserMessage({
      title: meta.title,
      channel: meta.channel,
      durationSec: meta.durationSec,
      transcript,
      thinned,
      lang: track.languageCode,
    }),
    schema: RESULT_SCHEMA,
  });

  return cache.put(videoId, {
    videoId,
    ...meta,
    ...normalise(result),
    autoCaptions: track.kind === 'asr',
    lang: track.languageCode,
    thinned,
    model: active.model,
    provider: active.provider,
  });
}

async function summarise({ videoId, url, force }) {
  const id = videoId || videoIdFrom(url);
  if (!id) return { ok: false, error: 'That does not look like a YouTube video.' };

  if (!force) {
    const hit = await cache.get(id);
    if (hit) return { ok: true, cached: true, data: hit };
  }

  if (inFlight.has(id)) return inFlight.get(id);

  const task = buildSummary(id)
    .then((data) => ({ ok: true, cached: false, data }))
    .catch((e) => ({ ok: false, error: e.message, needsKey: Boolean(e.needsKey) }))
    .finally(() => inFlight.delete(id));

  inFlight.set(id, task);
  return task;
}

/** Cheapest possible round-trip that still proves key + model + schema work. */
async function testKey() {
  const active = await activeProvider();
  if (!active.ok) return { ok: false, error: active.reason };

  const provider = PROVIDERS[active.provider];
  await provider.summarise({
    apiKey: active.key,
    model: active.model,
    system: 'You are a connectivity check. Call the tool and say ready.',
    user: 'Call the report tool with status "ready".',
    schema: {
      type: 'object',
      properties: { status: { type: 'string', description: 'Always "ready".' } },
      required: ['status'],
      additionalProperties: false,
    },
  });
  return { ok: true, data: { model: active.model } };
}

const handlers = {
  summarise,
  testKey,
  peek: async ({ videoIds, always }) => {
    // The thumbnail sweep honours the setting; the popup and watch panel ask
    // with `always` because there the user has explicitly opened something.
    if (!always) {
      const { showCachedBadges } = await getSettings();
      if (!showCachedBadges) return { ok: true, data: {} };
    }
    return { ok: true, data: await cache.getMany(videoIds || []) };
  },
  stats: async () => ({ ok: true, data: await cache.stats() }),
  clearCache: async () => ({ ok: true, data: { removed: await cache.clear() } }),
  openOptions: async () => {
    await api.runtime.openOptionsPage();
    return { ok: true };
  },
};

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler(msg)
    .catch((e) => ({ ok: false, error: e.message }))
    .then(sendResponse);
  return true; // keep the channel open for the async reply
});
