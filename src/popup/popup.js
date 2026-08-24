import { api } from '../lib/browser.js';
import { activeProvider } from '../lib/settings.js';
import { videoIdFrom } from '../lib/innertube.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => api.runtime.sendMessage(msg);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

$('settings').addEventListener('click', () => api.runtime.openOptionsPage());

const stats = await send({ type: 'stats' });
if (stats.ok) $('stats').textContent = `${stats.data.count} cached`;

const active = await activeProvider();
if (!active.ok) {
  $('body').innerHTML = `<p class="warn">${esc(active.reason)}</p>
    <button class="btn" id="go" type="button">Add an API key</button>`;
  $('go').addEventListener('click', () => api.runtime.openOptionsPage());
} else {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const videoId = videoIdFrom(tab?.url || '');

  if (!videoId) {
    $('body').innerHTML =
      `<p class="muted">Open a YouTube video, or hover any thumbnail and click <b>Worth it?</b></p>`;
  } else {
    const peek = await send({ type: 'peek', videoIds: [videoId], always: true });
    const hit = peek.ok && peek.data[videoId];
    if (hit) render(hit);
    else {
      $('body').innerHTML = `<button class="btn" id="run" type="button">Is this worth watching?</button>`;
      $('run').addEventListener('click', async () => {
        $('body').innerHTML = `<p class="muted">Reading the transcript…</p>`;
        const r = await send({ type: 'summarise', videoId });
        if (r.ok) render(r.data);
        else $('body').innerHTML = `<p class="warn">${esc(r.error)}</p>`;
      });
    }
  }
}

function render(d) {
  const labels = { watch: 'WORTH IT', skim: 'SKIM IT', skip: 'SKIP IT', unclear: 'UNCLEAR' };
  $('body').innerHTML = `
    <span class="pill v-${esc(d.verdict)}">${labels[d.verdict] || ''}</span>
    <p class="answer">${esc(d.answer)}</p>
    <p class="muted">${esc(d.verdict_line || '')}</p>`;
}
