// Single-flight, TTL-cached lookup. Multiple concurrent callers during a
// rebuild share one in-flight promise instead of thundering-herding the
// upstream. Used by routes/users.js and routes/groups.js for the Authentik
// group map.

export function createCachedLoader(loader, ttlMs) {
  let value = null;
  let valueAt = 0;
  let inflight = null;

  async function get() {
    const now = Date.now();
    if (value && now - valueAt < ttlMs) return value;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const fresh = await loader();
        value = fresh;
        valueAt = Date.now();
        return fresh;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  function invalidate() {
    value = null;
    valueAt = 0;
  }

  return { get, invalidate };
}
