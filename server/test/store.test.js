import { describe, it, expect } from 'vitest';
import { MemoryCache } from '../src/lib/cache.js';
import { createStore } from '../src/lib/store.js';

describe('store', () => {
  it('returns a default user document and persists mutations', async () => {
    const store = createStore(new MemoryCache());
    const fresh = await store.getUser('u1');
    expect(fresh).toMatchObject({ id: 'u1', watchlist: {}, alerts: [], plans: [] });

    await store.updateUser('u1', (u) => { u.watchlist.x = { id: 'x', name: 'X' }; });
    expect((await store.getUser('u1')).watchlist.x.name).toBe('X');
    expect(await store.listUserIds()).toEqual(['u1']);
  });

  it('stores and reads plans', async () => {
    const store = createStore(new MemoryCache());
    expect(await store.getPlan('nope')).toBeNull();
    await store.setPlan({ code: 'abc', name: 'Trip', members: {} });
    expect((await store.getPlan('abc')).name).toBe('Trip');
  });
});
