import { api } from '../lib/browser.js';
import { activeProvider } from '../lib/settings.js';
import { videoIdFrom } from '../lib/innertube.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => api.runtime.sendMessage(msg);

/** Same reasoning as the content script: build nodes, never assign innerHTML. */
function h(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

const body = (...nodes) => $('body').replaceChildren(...nodes.filter(Boolean));

$('settings').addEventListener('click', () => api.runtime.openOptionsPage());

const stats = await send({ type: 'stats' });
if (stats.ok) $('stats').textContent = `${stats.data.count} cached`;

const active = await activeProvider();

if (!active.ok) {
  body(
    h('p', { class: 'warn', text: active.reason }),
    h('button', {
      class: 'btn',
      text: 'Add an API key',
      onclick: () => api.runtime.openOptionsPage(),
    })
  );
} else {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const videoId = videoIdFrom(tab?.url || '');

  if (!videoId) {
    body(h('p', {
      class: 'muted',
      text: 'Open a YouTube video, or hover any thumbnail and click “Worth it?”.',
    }));
  } else {
    const peek = await send({ type: 'peek', videoIds: [videoId], always: true });
    const hit = peek.ok && peek.data[videoId];
    if (hit) render(hit);
    else {
      body(h('button', {
        class: 'btn',
        text: 'Is this worth watching?',
        onclick: async () => {
          body(h('p', { class: 'muted', text: 'Reading the transcript…' }));
          const r = await send({ type: 'summarise', videoId });
          if (r.ok) render(r.data);
          else body(h('p', { class: 'warn', text: r.error }));
        },
      }));
    }
  }
}

function render(d) {
  const labels = { watch: 'WORTH IT', skim: 'SKIM IT', skip: 'SKIP IT', unclear: 'UNCLEAR' };
  body(
    h('span', { class: `pill v-${d.verdict}`, text: labels[d.verdict] || '' }),
    h('p', { class: 'answer', text: d.answer }),
    d.verdict_line && h('p', { class: 'muted', text: d.verdict_line })
  );
}
