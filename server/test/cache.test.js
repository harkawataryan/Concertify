import { describe, it, expect, vi } from 'vitest';
import { MemoryCache, cached } from '../src/lib/cache.js';

describe('MemoryCache', () => {
  it('expires entries after their TTL', async () => {
    let t = 0;
    const cache = new MemoryCache({ now: () => t });
    await cache.set('a', 1, 10);
    expect(await cache.get('a')).toBe(1);
    t = 10_001;
    expect(await cache.get('a')).toBeUndefined();
  });

  it('evicts the least recently used entry when full', async () => {
    const cache = new MemoryCache({ maxEntries: 2 });
    await cache.set('a', 1, 60);
    await cache.set('b', 2, 60);
    await cache.get('a'); // touch a so b is now the oldest
    await cache.set('c', 3, 60);
    expect(await cache.get('b')).toBeUndefined();
    expect(await cache.get('a')).toBe(1);
    expect(await cache.get('c')).toBe(3);
  });
});

describe('cached (read-through with single-flight)', () => {
  it('computes once and serves subsequent reads from cache', async () => {
    const withCache = cached(new MemoryCache());
    const compute = vi.fn(async () => 'value');
    expect(await withCache('k', 60, compute)).toBe('value');
    expect(await withCache('k', 60, compute)).toBe('value');
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent misses into one upstream call', async () => {
    const withCache = cached(new MemoryCache());
    let resolve;
    const compute = vi.fn(() => new Promise((r) => { resolve = r; }));
    const calls = Promise.all([withCache('k', 60, compute), withCache('k', 60, compute), withCache('k', 60, compute)]);
    // The cache lookup is awaited before compute runs, so let the event loop turn first.
    await new Promise((r) => setTimeout(r, 0));
    resolve('once');
    expect(await calls).toEqual(['once', 'once', 'once']);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures', async () => {
    const withCache = cached(new MemoryCache());
    const compute = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');
    await expect(withCache('k', 60, compute)).rejects.toThrow('boom');
    expect(await withCache('k', 60, compute)).toBe('ok');
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
