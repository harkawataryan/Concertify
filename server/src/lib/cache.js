import { log } from './logger.js';

/**
 * Cache interface used throughout the server:
 *   get(key) -> Promise<value | undefined>
 *   set(key, value, ttlSeconds) -> Promise<void>
 *   del(key) -> Promise<void>
 *
 * Two backends share it. MemoryCache is the default and is good enough for a
 * single process; RedisCache is used when REDIS_URL is set so several server
 * instances share one cache and survive restarts.
 */

export class MemoryCache {
  constructor({ maxEntries = 5000, now = Date.now } = {}) {
    this.maxEntries = maxEntries;
    this.now = now;
    // Map preserves insertion order, which gives us LRU eviction for free:
    // re-inserting on read moves the key to the end.
    this.store = new Map();
  }

  async get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  async set(key, value, ttlSeconds) {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      this.store.delete(oldest);
    }
  }

  async del(key) {
    this.store.delete(key);
  }

  get size() {
    return this.store.size;
  }
}

export class RedisCache {
  constructor(client, { prefix = 'concertify:' } = {}) {
    this.client = client;
    this.prefix = prefix;
  }

  async get(key) {
    const raw = await this.client.get(this.prefix + key);
    return raw === null ? undefined : JSON.parse(raw);
  }

  async set(key, value, ttlSeconds) {
    await this.client.set(this.prefix + key, JSON.stringify(value), 'EX', Math.max(1, Math.round(ttlSeconds)));
  }

  async del(key) {
    await this.client.del(this.prefix + key);
  }
}

export async function createCache({ redisUrl, maxEntries }) {
  if (!redisUrl) {
    log.info('cache: using in-memory LRU', { maxEntries });
    return new MemoryCache({ maxEntries });
  }
  const { default: Redis } = await import('ioredis');
  const client = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
  client.on('error', (err) => log.warn('redis error', { err: err.message }));
  await client.connect();
  log.info('cache: using redis', { url: redisUrl.replace(/\/\/.*@/, '//***@') });
  return new RedisCache(client);
}

/**
 * Read-through helper: returns the cached value or computes, stores and
 * returns it. Concurrent callers for the same key share one in-flight
 * computation (single-flight), which matters when a page load fans out into
 * dozens of identical upstream requests.
 */
export function cached(cache) {
  const inflight = new Map();
  return async function withCache(key, ttlSeconds, compute) {
    const hit = await cache.get(key);
    if (hit !== undefined) return hit;
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      try {
        const value = await compute();
        if (value !== undefined) await cache.set(key, value, ttlSeconds);
        return value;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  };
}
