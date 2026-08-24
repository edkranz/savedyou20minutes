import { PROVIDERS, getSettings, saveSettings } from '../lib/settings.js';
import { api } from '../lib/browser.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => api.runtime.sendMessage(msg);

let settings = await getSettings();

// ---- provider + model pickers ------------------------------------------
for (const [id, p] of Object.entries(PROVIDERS)) {
  $('provider').append(new Option(p.label, id));
}

function paintProvider() {
  const id = settings.provider;
  const p = PROVIDERS[id];
  $('provider').value = id;
  $('apiKey').value = settings.keys[id] || '';
  $('keyLink').href = p.keyUrl;
  $('keyLink').textContent = `Get a ${p.label} key`;

  $('model').replaceChildren();
  for (const m of p.MODELS) $('model').append(new Option(m.label, m.id));
  $('model').value = settings.models[id] || p.DEFAULT_MODEL;
  $('testResult').textContent = '';
}

function flash(el, text, kind = '') {
  el.textContent = text;
  el.className = `result ${kind}`;
}

async function persist(patch) {
  settings = await saveSettings(patch);
  flash($('saveState'), 'Saved', 'ok');
  setTimeout(() => flash($('saveState'), ''), 1400);
}

$('provider').addEventListener('change', async () => {
  await persist({ provider: $('provider').value });
  paintProvider();
});

$('apiKey').addEventListener('change', () =>
  persist({ keys: { [settings.provider]: $('apiKey').value.trim() } })
);

$('model').addEventListener('change', () =>
  persist({ models: { [settings.provider]: $('model').value } })
);

$('showCachedBadges').addEventListener('change', () =>
  persist({ showCachedBadges: $('showCachedBadges').checked })
);

// ---- test + cache -------------------------------------------------------
$('test').addEventListener('click', async () => {
  await persist({
    keys: { [settings.provider]: $('apiKey').value.trim() },
    models: { [settings.provider]: $('model').value },
  });
  flash($('testResult'), 'Testing…');
  const r = await send({ type: 'testKey' });
  if (r.ok) flash($('testResult'), `Working — ${r.data.model} responded.`, 'ok');
  else flash($('testResult'), r.error, 'err');
});

$('clearCache').addEventListener('click', async () => {
  const r = await send({ type: 'clearCache' });
  flash($('clearResult'), r.ok ? `Cleared ${r.data.removed} summaries.` : r.error, r.ok ? 'ok' : 'err');
  paintCacheStats();
});

async function paintCacheStats() {
  const r = await send({ type: 'stats' });
  if (r.ok) $('cacheStats').textContent = `${r.data.count} of ${r.data.max} slots used.`;
}

// ---- boot ---------------------------------------------------------------
paintProvider();
$('showCachedBadges').checked = settings.showCachedBadges;
paintCacheStats();
