const store = new Map();
const inflight = new Map();

/** How long a last-good value may be served (marked stale) after upstream failures. */
export const DEFAULT_MAX_STALE_MS = 6 * 60 * 60 * 1000;

/**
 * TTL cache with in-flight de-duplication and stale-on-error.
 * When the loader throws and a previous good value exists (younger than maxStaleMs),
 * that value is returned with `stale: true` and `staleSince` instead of throwing.
 * Throws when there is no usable previous value.
 *
 * @param {string} key
 * @param {() => Promise<unknown>} loader
 * @param {number} ttlMs
 * @param {{ maxStaleMs?: number }} [opts]
 */
export async function cached(key, loader, ttlMs, opts = {}) {
  const maxStaleMs = opts.maxStaleMs ?? DEFAULT_MAX_STALE_MS;
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) {
    return hit.value;
  }
  if (inflight.has(key)) {
    return inflight.get(key);
  }
  const p = (async () => {
    try {
      const value = await loader();
      store.set(key, { value, expires: Date.now() + ttlMs, fetchedAt: Date.now() });
      return value;
    } catch (err) {
      if (hit && Date.now() - hit.fetchedAt < maxStaleMs) {
        const v = hit.value;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          return { ...v, stale: true, staleSince: new Date(hit.fetchedAt).toISOString() };
        }
        return v;
      }
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export function clearCacheForTests() {
  store.clear();
  inflight.clear();
}
