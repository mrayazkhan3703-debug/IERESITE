/** In-process TTL cache (dev/demo scale). Redis-compatible in production (ADR-007 note). */

interface Entry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, Entry>();
let lastSweep = 0;

export const cache = {
  get<T>(key: string): T | null {
    const e = store.get(key);
    if (!e) return null;
    if (e.expiresAt < Date.now()) {
      store.delete(key);
      return null;
    }
    return e.value as T;
  },
  set(key: string, value: unknown, ttlMs: number) {
    // opportunistic sweep
    if (Date.now() - lastSweep > 60_000) {
      lastSweep = Date.now();
      for (const [k, v] of store) if (v.expiresAt < Date.now()) store.delete(k);
    }
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
  },
  invalidatePrefix(prefix: string) {
    for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
  },
  clear() {
    store.clear();
  },
  size() {
    return store.size;
  },
};
