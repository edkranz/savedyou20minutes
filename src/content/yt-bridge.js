/**
 * MAIN-world bridge. Runs in the page's own JS context, not the extension's.
 *
 * Why this file exists: YouTube's /youtubei/v1/player endpoint returns 403 to
 * any request carrying a non-YouTube `Origin` header, and browsers attach
 * `Origin: moz-extension://…` (or `chrome-extension://…`) to POSTs made from
 * the background script. No header can override it — X-Origin, Referer and the
 * googleapis.com host were all tested and all 403. The only fix is to make the
 * request from a context whose origin really is youtube.com, which is what the
 * MAIN world gives us.
 *
 * Only this one call needs it. The caption download itself is happy with any
 * origin, so it stays in the background script.
 *
 * Nothing sensitive passes through here: this fetches public video metadata,
 * and the API key never leaves the background script.
 */
(() => {
  'use strict';

  const REQ = 'sy20:player:req';
  const RES = 'sy20:player:res';

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.type !== REQ || typeof msg.videoId !== 'string') return;

    const reply = (payload) =>
      window.postMessage({ type: RES, id: msg.id, ...payload }, location.origin);

    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-YouTube-Client-Name': '3',
          'X-YouTube-Client-Version': '20.10.38',
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'ANDROID',
              clientVersion: '20.10.38',
              androidSdkVersion: 30,
              hl: 'en',
              gl: 'US',
            },
          },
          videoId: msg.videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });

      if (!res.ok) throw new Error(`YouTube returned HTTP ${res.status} for this video.`);
      const data = await res.json();

      // Send back only what the background needs. The full player response is
      // hundreds of KB and would cross two message boundaries for nothing.
      reply({
        ok: true,
        data: {
          playabilityStatus: data.playabilityStatus,
          videoDetails: data.videoDetails,
          captions: data.captions,
        },
      });
    } catch (e) {
      reply({ ok: false, error: e.message });
    }
  });
})();
