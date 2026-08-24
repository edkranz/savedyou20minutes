/**
 * Content script. Plain IIFE — content scripts are not ES modules.
 *
 * Two surfaces:
 *   1. Thumbnails anywhere on youtube.com — a badge appears on hover; clicking
 *      it opens the verdict popover. Nothing is fetched until that click, so
 *      scrolling the homepage costs nothing.
 *   2. The watch page — a panel under the title.
 *
 * All of our UI lives inside a shadow root. YouTube restyles the page
 * aggressively and ships its own `.badge`, `.title`, `.chip` classes; a shadow
 * root is the only way to be sure our styles are ours.
 */
(() => {
  'use strict';

  const api = globalThis.browser ?? globalThis.chrome;
  const BADGE_ATTR = 'data-sy20';

  // Styles for our shadow roots. Inlined (not a .css file) because a shadow
  // root cannot see the page stylesheet the manifest injects.
  const POPOVER_CSS = `
    :host, * { box-sizing: border-box; }
    .pop {
      position: fixed;
      font: 400 13px/1.5 Roboto, "Segoe UI", system-ui, sans-serif;
      overflow-y: auto;
      animation: sy20in .12s ease-out;
    }
    @keyframes sy20in { from { opacity: 0; transform: translateY(-4px); } }

    .card, .panel .card {
      background: var(--sy20-bg, #fff);
      color: var(--sy20-fg, #0f0f0f);
      border: 1px solid var(--sy20-line, #0000001f);
      border-radius: 12px;
      padding: 14px;
      box-shadow: 0 8px 28px #00000026;
    }
    .panel { margin: 8px 0 12px; font: 400 13px/1.5 Roboto, "Segoe UI", system-ui, sans-serif; }
    .panel .card { box-shadow: none; }

    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .pill {
      font-size: 11px; font-weight: 700; letter-spacing: .06em;
      padding: 3px 8px; border-radius: 999px; color: #fff; white-space: nowrap;
    }
    .v-watch   { background: #1a7f37; }
    .v-skim    { background: #9a6700; }
    .v-skip    { background: #b42318; }
    .v-unclear { background: #57606a; }

    .saved { font-weight: 600; font-size: 12px; opacity: .75; }
    .x {
      margin-left: auto; background: none; border: 0; cursor: pointer;
      font-size: 20px; line-height: 1; color: inherit; opacity: .45; padding: 0 2px;
    }
    .x:hover { opacity: 1; }

    /* The answer is the product. Everything else is supporting material. */
    .answer { margin: 0 0 8px; font-size: 15px; font-weight: 600; line-height: 1.42; }
    .why    { margin: 0 0 10px; font-size: 12.5px; opacity: .72; }

    .bait {
      display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline;
      font-size: 12px; padding: 7px 9px; border-radius: 8px; margin-bottom: 10px;
      background: #fff4e5; color: #7a4100;
    }
    .bait.b-5, .bait.b-4 { background: #fdecec; color: #8c1d18; }
    .baitlabel { font-weight: 700; white-space: nowrap; }

    .take { margin: 0 0 10px; padding-left: 18px; }
    .take li { margin: 0 0 5px; }

    .jumps { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .jump {
      font-size: 12px; text-decoration: none; color: inherit;
      border: 1px solid var(--sy20-line, #0000001f); border-radius: 999px;
      padding: 3px 9px; background: var(--sy20-soft, #f5f5f5);
    }
    .jump:hover { border-color: currentColor; }
    .jump b { color: #065fd4; margin-right: 4px; }

    .whofor { margin: 0 0 10px; font-size: 12.5px; opacity: .75; font-style: italic; }

    .foot {
      display: flex; align-items: center; gap: 10px;
      border-top: 1px solid var(--sy20-line, #0000001f); padding-top: 8px;
    }
    .muted { font-size: 11px; opacity: .55; }
    .link {
      margin-left: auto; background: none; border: 0; cursor: pointer;
      color: #065fd4; font-size: 12px; padding: 0;
    }
    .link:hover { text-decoration: underline; }

    .row { display: flex; align-items: center; gap: 8px; }
    .vtitle { margin-top: 8px; font-size: 12px; opacity: .6; }
    .verr { color: #b42318; margin-bottom: 8px; }

    .btn {
      background: #065fd4; color: #fff; border: 0; border-radius: 999px;
      padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
    }
    .btn:hover { filter: brightness(1.08); }
    .cta .row { margin-bottom: 10px; }
    .logo { display: inline-flex; opacity: .7; }

    .spinner {
      width: 14px; height: 14px; border-radius: 50%; display: inline-block;
      border: 2px solid currentColor; border-right-color: transparent;
      animation: sy20spin .7s linear infinite; opacity: .6;
    }
    @keyframes sy20spin { to { transform: rotate(360deg); } }

    @media (prefers-color-scheme: dark) {
      .card, .panel .card {
        --sy20-bg: #212121; --sy20-fg: #f1f1f1;
        --sy20-line: #ffffff26; --sy20-soft: #ffffff14;
      }
      .jump b { color: #3ea6ff; }
      .link   { color: #3ea6ff; }
      .bait   { background: #3d2f14; color: #f5c37b; }
      .bait.b-5, .bait.b-4 { background: #40201e; color: #f5a9a3; }
      .verr   { color: #f5a9a3; }
    }
  `;

  // ---------------------------------------------------------------- helpers

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

  // --- MAIN-world relay -------------------------------------------------
  // The background script cannot call YouTube's player endpoint itself (403 on
  // a non-YouTube Origin), so it asks us, and we ask yt-bridge.js, which runs
  // in the page's own context where the origin is genuinely youtube.com.
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

  function fmtTime(sec) {
    const s = Math.max(0, Math.round(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }

  /** The headline number the extension is named after. */
  function savedLine(data) {
    const mins = Math.round((data.durationSec || 0) / 60);
    if (!mins) return '';
    if (data.verdict === 'skip') return `Saved you ${mins} min`;
    if (data.verdict === 'skim') return `Saved you ~${Math.max(1, Math.round(mins * 0.7))} min`;
    if (data.verdict === 'watch') return `Worth the ${mins} min`;
    return '';
  }

  const VERDICT_TEXT = { watch: 'WORTH IT', skim: 'SKIM IT', skip: 'SKIP IT', unclear: 'UNCLEAR' };

  // ---------------------------------------------------------------- popover

  let host = null;
  let root = null;
  let openFor = null;

  function ensurePopover() {
    if (root) return root;
    host = document.createElement('div');
    host.id = 'sy20-host';
    host.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;';
    document.documentElement.appendChild(host);
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${POPOVER_CSS}</style><div class="pop" hidden></div>`;

    document.addEventListener('click', (e) => {
      if (!openFor) return;
      const path = e.composedPath();
      if (!path.includes(host) && !path.includes(openFor.anchor)) closePopover();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && openFor) closePopover();
    });
    window.addEventListener('scroll', () => openFor && position(openFor.anchor), { passive: true });
    window.addEventListener('resize', () => openFor && position(openFor.anchor));
    return root;
  }

  function closePopover() {
    if (!root) return;
    root.querySelector('.pop').hidden = true;
    openFor = null;
  }

  function position(anchor) {
    const pop = root.querySelector('.pop');
    const r = anchor.getBoundingClientRect();
    const w = 400;
    const margin = 12;
    let left = Math.min(Math.max(margin, r.left), window.innerWidth - w - margin);
    pop.style.left = `${left}px`;
    pop.style.width = `${w}px`;

    // Flip above the anchor when there isn't room below.
    const below = window.innerHeight - r.bottom;
    if (below < 260 && r.top > below) {
      pop.style.top = 'auto';
      pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
      pop.style.maxHeight = `${r.top - margin - 8}px`;
    } else {
      pop.style.bottom = 'auto';
      pop.style.top = `${r.bottom + 8}px`;
      pop.style.maxHeight = `${below - margin - 8}px`;
    }
  }

  function showPopover(anchor, html) {
    ensurePopover();
    const pop = root.querySelector('.pop');
    pop.innerHTML = html;
    pop.hidden = false;
    openFor = { anchor };
    position(anchor);
    wireResultActions(pop);
  }

  // ---------------------------------------------------------------- render

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  }

  function renderLoading(title) {
    return `<div class="card">
      <div class="row"><span class="spinner"></span><span class="muted">Reading the transcript…</span></div>
      ${title ? `<div class="vtitle">${esc(title)}</div>` : ''}
    </div>`;
  }

  function renderError(error, needsKey) {
    return `<div class="card">
      <div class="verr">${esc(error)}</div>
      ${needsKey ? `<button class="btn" data-act="options">Open settings</button>` : ''}
    </div>`;
  }

  function renderResult(d, { onWatchPage }) {
    const saved = savedLine(d);
    const bait = Number(d.bait) || 0;

    const jumps = (d.jump_to || [])
      .map((j) => {
        const href = `/watch?v=${encodeURIComponent(d.videoId)}&t=${Math.max(0, j.t | 0)}`;
        return `<a class="jump" href="${href}" data-t="${j.t | 0}">
                  <b>${fmtTime(j.t)}</b> ${esc(j.label)}
                </a>`;
      })
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

      ${(d.takeaways || []).length ? `<ul class="take">
          ${d.takeaways.map((t) => `<li>${esc(t)}</li>`).join('')}
        </ul>` : ''}

      ${jumps ? `<div class="jumps">${jumps}</div>` : ''}
      ${d.who_for ? `<p class="whofor">${esc(d.who_for)}</p>` : ''}

      <div class="foot">
        <span class="muted">${esc(d.model || '')}${d.autoCaptions ? ' · auto-captions' : ''}${d.thinned ? ' · long video, sampled' : ''}</span>
        <button class="link" data-act="redo" data-id="${esc(d.videoId)}" data-watch="${onWatchPage ? '1' : ''}">Re-run</button>
      </div>
    </div>`;
  }

  function wireResultActions(scope) {
    scope.querySelectorAll('[data-act="close"]').forEach((b) =>
      b.addEventListener('click', closePopover)
    );
    scope.querySelectorAll('[data-act="options"]').forEach((b) =>
      b.addEventListener('click', () => send({ type: 'openOptions' }))
    );
    scope.querySelectorAll('[data-act="redo"]').forEach((b) =>
      b.addEventListener('click', async () => {
        const id = b.dataset.id;
        const anchor = openFor?.anchor;
        if (anchor) showPopover(anchor, renderLoading(''));
        const r = await send({ type: 'summarise', videoId: id, force: true });
        const html = r.ok
          ? renderResult(r.data, { onWatchPage: Boolean(b.dataset.watch) })
          : renderError(r.error, r.needsKey);
        if (b.dataset.watch) renderPanel(html);
        else if (anchor) showPopover(anchor, html);
      })
    );
    // On the watch page, jump links seek the running player instead of reloading.
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

  // ---------------------------------------------------------------- badges

  const CLOCK = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M12 7v5.2l3.2 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;

  function thumbTargetFrom(el) {
    const a = el.closest?.('a[href]');
    if (!a || a.hasAttribute(BADGE_ATTR)) return null;
    const id = videoIdFromHref(a.getAttribute('href'));
    if (!id) return null;
    // Only anchors that actually wrap a thumbnail — not title links or chips.
    if (!a.querySelector('img, yt-image')) return null;
    return { anchor: a, id };
  }

  function attachBadge(anchor, id) {
    anchor.setAttribute(BADGE_ATTR, id);
    if (getComputedStyle(anchor).position === 'static') anchor.style.position = 'relative';

    const btn = document.createElement('button');
    btn.className = 'sy20-badge';
    btn.type = 'button';
    btn.title = 'Saved You 20 Minutes — is this worth watching?';
    btn.innerHTML = `${CLOCK}<span>Worth it?</span>`;

    btn.addEventListener('click', async (e) => {
      // Without both of these the click navigates to the video instead.
      e.preventDefault();
      e.stopPropagation();

      btn.classList.add('busy');
      showPopover(btn, renderLoading(''));
      const r = await send({ type: 'summarise', videoId: id });
      btn.classList.remove('busy');
      showPopover(btn, r.ok ? renderResult(r.data, { onWatchPage: false }) : renderError(r.error, r.needsKey));
      if (r.ok) markCached(anchor, r.data);
    });

    anchor.appendChild(btn);
    return btn;
  }

  /** A video already summarised gets its verdict shown without asking. */
  function markCached(anchor, data) {
    anchor.querySelector('.sy20-chip')?.remove();
    const chip = document.createElement('span');
    chip.className = `sy20-chip sy20-v-${data.verdict}`;
    chip.textContent = VERDICT_TEXT[data.verdict] || '';
    anchor.appendChild(chip);
  }

  document.addEventListener('mouseover', (e) => {
    const t = thumbTargetFrom(e.target);
    if (t) attachBadge(t.anchor, t.id);
  }, { passive: true });

  /** Sweep visible thumbnails and show chips for anything already summarised. */
  let sweepTimer = null;
  function scheduleSweep() {
    clearTimeout(sweepTimer);
    sweepTimer = setTimeout(sweep, 400);
  }

  async function sweep() {
    const anchors = [...document.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"]')]
      .filter((a) => a.querySelector('img, yt-image') && !a.querySelector('.sy20-chip'));
    if (!anchors.length) return;

    const byId = new Map();
    for (const a of anchors) {
      const id = videoIdFromHref(a.getAttribute('href'));
      if (id) byId.set(a, id);
    }
    const ids = [...new Set(byId.values())];
    if (!ids.length) return;

    const r = await send({ type: 'peek', videoIds: ids.slice(0, 120) });
    if (!r.ok) return;
    for (const [a, id] of byId) {
      if (r.data[id] && a.isConnected) markCached(a, r.data[id]);
    }
  }

  // ------------------------------------------------------------ watch page

  function renderPanel(html) {
    let panel = document.getElementById('sy20-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'sy20-panel';
      const shadow = panel.attachShadow({ mode: 'open' });
      shadow.innerHTML = `<style>${POPOVER_CSS}</style><div class="panel"></div>`;

      const metadata = document.querySelector('ytd-watch-metadata');
      const bottomRow = metadata?.querySelector('#bottom-row');
      if (bottomRow) bottomRow.parentElement.insertBefore(panel, bottomRow);
      else document.querySelector('#secondary-inner')?.prepend(panel);
      if (!panel.isConnected) return null;
    }
    const box = panel.shadowRoot.querySelector('.panel');
    box.innerHTML = html;
    wireResultActions(box);
    return panel;
  }

  function watchPrompt(id) {
    return `<div class="card cta">
      <div class="row">
        <span class="logo">${CLOCK}</span>
        <b>Saved You 20 Minutes</b>
      </div>
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
      b.addEventListener('click', async () => {
        renderPanel(renderLoading(document.title.replace(/ - YouTube$/, '')));
        const r = await send({ type: 'summarise', videoId: b.dataset.id });
        renderPanel(r.ok ? renderResult(r.data, { onWatchPage: true }) : renderError(r.error, r.needsKey));
      })
    );
  }

  // --------------------------------------------------------------- startup

  let lastHref = location.href;
  function onNavigate() {
    closePopover();
    // The watch panel is bound to one video; a soft navigation invalidates it.
    document.getElementById('sy20-panel')?.remove();
    setupWatchPage();
    scheduleSweep();
  }

  window.addEventListener('yt-navigate-finish', onNavigate);
  new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      onNavigate();
    } else {
      scheduleSweep();
    }
  }).observe(document.body, { childList: true, subtree: true });

  setupWatchPage();
  scheduleSweep();
})();
