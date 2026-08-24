/**
 * YouTube transcript retrieval.
 *
 * Why the ANDROID InnerTube client and not the watch page:
 * As of 2025 the caption `baseUrl`s embedded in the WEB watch page (and returned
 * by the WEB InnerTube client) are signed in a way that makes them return an
 * EMPTY 200 response. The ANDROID client still hands back caption URLs that
 * fetch normally, with no cookies, no PO token, and no custom User-Agent —
 * which matters, because `fetch()` in an extension is not allowed to set
 * User-Agent anyway.
 *
 * The same call also returns videoDetails (title, author, lengthSeconds), so
 * one request gets us both the metadata and the caption track list.
 *
 * No `key` query parameter: the endpoint accepts the request without one
 * (verified — identical response either way). Every copy of this call you
 * will find online passes YouTube's public INNERTUBE_API_KEY, which is
 * served in the HTML of every youtube.com page. It is not a credential, but
 * it is shaped exactly like a Google Cloud key, so it trips secret scanners
 * and alarms anyone reading the diff. Since it buys nothing, it is omitted.
 */

const INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/player';

const ANDROID_CLIENT = {
  clientName: 'ANDROID',
  clientVersion: '20.10.38',
  androidSdkVersion: 30,
  hl: 'en',
  gl: 'US',
};

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

/** Fetch the player response for a video. Throws a human-readable Error. */
export async function fetchPlayer(videoId) {
  let res;
  try {
    res = await fetch(INNERTUBE_URL, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': '3',
        'X-YouTube-Client-Version': ANDROID_CLIENT.clientVersion,
      },
      body: JSON.stringify({
        context: { client: ANDROID_CLIENT },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    });
  } catch (e) {
    throw new Error(`Could not reach YouTube (${e.message}).`);
  }

  if (!res.ok) throw new Error(`YouTube returned HTTP ${res.status} for this video.`);

  const data = await res.json();
  const status = data?.playabilityStatus?.status;
  if (status && status !== 'OK') {
    const reason = data.playabilityStatus.reason || status;
    throw new Error(`YouTube won't serve this video: ${reason}`);
  }
  return data;
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
