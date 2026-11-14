import { describe, it, expect } from 'vitest';
import { MemoryVisitStore, recordHit, deviceKind, isAutomated, lookupGeo, SETTLE_AFTER_PING_MS } from '../src/lib/visits.js';
import { createNotifier, summarize } from '../src/lib/visitEmail.js';

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
const MAC_NEWER = MAC.replace('Chrome/146', 'Chrome/157');
const VID = 'a1b2c3d4e5f6a7b8c9d0e1f2';

function setup(geo = async () => ({ loc: 'US-TX', dc: false })) {
  const store = new MemoryVisitStore();
  let t = Date.parse('2026-11-12T18:00:00Z');
  const hit = (h, { ip = '203.0.113.9', ua = MAC } = {}) => recordHit({ store, hit: h, ip, ua, secret: 's', geo, now: () => t });
  return { store, hit, tick: (ms) => { t += ms; }, now: () => t };
}

describe('visit accuracy', () => {
  it('keeps one visitor id together across network and browser changes, and marks them returning later', async () => {
    const { store, hit, tick } = setup();
    const a = await hit({ p: '/', v: VID });
    tick(60_000);
    // New IP (Wi-Fi to cellular) and a browser update, same browser storage: same visit.
    const b = await hit({ p: 'click/resume', e: true, v: VID }, { ip: '198.51.100.4', ua: MAC_NEWER });
    expect(b.id).toBe(a.id);
    expect(b.hits.map((h) => h.p)).toEqual(['/', 'click/resume']);
    expect(a.first).toBe(true);
    // After 30 quiet minutes it's a new visit by a returning visitor.
    tick(31 * 60_000);
    const c = await hit({ p: '/', v: VID }, { ip: '192.0.2.50' });
    expect(c.id).not.toBe(a.id);
    expect(c.first).toBe(false);
    expect(c.visitor).toBe(a.visitor);
    // Two days later, still returning.
    tick(2 * 24 * 3600_000);
    expect((await hit({ p: '/', v: VID })).first).toBe(false);
    expect(await store.listSince(0, 10)).toHaveLength(3);
  });

  it('takes stay time and depth from heartbeats, and opens a visit from a heartbeat if the first beacon was lost', async () => {
    const { hit, tick } = setup();
    // First beacon lost while the server woke up: the heartbeat alone opens the visit.
    const v1 = await hit({ k: 'ping', p: 'ping', e: true, v: VID, s: 30, d: 'work', i: true });
    expect(v1.hits).toEqual([]);
    expect(Date.parse(v1.end) - Date.parse(v1.start)).toBe(30_000);
    tick(30_000);
    const v2 = await hit({ k: 'ping', p: 'ping', e: true, v: VID, s: 58, d: 'herd', i: true });
    expect(v2.id).toBe(v1.id);
    expect(v2).toMatchObject({ active: 58, deepest: 'herd', human: true });
    // A late, lower count never shrinks the time.
    const v3 = await hit({ k: 'ping', p: 'ping', e: true, v: VID, s: 40 });
    expect(v3.active).toBe(58);
    expect(summarize(v3).text).toContain('Reached:   scrolled to herd, stayed at least 58s');
    const v4 = await hit({ k: 'ping', p: 'ping', e: true, v: VID, s: 61, d: 'herd', f: true });
    expect(v4.final).toBe(true);
    expect(summarize(v4).text).toContain('Reached:   scrolled to herd, stayed 1m 1s');
  });

  it('flags data center visits that never interact, and keeps them out of email', async () => {
    const { store, hit, tick, now } = setup(async () => ({ loc: 'US-IA', dc: true }));
    const bot = await hit({ p: '/', v: 'scannerscannerscanner1' }, { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.135 Safari/537.36 Edge/12.10136' });
    expect(isAutomated(bot)).toBe(true);
    // A real person on a VPN in a data center scrolls, so they count.
    const person = await hit({ k: 'ping', p: 'ping', e: true, v: VID, s: 12, i: true }, { ip: '198.51.100.9' });
    expect(isAutomated(person)).toBe(false);
    tick(SETTLE_AFTER_PING_MS + 1000);
    const sent = [];
    const n = createNotifier({ store, apiKey: 'k', to: 'x', now, fetchImpl: async (_u, o) => { sent.push(JSON.parse(o.body)); return { ok: true, text: async () => '' }; }, log: { warn() {} } });
    expect(await n.sweep()).toBe(1);
    expect(sent[0].text).toContain('stayed at least 12s');
  });

  it('tells phones, tablets and desktops apart from the user agent', () => {
    expect(deviceKind('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148', 390)).toBe('phone');
    expect(deviceKind('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130.0 Safari/537.36', 1280)).toBe('tablet');
    expect(deviceKind('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', 412)).toBe('phone');
    expect(deviceKind(MAC, 1024, 5)).toBe('tablet'); // iPadOS reports a Mac user agent
    expect(deviceKind(MAC, 1024, 0)).toBe('desktop'); // a small Mac window is still a Mac
    expect(deviceKind('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/157.0', 1024)).toBe('desktop');
  });

  it('marks data center addresses from either geo provider', async () => {
    const ok = (body) => ({ ok: true, json: async () => body });
    const ipapi = async () => ok({ status: 'success', countryCode: 'US', region: 'IA', hosting: true, org: 'Google LLC' });
    expect(await lookupGeo('203.0.113.9', { fetchImpl: ipapi })).toEqual({ loc: 'US-IA', dc: true });
    const ipwho = async (url) => (url.includes('ip-api') ? { ok: false, status: 429 } : ok({ success: true, country_code: 'US', region_code: 'VA', connection: { org: 'Amazon Technologies Inc.' } }));
    expect(await lookupGeo('203.0.113.9', { fetchImpl: ipwho })).toEqual({ loc: 'US-VA', dc: true });
    const home = async () => ok({ status: 'success', countryCode: 'US', region: 'TX', hosting: false, org: 'Spectrum', isp: 'Charter Communications' });
    expect(await lookupGeo('203.0.113.9', { fetchImpl: home })).toEqual({ loc: 'US-TX', dc: false });
  });

  it('says how short a visit was when no check-in arrived', async () => {
    const { hit } = setup();
    const v2 = await hit({ p: '/', v: 'newcodevisitor00000001', cv: 2 });
    expect(v2.cv).toBe(2);
    expect(summarize(v2).text).toContain('Reached:   left within about 3 seconds');
    const v1 = await hit({ p: '/', v: 'oldcodevisitor00000001' }, { ip: '198.51.100.20' });
    expect(summarize(v1).text).toContain('Reached:   left within about 10 seconds');
    const v0 = await hit({ p: '/' }, { ip: '198.51.100.21' });
    expect(summarize(v0).text).toContain('no scroll data');
  });
});
