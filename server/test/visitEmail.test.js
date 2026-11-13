import { describe, it, expect } from 'vitest';
import { MemoryVisitStore, recordHit, SETTLE_AFTER_SUMMARY_MS, SETTLE_IDLE_MS } from '../src/lib/visits.js';
import { createNotifier, summarize, place } from '../src/lib/visitEmail.js';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function setup() {
  const store = new MemoryVisitStore();
  let t = Date.parse('2026-11-10T20:00:00Z');
  const now = () => t;
  const sent = [];
  const fetchImpl = async (_url, opts) => { sent.push(JSON.parse(opts.body)); return { ok: true, text: async () => '' }; };
  const notifier = createNotifier({ store, apiKey: 'k', to: 'me@example.com', now, fetchImpl, log: { warn() {} } });
  const hit = (h, ua = UA, ip = '203.0.113.9') => recordHit({ store, hit: h, ip, ua, secret: 's', geo: async () => 'US-CA', now });
  return { store, notifier, sent, hit, tick: (ms) => { t += ms; } };
}

describe('visit emails', () => {
  it('sends one email shortly after the closing summary, never twice', async () => {
    const { notifier, sent, hit, tick } = setup();
    await hit({ p: '/', ref: 'https://www.linkedin.com/feed/', w: 390 });
    tick(4000); await hit({ p: 'click/resume', e: true });
    tick(30000); await hit({ p: 'visit/herd/20-60s', e: true });
    expect(await notifier.sweep()).toBe(0);
    tick(SETTLE_AFTER_SUMMARY_MS);
    expect(await notifier.sweep()).toBe(1);
    expect(await notifier.sweep()).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('aryanh.dev visit · California, US · linkedin.com');
    expect(sent[0].to).toEqual(['me@example.com']);
    expect(sent[0].text).toContain('Device:    Safari 17 on iOS, phone, 390px wide');
    expect(sent[0].text).toContain('Reached:   scrolled to herd, stayed 34s');
    expect(sent[0].text).toContain('Clicked:   resume');
    expect(sent[0].text).toContain('When:      Tue, Nov 10, 2:00 PM Central');
  });

  it('emails a visit that never sent a summary after ten quiet minutes', async () => {
    const { notifier, sent, hit, tick } = setup();
    await hit({ p: '/' });
    tick(SETTLE_IDLE_MS - 1000);
    expect(await notifier.sweep()).toBe(0);
    tick(2000);
    expect(await notifier.sweep()).toBe(1);
    expect(sent[0].text).toContain('no scroll data');
  });

  it('ignores bots and retries after a failed send', async () => {
    const { store, hit, tick } = setup();
    expect(await hit({ p: '/' }, 'Mozilla/5.0 (compatible; Googlebot/2.1)')).toBeNull();
    expect(await store.listSince(0, 10)).toHaveLength(0);

    await hit({ p: 'visit/top/0-3s', e: true });
    tick(SETTLE_AFTER_SUMMARY_MS);
    let fail = true;
    const sent = [];
    const fetchImpl = async (_u, o) => { if (fail) return { ok: false, status: 500, text: async () => 'boom' }; sent.push(o); return { ok: true, text: async () => '' }; };
    const n = createNotifier({ store, apiKey: 'k', to: 'x', now: () => Date.now() + 1e9, fetchImpl, log: { warn() {} } });
    expect(await n.sweep()).toBe(0);
    fail = false;
    expect(await n.sweep()).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it('formats places', () => {
    expect(place('US-TX')).toBe('Texas, US');
    expect(place('DE-BE')).toBe('BE, Germany');
    expect(place('')).toBe('Unknown location');
    expect(summarize({ start: '2026-11-10T20:00:00Z', loc: '', ref: '', browser: '', system: '', width: 0, first: false, hits: [{ p: '/', e: false }] }).subject).toBe('aryanh.dev visit · Unknown location · direct');
  });
});
