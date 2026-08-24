/**
 * Timedtext parsing and flattening.
 *
 * Deliberately regex-based rather than DOMParser-based: Chrome's MV3 background
 * is a service worker, which has no DOMParser. Firefox's event page does, but
 * one parser that works in both is worth more than the elegance.
 *
 * Two wire formats show up:
 *   json3 — {"events":[{"tStartMs":N,"segs":[{"utf8":"..."}]}]}
 *   XML   — <timedtext format="3"><body><p t="N" d="N"><s>word</s>...</p>
 *
 * The XML form for auto-generated captions interleaves "rolling" duplicate
 * lines marked a="1" — the half-line repeats that make live captions scroll.
 * Keeping them roughly doubles the transcript and reads like a stutter, so
 * they are dropped.
 */

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&apos;': "'", '&#39;': "'", '&nbsp;': ' ',
};

function decodeEntities(s) {
  return s
    .replace(/&(?:amp|lt|gt|quot|apos|#39|nbsp);/g, (m) => ENTITIES[m])
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

/** Parse either format into [{ t: seconds, text }]. */
export function parseTimedText(body) {
  const trimmed = body.trimStart();
  return trimmed.startsWith('{') ? parseJson3(trimmed) : parseXml(body);
}

function parseJson3(body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return [];
  }
  const cues = [];
  for (const ev of data.events || []) {
    const text = (ev.segs || [])
      .map((s) => s.utf8 || '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || text === '\n') continue;
    cues.push({ t: Math.round((ev.tStartMs || 0) / 1000), text });
  }
  return cues;
}

function parseXml(body) {
  const cues = [];
  const pRe = /<p\b([^>]*?)(?:\/>|>([\s\S]*?)<\/p>)/g;
  const sRe = /<s\b[^>]*>([\s\S]*?)<\/s>/g;
  let m;

  while ((m = pRe.exec(body)) !== null) {
    const attrs = m[1] || '';
    const inner = m[2] || '';

    // a="1" marks the rolling-caption duplicate of the previous line.
    if (/\ba="1"/.test(attrs)) continue;

    let raw;
    if (inner.includes('<s')) {
      const parts = [];
      let s;
      sRe.lastIndex = 0;
      while ((s = sRe.exec(inner)) !== null) parts.push(s[1]);
      raw = parts.join('');
    } else {
      raw = inner.replace(/<[^>]+>/g, '');
    }

    const text = decodeEntities(raw).replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const t = Number((attrs.match(/\bt="(\d+)"/) || [])[1] || 0);
    cues.push({ t: Math.round(t / 1000), text });
  }
  return cues;
}

export function formatTimestamp(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

/**
 * Flatten cues into timestamped paragraphs.
 *
 * The model needs timestamps to produce useful "jump to" points, but a marker
 * on every cue is mostly noise and burns tokens. One marker per `bucketSec`
 * of video is enough to locate a moment within a few seconds.
 */
export function flatten(cues, bucketSec = 30) {
  if (!cues.length) return '';
  const lines = [];
  let bucketStart = null;
  let words = [];

  const flush = () => {
    if (!words.length) return;
    lines.push(`[${formatTimestamp(bucketStart)}] ${words.join(' ')}`);
    words = [];
  };

  for (const cue of cues) {
    if (bucketStart === null || cue.t - bucketStart >= bucketSec) {
      flush();
      bucketStart = cue.t;
    }
    words.push(cue.text);
  }
  flush();
  return lines.join('\n');
}

/**
 * Keep a very long transcript inside a token budget without losing the ending.
 *
 * Truncating the tail is the obvious move and the wrong one: the payoff of a
 * clickbait video is usually held back until the last few minutes, and that
 * payoff is the single thing this extension exists to extract. So instead we
 * drop evenly-spaced cues, thinning the whole transcript uniformly and keeping
 * coverage from first minute to last.
 */
export function condense(cues, maxChars) {
  const total = cues.reduce((n, c) => n + c.text.length + 1, 0);
  if (total <= maxChars) return { cues, thinned: false };

  const keepRatio = maxChars / total;
  const kept = cues.filter((_, i) => (i * keepRatio) % 1 < keepRatio);
  return { cues: kept.length ? kept : cues.slice(0, 200), thinned: true };
}
