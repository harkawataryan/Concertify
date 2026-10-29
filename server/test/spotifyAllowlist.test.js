import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Exercises the allowlist rotation against a fake dashboard: login, token
// exchange, list, add and delete are all answered by an in-memory stub so the
// eviction logic is checked without touching Spotify.
describe('spotifyAllowlist', () => {
  let users;
  let calls;
  const realFetch = global.fetch;

  beforeEach(async () => {
    process.env.SPOTIFY_DASHBOARD_SP_DC = 'cookie';
    process.env.SPOTIFY_CLIENT_ID = 'app123';
    users = [];
    calls = [];
    let nextId = 1;
    global.fetch = vi.fn(async (url, opts = {}) => {
      const u = String(url);
      calls.push(`${opts.method || 'GET'} ${u.replace(/\?.*/, '')}`);
      if (u.startsWith('https://accounts.spotify.com/oauth2/v2/auth')) {
        return new Response('', { status: 303, headers: { location: 'https://developer.spotify.com/?code=CODE&state=x' } });
      }
      if (u === 'https://accounts.spotify.com/api/token') {
        return Response.json({ access_token: 'tok', expires_in: 3600 });
      }
      if (u.endsWith('/clients/app123/users') && (opts.method || 'GET') === 'GET') {
        return Response.json({ users });
      }
      if (u.endsWith('/clients/app123/users') && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        const row = { ...body, id: `id${nextId}`, createdAt: new Date(2026, 0, nextId).toISOString() };
        nextId += 1;
        users.push(row);
        return Response.json(row);
      }
      const del = u.match(/\/users\/id\/(.+)$/);
      if (del && opts.method === 'DELETE') {
        users = users.filter((x) => x.id !== del[1]);
        return Response.json({});
      }
      return new Response('nope', { status: 404 });
    });
    vi.resetModules();
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('adds a new email and evicts the oldest once the list is full', async () => {
    const { ensureAccess, listUsers } = await import('../src/lib/spotifyAllowlist.js');
    for (let i = 1; i <= 5; i += 1) await ensureAccess(`u${i}@x.com`);
    expect((await listUsers()).map((u) => u.email)).toEqual(['u1@x.com', 'u2@x.com', 'u3@x.com', 'u4@x.com', 'u5@x.com']);

    const r = await ensureAccess('U6@x.com');
    expect(r).toEqual({ added: true, evicted: 'u1@x.com' });
    expect((await listUsers()).map((u) => u.email)).toEqual(['u2@x.com', 'u3@x.com', 'u4@x.com', 'u5@x.com', 'u6@x.com']);
  });

  it('is a no-op for an email already on the list', async () => {
    const { ensureAccess } = await import('../src/lib/spotifyAllowlist.js');
    await ensureAccess('a@x.com');
    const before = calls.length;
    expect(await ensureAccess('A@x.com ')).toEqual({ added: false, evicted: null });
    expect(calls.slice(before).filter((c) => c.startsWith('POST') || c.startsWith('DELETE'))).toEqual([]);
  });

  it('logs in once and reuses the token', async () => {
    const { listUsers } = await import('../src/lib/spotifyAllowlist.js');
    await listUsers();
    await listUsers();
    expect(calls.filter((c) => c.includes('/api/token')).length).toBe(1);
  });

  it('reports an expired cookie clearly', async () => {
    global.fetch = vi.fn(async () => new Response('<html>login</html>', { status: 200 }));
    const { listUsers } = await import('../src/lib/spotifyAllowlist.js');
    await expect(listUsers()).rejects.toThrow(/sp_dc cookie may have expired/);
  });
});
