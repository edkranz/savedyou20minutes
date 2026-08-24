import { api } from './browser.js';
import * as anthropic from './providers/anthropic.js';
import * as openai from './providers/openai.js';
import * as gemini from './providers/gemini.js';

export const PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', keyUrl: 'https://console.anthropic.com/settings/keys', ...anthropic },
  openai: { label: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys', ...openai },
  gemini: { label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/apikey', ...gemini },
};

const DEFAULTS = {
  provider: 'anthropic',
  models: {
    anthropic: anthropic.DEFAULT_MODEL,
    openai: openai.DEFAULT_MODEL,
    gemini: gemini.DEFAULT_MODEL,
  },
  keys: { anthropic: '', openai: '', gemini: '' },
  showCachedBadges: true,
  autoOnWatchPage: false,
};

export async function getSettings() {
  const stored = await api.storage.local.get('settings');
  const s = stored.settings || {};
  return {
    ...DEFAULTS,
    ...s,
    models: { ...DEFAULTS.models, ...(s.models || {}) },
    keys: { ...DEFAULTS.keys, ...(s.keys || {}) },
  };
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = {
    ...current,
    ...patch,
    models: { ...current.models, ...(patch.models || {}) },
    keys: { ...current.keys, ...(patch.keys || {}) },
  };
  await api.storage.local.set({ settings: next });
  return next;
}

/** The active provider plus its key and model, or a reason it isn't usable. */
export async function activeProvider() {
  const s = await getSettings();
  const provider = PROVIDERS[s.provider] ? s.provider : 'anthropic';
  const key = (s.keys[provider] || '').trim();
  if (!key) {
    return { ok: false, reason: `No ${PROVIDERS[provider].label} API key set.`, provider };
  }
  return { ok: true, provider, key, model: s.models[provider], settings: s };
}
