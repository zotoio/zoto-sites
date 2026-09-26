const store = new Map();

/**
 * @param {string} key
 * @param {() => Promise<unknown>} loader
 * @param {number} ttlMs
 */
export async function cached(key, loader, ttlMs) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) {
    return hit.value;
  }
  const value = await loader();
  store.set(key, { value, expires: now + ttlMs });
  return value;
}

export function clearCacheForTests() {
  store.clear();
}
