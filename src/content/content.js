/**
 * Content script. Plain IIFE — content scripts are not ES modules.
 *
 * Two surfaces: a badge over any hovered thumbnail, and a panel on the watch
 * page. All of our UI lives in a shadow root, because YouTube restyles the
 * page aggressively and ships its own .badge / .title / .chip classes.
 *
 * The badge is ONE floating element that follows the pointer between
 * thumbnails, rather than a button injected into each one. That is a
 * correctness fix, not a style choice: YouTube virtualises its grids and swaps
 * a preview player into the tile you are hovering, so anything appended to a
 * thumbnail gets torn out from under you (the badge visibly blinking), and a
 * recycled tile keeps the previous video's id. Owning a single element outside
 * YouTube's tree sidesteps both, and stops our own writes from retriggering
 * the MutationObserver.
 */
(() => {
  'use strict';

  const api = globalThis.browser ?? globalThis.chrome;

  const CLOCK = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M12 7v5.2l3.2 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;

  const VERDICT_TEXT = { watch: 'WORTH IT', skim: 'SKIM IT', skip: 'SKIP IT', unclear: 'UNCLEAR' };

  const CSS = `
    :host, * { box-sizing: border-box; }

    /* ---- floating badge ---- */
    .fbadge {
      position: fixed; z-index: 2147483646;
      display: inline-flex; align-items: center; gap: 5px;
      padding: 4px 9px; border: 0; border-radius: 999px;
      background: rgba(0,0,0,.84); color: #fff;
      font: 600 11px/1 Roboto, "Segoe UI", system-ui, sans-serif;
      white-space: nowrap; cursor: pointer;
      opacity: 0; transition: opacity .1s ease, background .1s ease;
    }
    .fbadge[data-show="1"] { opacity: 1; }
    .fbadge:hover { background: #065fd4; }
    .fbadge svg { flex: none; }

    /* ---- popover / panel ---- */
    .pop {
      position: fixed; z-index: 2147483647;
      font: 400 13px/1.5 Roboto, "Segoe UI", system-ui, sans-serif;
      overflow-y: auto; animation: in .12s ease-out;
    }
    @keyframes in { from { opacity: 0; transform: translateY(-4px); } }

    .card {
      background: var(--bg, #fff); color: var(--fg, #0f0f0f);
      border: 1px solid var(--line, #0000001f);
      border-radius: 12px; padding: 14px; box-shadow: 0 8px 28px #00000026;
    }
    .panel { margin: 8px 0 12px; font: 400 13px/1.5 Roboto, "Segoe UI", system-ui, sans-serif; }
    .panel .card { box-shadow: none; }

    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .pill { font-size: 11px; font-weight: 700; letter-spacing: .06em;
            padding: 3px 8px; border-radius: 999px; color: #fff; white-space: nowrap; }
    .v-watch{background:#1a7f37}.v-skim{background:#9a6700}
    .v-skip{background:#b42318}.v-unclear{background:#57606a}
    .saved { font-weight: 600; font-size: 12px; opacity: .75; }
    .x { margin-left: auto; background: none; border: 0; cursor: pointer;
         font-size: 20px; line-height: 1; color: inherit; opacity: .45; padding: 0 2px; }
    .x:hover { opacity: 1; }

    .answer { margin: 0 0 8px; font-size: 15px; font-weight: 600; line-height: 1.42; }
    .why { margin: 0 0 10px; font-size: 12.5px; opacity: .72; }

    .bait { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline;
            font-size: 12px; padding: 7px 9px; border-radius: 8px; margin-bottom: 10px;
            background: #fff4e5; color: #7a4100; }
    .bait.b-4, .bait.b-5 { background: #fdecec; color: #8c1d18; }
    .baitlabel { font-weight: 700; white-space: nowrap; }

    .take { margin: 0 0 10px; padding-left: 18px; }
    .take li { margin: 0 0 5px; }

    .jumps { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .jump { font-size: 12px; text-decoration: none; color: inherit;
            border: 1px solid var(--line, #0000001f); border-radius: 999px;
            padding: 3px 9px; background: var(--soft, #f5f5f5); }
    .jump:hover { border-color: currentColor; }
    .jump b { color: #065fd4; margin-right: 4px; }

    .whofor { margin: 0 0 10px; font-size: 12.5px; opacity: .75; font-style: italic; }
    .foot { display: flex; align-items: center; gap: 10px;
            border-top: 1px solid var(--line, #0000001f); padding-top: 8px; }
    .muted { font-size: 11px; opacity: .55; }
    .link { margin-left: auto; background: none; border: 0; cursor: pointer;
            color: #065fd4; font-size: 12px; padding: 0; }
    .link:hover { text-decoration: underline; }
    .verr { color: #b42318; margin-bottom: 8px; }
    .btn { background: #065fd4; color: #fff; border: 0; border-radius: 999px;
           padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .btn:hover { filter: brightness(1.08); }
    .row { display: flex; align-items: center; gap: 8px; }
    .cta .row { margin-bottom: 10px; }
    .logo { display: inline-flex; opacity: .7; }

    /* ---- progress ---- */
    .track { height: 4px; border-radius: 999px; overflow: hidden;
             background: var(--soft, #eee); margin-bottom: 9px; }
    .bar { display: block; height: 100%; width: 4%; border-radius: 999px;
           background: linear-gradient(90deg, #065fd4, #4f9dff);
           transition: width .45s cubic-bezier(.4,0,.2,1); }
    .bar.done { background: #1a7f37; }
    .phase { font-size: 12.5px; opacity: .75; }
    .vtitle { margin-top: 6px; font-size: 11.5px; opacity: .5;
              overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    @media (prefers-color-scheme: dark) {
      .card { --bg:#212121; --fg:#f1f1f1; --line:#ffffff26; --soft:#ffffff14; }
      .jump b, .link { color: #3ea6ff; }
      .bait { background:#3d2f14; color:#f5c37b; }
      .bait.b-4, .bait.b-5 { background:#40201e; color:#f5a9a3; }
      .verr { color:#f5a9a3; }
      .track { background:#ffffff1f; }
    }
  `;

  // ------------------------------------------------------------- utilities

  function videoIdFromHref(href) {
    if (!href) return null;
    try {
      const u = new URL(href, location.origin);
      const v = u.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/);
      if (m) return m[1];
    } catch { /* relative junk */ }
    return null;
  }

  const send = (msg) =>
    new Promise((resolve) => {
      try {
        api.runtime.sendMessage(msg, (r) =>
          resolve(r || { ok: false, error: 'Extension background did not respond.' })
        );
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });

  /** Summarise over a port so phase updates arrive while it runs. */
  function summariseWithProgress(videoId, { force = false, onProgress } = {}) {
    return new Promise((resolve) => {
      let port;
      try {
        port = api.runtime.connect({ name: 'sy20' });
      } catch (e) {
        resolve({ ok: false, error: e.message });
        return;
      }
      let settled = false;
      port.onMessage.addListener((msg) => {
        if (msg?.type === 'progress') onProgress?.(msg);
        else if (msg?.type === 'done') {
          settled = true;
          resolve(msg);
          try { port.disconnect(); } catch { /* already gone */ }
        }
      });
      port.onDisconnect.addListener(() => {
        if (!settled) resolve({ ok: false, error: 'The background script stopped unexpectedly.' });
      });
      port.postMessage({ type: 'summarise', videoId, force });
    });
  }

  function fmtTime(sec) {
    const s = Math.max(0, Math.round(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }

  function savedLine(d) {
    const mins = Math.round((d.durationSec || 0) / 60);
    if (!mins) return '';
    if (d.verdict === 'skip') return `Saved you ${mins} min`;
    if (d.verdict === 'skim') return `Saved you ~${Math.max(1, Math.round(mins * 0.7))} min`;
    if (d.verdict === 'watch') return `Worth the ${mins} min`;
    return '';
  }

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

  // ------------------------------------------------------------ shadow root

  const host = document.createElement('div');
  host.id = 'sy20-host';
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
  document.documentElement.appendChild(host);

  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style>
    <button class="fbadge" type="button" hidden>${CLOCK}<span>Worth it?</span></button>
    <div class="pop" hidden></div>`;

  const badgeEl = root.querySelector('.fbadge');
  const popEl = root.querySelector('.pop');

  // ------------------------------------------------------- floating badge

  let hoverAnchor = null;   // the thumbnail <a> under the pointer
  let hoverId = null;
  let hideTimer = null;
  let rafPending = false;

  /** A thumbnail link, or null. Title links and chips are not thumbnails. */
  function thumbTargetFrom(el) {
    const a = el?.closest?.('a[href]');
    if (!a) return null;
    const id = videoIdFromHref(a.getAttribute('href'));
    if (!id) return null;
    if (!a.querySelector('img, yt-image')) return null;
    return { anchor: a, id };
  }

  function placeBadge() {
    rafPending = false;
    if (!hoverAnchor || !hoverAnchor.isConnected) return hideBadge(true);
    const r = hoverAnchor.getBoundingClientRect();
    // Scrolled out of view, or collapsed by a re-render.
    if (r.width < 60 || r.height < 40 || r.bottom < 0 || r.top > window.innerHeight) {
      return hideBadge(true);
    }
    badgeEl.style.left = `${Math.round(r.left + 6)}px`;
    badgeEl.style.top = `${Math.round(r.bottom - 28)}px`;
  }

  function schedulePlace() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(placeBadge);
  }

  function showBadgeOver(anchor, id) {
    clearTimeout(hideTimer);
    hoverAnchor = anchor;
    hoverId = id;
    badgeEl.hidden = false;
    badgeEl.dataset.show = '1';
    placeBadge();
  }

  function hideBadge(now = false) {
    clearTimeout(hideTimer);
    const doIt = () => {
      badgeEl.dataset.show = '0';
      badgeEl.hidden = true;
      hoverAnchor = null;
      hoverId = null;
    };
    // A short grace period so crossing the gap onto the badge doesn't drop it.
    if (now) doIt();
    else hideTimer = setTimeout(doIt, 140);
  }

  document.addEventListener('mouseover', (e) => {
    if (e.target === host) { clearTimeout(hideTimer); return; }  // on our own badge
    const t = thumbTargetFrom(e.target);
    if (t) {
      if (t.anchor !== hoverAnchor || t.id !== hoverId) showBadgeOver(t.anchor, t.id);
      else clearTimeout(hideTimer);
    } else {
      hideBadge();
    }
  }, { passive: true });

  window.addEventListener('scroll', schedulePlace, { passive: true, capture: true });
  window.addEventListener('resize', schedulePlace, { passive: true });

  badgeEl.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const id = hoverId;
    const anchor = hoverAnchor;
    if (!id) return;
    await runSummary(id, {
      show: (html) => showPopover(anchor || badgeEl, html),
      scope: () => popEl,
      onDone: (data) => anchor && markCached(anchor, data),
    });
  });

  // ---------------------------------------------------------- progress UI

  const PHASES = {
    video: { pct: 16, text: () => 'Looking up the video…' },
    captions: { pct: 40, text: () => 'Downloading the transcript…' },
    reading: {
      pct: 62,
      text: (p) => `Reading ${p.minutes} min of transcript…`,
    },
  };

  function renderProgress(text = 'Starting…') {
    return `<div class="card">
      <div class="track"><span class="bar"></span></div>
      <div class="phase">${esc(text)}</div>
    </div>`;
  }

  /**
   * Drives the bar. The first three phases are real events from the
   * background; the model call has no progress to report, so the bar creeps
   * toward 92% and waits there rather than pretending to be finished.
   */
  function makeProgress(scopeFn) {
    let creep = null;
    let pct = 4;

    const paint = (text) => {
      const scope = scopeFn();
      const bar = scope?.querySelector('.bar');
      const phase = scope?.querySelector('.phase');
      if (bar) bar.style.width = `${pct}%`;
      if (phase && text) phase.textContent = text;
    };

    return {
      update(p) {
        const spec = PHASES[p.phase];
        if (!spec) return;
        clearInterval(creep);
        pct = spec.pct;
        paint(spec.text(p));
        if (p.phase === 'reading') {
          creep = setInterval(() => {
            pct = Math.min(92, pct + 1.6);
            paint();
          }, 700);
        }
      },
      finish() {
        clearInterval(creep);
        pct = 100;
        const bar = scopeFn()?.querySelector('.bar');
        if (bar) { bar.style.width = '100%'; bar.classList.add('done'); }
      },
      stop() { clearInterval(creep); },
    };
  }

  /** Shared flow for the badge popover, the watch panel and Re-run. */
  async function runSummary(videoId, { show, scope, onDone, force = false }) {
    show(renderProgress());
    const prog = makeProgress(scope);
    const r = await summariseWithProgress(videoId, { force, onProgress: (p) => prog.update(p) });
    prog.stop();

    if (r.ok) {
      // Let the filled bar register before it's replaced.
      prog.finish();
      await new Promise((res) => setTimeout(res, 160));
      show(renderResult(r.data, { onWatchPage: location.pathname === '/watch' }));
      onDone?.(r.data);
    } else {
      show(renderError(r.error, r.needsKey));
    }
    return r;
  }

  // ------------------------------------------------------------- rendering

  function renderError(error, needsKey) {
    return `<div class="card">
      <div class="verr">${esc(error)}</div>
      ${needsKey ? '<button class="btn" data-act="options">Open settings</button>' : ''}
    </div>`;
  }

  function renderResult(d, { onWatchPage }) {
    const saved = savedLine(d);
    const bait = Number(d.bait) || 0;
    const jumps = (d.jump_to || [])
      .map(
        (j) =>
          `<a class="jump" href="/watch?v=${encodeURIComponent(d.videoId)}&t=${j.t | 0}" data-t="${j.t | 0}">
             <b>${fmtTime(j.t)}</b> ${esc(j.label)}
           </a>`
      )
      .join('');

    return `<div class="card">
      <div class="head">
        <span class="pill v-${esc(d.verdict)}">${VERDICT_TEXT[d.verdict] || 'VERDICT'}</span>
        ${saved ? `<span class="saved">${esc(saved)}</span>` : ''}
        <button class="x" data-act="close" title="Close">&times;</button>
      </div>
      <p class="answer">${esc(d.answer)}</p>
      ${d.verdict_line ? `<p class="why">${esc(d.verdict_line)}</p>` : ''}
      ${bait >= 3 ? `<div class="bait b-${bait}">
          <span class="baitlabel">Clickbait ${bait}/5</span>
          ${d.bait_note ? `<span>${esc(d.bait_note)}</span>` : ''}
        </div>` : ''}
      ${(d.takeaways || []).length
        ? `<ul class="take">${d.takeaways.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
        : ''}
      ${jumps ? `<div class="jumps">${jumps}</div>` : ''}
      ${d.who_for ? `<p class="whofor">${esc(d.who_for)}</p>` : ''}
      <div class="foot">
        <span class="muted">${esc(d.model || '')}${d.autoCaptions ? ' · auto-captions' : ''}${d.thinned ? ' · long video, sampled' : ''}</span>
        <button class="link" data-act="redo" data-id="${esc(d.videoId)}" data-watch="${onWatchPage ? '1' : ''}">Re-run</button>
      </div>
    </div>`;
  }

  function wire(scope) {
    scope.querySelectorAll('[data-act="close"]').forEach((b) =>
      b.addEventListener('click', closePopover)
    );
    scope.querySelectorAll('[data-act="options"]').forEach((b) =>
      b.addEventListener('click', () => send({ type: 'openOptions' }))
    );
    scope.querySelectorAll('[data-act="redo"]').forEach((b) =>
      b.addEventListener('click', () => {
        const onWatch = Boolean(b.dataset.watch);
        runSummary(b.dataset.id, {
          force: true,
          show: (html) => (onWatch ? renderPanel(html) : showPopover(popAnchor || badgeEl, html)),
          scope: () => (onWatch ? panelScope() : popEl),
        });
      })
    );
    scope.querySelectorAll('.jump').forEach((a) =>
      a.addEventListener('click', (e) => {
        const video = document.querySelector('video.html5-main-video, #movie_player video');
        if (video && location.pathname === '/watch') {
          e.preventDefault();
          video.currentTime = Number(a.dataset.t) || 0;
          video.play?.();
          closePopover();
        }
      })
    );
  }

  // -------------------------------------------------------------- popover

  let popAnchor = null;

  function positionPop() {
    if (popEl.hidden || !popAnchor) return;
    const r = popAnchor.getBoundingClientRect();
    const w = 400;
    const margin = 12;
    popEl.style.width = `${w}px`;
    popEl.style.left = `${Math.min(Math.max(margin, r.left), window.innerWidth - w - margin)}px`;
    const below = window.innerHeight - r.bottom;
    if (below < 260 && r.top > below) {
      popEl.style.top = 'auto';
      popEl.style.bottom = `${window.innerHeight - r.top + 8}px`;
      popEl.style.maxHeight = `${r.top - margin - 8}px`;
    } else {
      popEl.style.bottom = 'auto';
      popEl.style.top = `${r.bottom + 8}px`;
      popEl.style.maxHeight = `${below - margin - 8}px`;
    }
  }

  function showPopover(anchor, html) {
    popAnchor = anchor;
    popEl.innerHTML = html;
    popEl.hidden = false;
    positionPop();
    wire(popEl);
  }

  function closePopover() {
    popEl.hidden = true;
    popEl.innerHTML = '';
    popAnchor = null;
  }

  document.addEventListener('click', (e) => {
    if (popEl.hidden) return;
    if (!e.composedPath().includes(host)) closePopover();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopover();
  });
  window.addEventListener('scroll', positionPop, { passive: true, capture: true });
  window.addEventListener('resize', positionPop, { passive: true });

  // ----------------------------------------------------------- MAIN relay

  const PLAYER_REQ = 'sy20:player:req';
  const PLAYER_RES = 'sy20:player:res';
  const pending = new Map();
  let seq = 0;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.type !== PLAYER_RES) return;
    const settle = pending.get(msg.id);
    if (!settle) return;
    pending.delete(msg.id);
    settle(msg);
  });

  function playerViaPage(videoId) {
    return new Promise((resolve) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: 'Timed out reading the video from the page.' });
      }, 20000);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve({ ok: msg.ok, data: msg.data, error: msg.error });
      });
      window.postMessage({ type: PLAYER_REQ, id, videoId }, location.origin);
    });
  }

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'ytPlayer') return false;
    playerViaPage(msg.videoId).then(sendResponse);
    return true;
  });

  // ----------------------------------------------------- cached-verdict chips

  function markCached(anchor, data) {
    const existing = anchor.querySelector('.sy20-chip');
    if (existing && existing.dataset.sy20Id === data.videoId) return;
    existing?.remove();
    const chip = document.createElement('span');
    chip.className = `sy20-chip sy20-v-${data.verdict}`;
    chip.dataset.sy20Id = data.videoId;   // so a recycled tile can be detected
    chip.textContent = VERDICT_TEXT[data.verdict] || '';
    anchor.appendChild(chip);
  }

  let sweepTimer = null;
  const scheduleSweep = () => {
    clearTimeout(sweepTimer);
    sweepTimer = setTimeout(sweep, 600);
  };

  async function sweep() {
    const byAnchor = new Map();
    for (const a of document.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"]')) {
      if (!a.querySelector('img, yt-image')) continue;
      const id = videoIdFromHref(a.getAttribute('href'));
      if (!id) continue;
      // YouTube recycles tiles: a chip left from the previous occupant is a lie.
      const chip = a.querySelector('.sy20-chip');
      if (chip) {
        if (chip.dataset.sy20Id === id) continue;
        chip.remove();
      }
      byAnchor.set(a, id);
    }
    if (!byAnchor.size) return;

    const ids = [...new Set(byAnchor.values())].slice(0, 120);
    const r = await send({ type: 'peek', videoIds: ids });
    if (!r.ok) return;
    for (const [a, id] of byAnchor) {
      if (r.data[id] && a.isConnected) markCached(a, r.data[id]);
    }
  }

  // ------------------------------------------------------------ watch page

  const panelScope = () => document.getElementById('sy20-panel')?.shadowRoot?.querySelector('.panel');

  function renderPanel(html) {
    let panel = document.getElementById('sy20-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'sy20-panel';
      const shadow = panel.attachShadow({ mode: 'open' });
      shadow.innerHTML = `<style>${CSS}</style><div class="panel"></div>`;
      const metadata = document.querySelector('ytd-watch-metadata');
      const bottomRow = metadata?.querySelector('#bottom-row');
      if (bottomRow) bottomRow.parentElement.insertBefore(panel, bottomRow);
      else document.querySelector('#secondary-inner')?.prepend(panel);
      if (!panel.isConnected) return null;
    }
    const box = panel.shadowRoot.querySelector('.panel');
    box.innerHTML = html;
    wire(box);
    return panel;
  }

  function watchPrompt(id) {
    return `<div class="card cta">
      <div class="row"><span class="logo">${CLOCK}</span><b>Saved You 20 Minutes</b></div>
      <button class="btn" data-act="run" data-id="${esc(id)}">Is this worth watching?</button>
    </div>`;
  }

  async function setupWatchPage() {
    if (location.pathname !== '/watch') {
      document.getElementById('sy20-panel')?.remove();
      return;
    }
    const id = videoIdFromHref(location.href);
    if (!id) return;

    const cached = await send({ type: 'peek', videoIds: [id], always: true });
    const hit = cached.ok && cached.data[id];
    const panel = renderPanel(hit ? renderResult(hit, { onWatchPage: true }) : watchPrompt(id));
    if (!panel) return;

    panel.shadowRoot.querySelectorAll('[data-act="run"]').forEach((b) =>
      b.addEventListener('click', () =>
        runSummary(b.dataset.id, { show: renderPanel, scope: panelScope })
      )
    );
  }

  // --------------------------------------------------------------- startup

  let lastHref = location.href;

  function onNavigate() {
    closePopover();
    hideBadge(true);
    document.getElementById('sy20-panel')?.remove();
    setupWatchPage();
    scheduleSweep();
  }

  window.addEventListener('yt-navigate-finish', onNavigate);

  new MutationObserver((records) => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      onNavigate();
      return;
    }
    // Ignore our own chips, or the sweep re-triggers itself forever.
    const relevant = records.some((r) =>
      [...r.addedNodes].some((n) => n.nodeType === 1 && !n.classList?.contains('sy20-chip'))
    );
    if (relevant) scheduleSweep();
  }).observe(document.body, { childList: true, subtree: true });

  setupWatchPage();
  scheduleSweep();
})();
