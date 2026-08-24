/**
 * Summary cache in storage.local, keyed by video id.
 *
 * Entries are stored one key per video so a read costs one lookup rather than
 * deserialising the whole cache. A separate index array carries the eviction
 * order — storage.local has no size introspection worth relying on, so we
 * bound by entry count instead.
 */
import { api } from './browser.js';

const PREFIX = 'sum:';
const INDEX_KEY = 'sum:index';
const MAX_ENTRIES = 500;

const keyFor = (videoId) => PREFIX + videoId;

export async function get(videoId) {
  const k = keyFor(videoId);
  const got = await api.storage.local.get(k);
  return got[k] || null;
}

export async function getMany(videoIds) {
  if (!videoIds.length) return {};
  const keys = videoIds.map(keyFor);
  const got = await api.storage.local.get(keys);
  const out = {};
  for (const id of videoIds) {
    const hit = got[keyFor(id)];
    if (hit) out[id] = hit;
  }
  return out;
}

export async function put(videoId, entry) {
  const stored = { ...entry, cachedAt: Date.now() };
  await api.storage.local.set({ [keyFor(videoId)]: stored });

  const { [INDEX_KEY]: index = [] } = await api.storage.local.get(INDEX_KEY);
  const next = index.filter((id) => id !== videoId);
  next.push(videoId);

  if (next.length > MAX_ENTRIES) {
    const evicted = next.splice(0, next.length - MAX_ENTRIES);
    await api.storage.local.remove(evicted.map(keyFor));
  }
  await api.storage.local.set({ [INDEX_KEY]: next });
  return stored;
}

export async function remove(videoId) {
  await api.storage.local.remove(keyFor(videoId));
  const { [INDEX_KEY]: index = [] } = await api.storage.local.get(INDEX_KEY);
  await api.storage.local.set({ [INDEX_KEY]: index.filter((id) => id !== videoId) });
}

export async function stats() {
  const { [INDEX_KEY]: index = [] } = await api.storage.local.get(INDEX_KEY);
  return { count: index.length, max: MAX_ENTRIES };
}

export async function clear() {
  const { [INDEX_KEY]: index = [] } = await api.storage.local.get(INDEX_KEY);
  await api.storage.local.remove([...index.map(keyFor), INDEX_KEY]);
  return index.length;
}
