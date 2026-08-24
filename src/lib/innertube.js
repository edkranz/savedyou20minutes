/**
 * YouTube transcript retrieval — caption track selection and download.
 *
 * The player response itself is NOT fetched here. YouTube returns 403 to any
 * request to /youtubei/v1/player carrying a non-YouTube `Origin` header, and
 * browsers attach `Origin: moz-extension://…` to every POST a background
 * script makes. X-Origin, Referer and the googleapis.com host were all tried
 * and all 403. So that one call is delegated to `content/yt-bridge.js`, which
 * runs in the page's MAIN world where the origin is genuinely youtube.com.
 *
 * The caption download below is a different story: it is happy with any origin
 * (verified), so it stays here in the background script.
 *
 * The ANDROID InnerTube client is used rather than WEB because, as of 2025, the
 * caption baseUrls the WEB client hands out return an empty 200 response. The
 * ANDROID ones fetch normally with no cookies and no PO token.
 */

/** Pull an 11-character video id out of any YouTube URL shape. */
export function videoIdFrom(url) {
  if (!url) return null;
  try {
    const u = new URL(url, 'https://www.youtube.com');
    const v = u.searchParams.get('v');
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
    if (m) return m[1];
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.slice(1, 12);
      if (/^[\w-]{11}$/.test(id)) return id;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

/** Metadata we can show even when there is no transcript. */
export function metaFrom(player) {
  const d = player?.videoDetails || {};
  return {
    title: d.title || '',
    channel: d.author || '',
    durationSec: Number(d.lengthSeconds) || 0,
    isLive: Boolean(d.isLiveContent && !d.lengthSeconds),
  };
}

/**
 * Choose the best caption track: a human-written English track beats an
 * auto-generated English one, which beats a human-written track in any
 * language, which beats anything at all.
 */
export function pickTrack(player, preferredLang = 'en') {
  const tracks =
    player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!tracks.length) return null;

  const isPreferred = (t) => (t.languageCode || '').startsWith(preferredLang);
  const isManual = (t) => t.kind !== 'asr';

  return (
    tracks.find((t) => isPreferred(t) && isManual(t)) ||
    tracks.find((t) => isPreferred(t)) ||
    tracks.find(isManual) ||
    tracks[0]
  );
}

/** Fetch the raw timedtext body for a chosen track. */
export async function fetchTrackBody(track) {
  const res = await fetch(track.baseUrl, { credentials: 'omit' });
  if (!res.ok) throw new Error(`Caption fetch failed (HTTP ${res.status}).`);
  const body = await res.text();
  if (!body.trim()) {
    throw new Error('YouTube returned an empty caption file for this video.');
  }
  return body;
}
