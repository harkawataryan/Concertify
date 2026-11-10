import { describe, it, expect } from 'vitest';
import express from 'express';
import http from 'node:http';
import { visitsRouter } from '../src/routes/visits.js';
import { MemoryVisitStore, parseUserAgent, recordHit } from '../src/lib/visits.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function build(opts = {}) {
  const store = new MemoryVisitStore();
  let t = Date.parse('2026-11-10T12:00:00Z');
  const now = () => t;
  const app = express();
  app.set('trust proxy', 1);
  app.use('/api/visits', visitsRouter({ store, token: 'secret', origins: ['https://aryanh.dev'], geo: async () => 'US-TX', now, ...opts }));
  return { app, store, tick: (ms) => { t += ms; } };
}
async function call(app, method, path, { body, headers = {} } = {}) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, body, headers });
  const text = await res.text();
  server.close();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}
const hit = (app, obj, ip = '203.0.113.9') => call(app, 'POST', '/api/visits/hit', { body: JSON.stringify(obj), headers: { 'content-type': 'text/plain', 'user-agent': UA, 'x-forwarded-for': ip, origin: 'https://aryanh.dev' } });

describe('visits', () => {
  it('groups hits from one browser into one visit and lists it with the token', async () => {
    const { app, tick } = build();
    let r = await hit(app, { p: '/', e: false, ref: 'https://google.com', w: 1440 });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('https://aryanh.dev');
    tick(5000);
    await hit(app, { p: 'click/resume', e: true });
    tick(20000);
    await hit(app, { p: 'visit/herd/20-60s', e: true });

    r = await call(app, 'GET', '/api/visits');
    expect(r.status).toBe(401);
    r = await call(app, 'GET', '/api/visits', { headers: { authorization: 'Bearer secret' } });
    expect(r.status).toBe(200);
    expect(r.body.visits).toHaveLength(1);
    const v = r.body.visits[0];
    expect(v).toMatchObject({ loc: 'US-TX', ref: 'https://google.com', browser: 'Chrome 130', system: 'macOS', width: 1440, first: true });
    expect(v.hits.map((h) => h.p)).toEqual(['/', 'click/resume', 'visit/herd/20-60s']);
    expect(v.hits.map((h) => h.e)).toEqual([false, true, true]);
    expect(v.start).toBe('2026-11-10T12:00:00.000Z');
    expect(v.end).toBe('2026-11-10T12:00:25.000Z');
  });

  it('separates visitors, marks returning ones, and filters by since', async () => {
    const { app, tick } = build();
    await hit(app, { p: '/' }, '203.0.113.9');
    tick(1000);
    await hit(app, { p: '/' }, '198.51.100.4');
    let r = await call(app, 'GET', '/api/visits', { headers: { authorization: 'Bearer secret' } });
    expect(r.body.visits).toHaveLength(2);
    expect(r.body.visits[0].first).toBe(true);
    // A new day gives the same browser a new session, but it's no longer a first visit.
    tick(2 * 24 * 3600 * 1000);
    await hit(app, { p: '/' }, '203.0.113.9');
    r = await call(app, 'GET', '/api/visits', { headers: { authorization: 'Bearer secret' } });
    expect(r.body.visits).toHaveLength(3);
    expect(r.body.visits[0].first).toBe(false);
    r = await call(app, 'GET', `/api/visits?since=${Date.parse('2026-11-12T00:00:00Z')}`, { headers: { authorization: 'Bearer secret' } });
    expect(r.body.visits).toHaveLength(1);
  });

  it('rejects bad bodies and drops duplicate beacons', async () => {
    const { app, store } = build();
    let r = await call(app, 'POST', '/api/visits/hit', { body: 'not json', headers: { 'content-type': 'text/plain' } });
    expect(r.status).toBe(400);
    await hit(app, { p: 'visit/top/0-3s', e: true });
    await hit(app, { p: 'visit/top/0-3s', e: true });
    const [v] = await store.listSince(0, 10);
    expect(v.hits).toHaveLength(1);
  });

  it('never stores the IP and caches geo per hashed IP', async () => {
    const store = new MemoryVisitStore();
    let calls = 0;
    const geo = async () => { calls++; return 'DE-BE'; };
    const v = await recordHit({ store, hit: { p: '/' }, ip: '203.0.113.9', ua: UA, secret: 's', geo });
    await recordHit({ store, hit: { p: '/about' }, ip: '203.0.113.9', ua: 'other', secret: 's', geo });
    expect(calls).toBe(1);
    expect(JSON.stringify(v)).not.toContain('203.0.113.9');
  });

  it('parses common user agents', () => {
    expect(parseUserAgent(UA)).toEqual({ browser: 'Chrome 130', system: 'macOS' });
    expect(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toEqual({ browser: 'Safari 17', system: 'iOS' });
    expect(parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0')).toEqual({ browser: 'Firefox 132', system: 'Windows' });
    expect(parseUserAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0')).toEqual({ browser: 'Edge 130', system: 'Windows' });
    expect(parseUserAgent('curl/8.0')).toEqual({ browser: 'Bot', system: '' });
  });

  it('reports since when it has been recording', async () => {
    const { app, tick } = build();
    let r = await call(app, 'GET', '/api/visits/status');
    expect(r.body).toMatchObject({ ok: true, email: false, since: '2026-11-10T12:00:00.000Z' });
    tick(60_000);
    r = await call(app, 'GET', '/api/visits/status');
    expect(r.body.since).toBe('2026-11-10T12:00:00.000Z');
  });
});

describe('client address and geo lookup', () => {
  it('prefers Cloudflare and the first public forwarded address over req.ip', async () => {
    const { clientIp } = await import('../src/lib/visits.js');
    const req = (headers, ip = '10.0.0.5') => ({ ip, headers, get: (n) => headers[n] });
    expect(clientIp(req({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '203.0.113.9' }))).toBe('198.51.100.7');
    expect(clientIp(req({ 'x-forwarded-for': '10.1.2.3, 203.0.113.9, 104.16.0.1' }))).toBe('203.0.113.9');
    expect(clientIp(req({}, '::ffff:198.51.100.8'))).toBe('198.51.100.8');
  });

  it('falls back to the second provider and reports failures without caching them', async () => {
    const { lookupGeo, recordHit, geoStats } = await import('../src/lib/visits.js');
    const ok = (body) => ({ ok: true, json: async () => body });
    const fetchImpl = async (url) => (url.includes('ip-api') ? { ok: false, status: 429 } : ok({ success: true, country_code: 'TW', region_code: 'TPE' }));
    expect(await lookupGeo('203.0.113.9', { fetchImpl })).toBe('TW-TPE');
    const down = async () => { throw new Error('offline'); };
    expect(await lookupGeo('203.0.113.9', { fetchImpl: down })).toBe('');
    expect(geoStats.lastError).toContain('offline');
    expect(await lookupGeo('10.0.0.5')).toBe('');
    expect(geoStats.lastError).toBe('private or proxy address');

    const store = new MemoryVisitStore();
    let calls = 0;
    const flaky = async () => (calls++ === 0 ? '' : 'US-TX');
    const UA2 = 'Mozilla/5.0 (Windows NT 10.0) Chrome/150.0 Safari/537.36';
    const a = await recordHit({ store, hit: { p: '/' }, ip: '203.0.113.20', ua: UA2, secret: 's', geo: flaky });
    const b = await recordHit({ store, hit: { p: '/' }, ip: '203.0.113.20', ua: UA2 + ' x', secret: 's', geo: flaky });
    expect(a.loc).toBe('');
    expect(b.loc).toBe('US-TX');
  });
});

describe('saving a backfilled location', () => {
  it('sets a missing location with the token, and never overwrites one', async () => {
    const { app } = build({ geo: async () => '' });
    await hit(app, { p: '/' });
    const auth = { authorization: 'Bearer secret', 'content-type': 'application/json' };
    const list = await call(app, 'GET', '/api/visits', { headers: auth });
    const id = list.body.visits[0].id;
    expect(list.body.visits[0].loc).toBe('');

    expect((await call(app, 'PATCH', `/api/visits/${id}`, { body: '{"loc":"US-WA"}', headers: { 'content-type': 'application/json' } })).status).toBe(401);
    expect((await call(app, 'PATCH', `/api/visits/${id}`, { body: '{"loc":"<script>"}', headers: auth })).status).toBe(400);
    expect((await call(app, 'PATCH', '/api/visits/nope', { body: '{"loc":"US-WA"}', headers: auth })).status).toBe(404);

    const ok = await call(app, 'PATCH', `/api/visits/${id}`, { body: '{"loc":"us-wa"}', headers: auth });
    expect(ok.body).toEqual({ id, loc: 'US-WA', locFrom: 'goatcounter' });
    expect((await call(app, 'PATCH', `/api/visits/${id}`, { body: '{"loc":"DE"}', headers: auth })).status).toBe(409);

    const after = await call(app, 'GET', '/api/visits', { headers: auth });
    expect(after.body.visits[0]).toMatchObject({ loc: 'US-WA', locFrom: 'goatcounter' });
  });
});
