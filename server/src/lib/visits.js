import { createHash, randomBytes } from 'node:crypto';

/**
 * Live visit log for aryanh.dev.
 *
 * The portfolio site sends one beacon per page view and per custom event.
 * Hits are grouped into visits by a session id derived from the visitor's
 * IP and user agent with a salt that changes daily, the same cookieless
 * approach GoatCounter uses. The raw IP is never stored: it's hashed for the
 * session id, hashed again for the geo cache, and dropped.
 *
 * Visits live in Redis when it's available (a year, capped at 5,000) and in memory
 * otherwise. The record shape matches what the hourly emailer writes, so the
 * dashboard reads both the same way.
 */

const VISIT_TTL_SEC = 365 * 24 * 3600;
const GEO_TTL_SEC = 24 * 3600;
const SEEN_TTL_SEC = 30 * 24 * 3600;
const MAX_VISITS = 5000;
const PREFIX = 'visits:';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** In-memory store with the same interface as the Redis one. */
export class MemoryVisitStore {
  constructor() { this.visits = new Map(); this.geo = new Map(); this.seen = new Set(); this.salts = new Map(); }
  async salt(day) {
    if (!this.salts.has(day)) this.salts.set(day, randomBytes(16).toString('hex'));
    return this.salts.get(day);
  }
  async getVisit(id) { return this.visits.get(id) || null; }
  async putVisit(v) {
    this.visits.set(v.id, v);
    if (this.visits.size > MAX_VISITS) {
      const oldest = [...this.visits.values()].sort((a, b) => a.start < b.start ? -1 : 1).slice(0, this.visits.size - MAX_VISITS);
      for (const o of oldest) this.visits.delete(o.id);
    }
  }
  async listSince(sinceMs, limit) {
    return [...this.visits.values()].filter((v) => Date.parse(v.end) >= sinceMs).sort((a, b) => a.start < b.start ? 1 : -1).slice(0, limit);
  }
  async getGeo(h) { return this.geo.get(h) ?? null; }
  async setGeo(h, loc) { this.geo.set(h, loc); }
  /** True the first time a visitor hash is seen. */
  async markSeen(h) { if (this.seen.has(h)) return false; this.seen.add(h); return true; }
  // Visits waiting for their notification email, by due time.
  async schedule(id, dueMs) { (this.due ||= new Map()).set(id, dueMs); }
  async unschedule(id) { this.due?.delete(id); }
  async dueBy(nowMs) { return [...(this.due || new Map())].filter(([, d]) => d <= nowMs).map(([id]) => id); }
}

export class RedisVisitStore {
  constructor(client) { this.c = client; }
  async salt(day) {
    const k = `${PREFIX}salt:${day}`;
    await this.c.set(k, randomBytes(16).toString('hex'), 'EX', 2 * 24 * 3600, 'NX');
    return this.c.get(k);
  }
  async getVisit(id) { const raw = await this.c.get(`${PREFIX}v:${id}`); return raw ? JSON.parse(raw) : null; }
  async putVisit(v) {
    await this.c.set(`${PREFIX}v:${v.id}`, JSON.stringify(v), 'EX', VISIT_TTL_SEC);
    await this.c.zadd(`${PREFIX}idx`, Date.parse(v.end), v.id);
    // Keep the index bounded; the visit keys themselves expire on their own.
    await this.c.zremrangebyrank(`${PREFIX}idx`, 0, -(MAX_VISITS + 1));
  }
  async listSince(sinceMs, limit) {
    const ids = await this.c.zrevrangebyscore(`${PREFIX}idx`, '+inf', sinceMs, 'LIMIT', 0, limit);
    if (!ids.length) return [];
    const raws = await this.c.mget(ids.map((id) => `${PREFIX}v:${id}`));
    return raws.filter(Boolean).map((r) => JSON.parse(r));
  }
  async getGeo(h) { return this.c.get(`${PREFIX}geo:${h}`); }
  async setGeo(h, loc) { await this.c.set(`${PREFIX}geo:${h}`, loc, 'EX', GEO_TTL_SEC); }
  async markSeen(h) { return (await this.c.set(`${PREFIX}seen:${h}`, '1', 'EX', SEEN_TTL_SEC, 'NX')) === 'OK'; }
  async schedule(id, dueMs) { await this.c.zadd(`${PREFIX}due`, dueMs, id); }
  async unschedule(id) { await this.c.zrem(`${PREFIX}due`, id); }
  async dueBy(nowMs) { return this.c.zrangebyscore(`${PREFIX}due`, '-inf', nowMs, 'LIMIT', 0, 50); }
}

export function createVisitStore(redisClient) {
  return redisClient ? new RedisVisitStore(redisClient) : new MemoryVisitStore();
}

/** Browser and OS the way the dashboard shows them, e.g. "Chrome 130", "macOS". */
export const isBot = (ua = '') => !ua || /bot|crawl|spider|slurp|curl|python|wget|headless|lighthouse|phantom|puppeteer|playwright|preview|monitor|uptime/i.test(ua);

export function parseUserAgent(ua = '') {
  if (isBot(ua)) return { browser: 'Bot', system: '' };
  let browser = '';
  const pick = (re, name) => { const m = ua.match(re); if (m && !browser) browser = name + (m[1] ? ' ' + m[1] : ''); };
  pick(/Edg(?:e|A|iOS)?\/(\d+)/, 'Edge');
  pick(/OPR\/(\d+)|Opera\/(\d+)/, 'Opera');
  pick(/SamsungBrowser\/(\d+)/, 'Samsung Internet');
  pick(/Firefox\/(\d+)|FxiOS\/(\d+)/, 'Firefox');
  pick(/CriOS\/(\d+)/, 'Chrome');
  pick(/Chrome\/(\d+)/, 'Chrome');
  if (!browser && /Safari\//.test(ua)) pick(/Version\/(\d+)/, 'Safari');
  let system = '';
  if (/iPhone|iPad|iPod/.test(ua)) system = 'iOS';
  else if (/Android/.test(ua)) system = 'Android';
  else if (/Windows/.test(ua)) system = 'Windows';
  else if (/Mac OS X|Macintosh/.test(ua)) system = 'macOS';
  else if (/CrOS/.test(ua)) system = 'ChromeOS';
  else if (/Linux/.test(ua)) system = 'Linux';
  return { browser, system };
}

const PRIVATE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80|0\.0\.0\.0)/;

/** Country and region as "US-TX", looked up through ip-api.com and cached by hashed IP. */
export async function lookupGeo(ip, { fetchImpl = fetch, timeoutMs = 1500 } = {}) {
  if (!ip || PRIVATE.test(ip)) return '';
  try {
    const res = await fetchImpl(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode,region`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return '';
    const j = await res.json();
    if (j.status !== 'success' || !j.countryCode) return '';
    return j.region ? `${j.countryCode}-${j.region}` : j.countryCode;
  } catch {
    return '';
  }
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * Records one hit and returns the updated visit. `hit` is the parsed beacon
 * body: { p, e, ref, w }. `secret` keys the visitor and geo hashes so they
 * can't be reversed from the stored data.
 */
export const SETTLE_AFTER_SUMMARY_MS = 90 * 1000;
export const SETTLE_IDLE_MS = 10 * 60 * 1000;

export async function recordHit({ store, hit, ip, ua, secret, geo = lookupGeo, now = Date.now }) {
  if (isBot(ua)) return null;
  const t = now();
  const path = str(hit.p, 200) || '/';
  const salt = await store.salt(dayOf(t));
  const id = sha(`${salt}|${ip}|${ua}`).slice(0, 16);
  const ipHash = sha(`geo|${secret}|${ip}`).slice(0, 16);

  let v = await store.getVisit(id);
  const h = { t: new Date(t).toISOString(), p: path, e: !!hit.e };
  if (!v) {
    let loc = await store.getGeo(ipHash);
    if (loc == null) { loc = await geo(ip); await store.setGeo(ipHash, loc); }
    const { browser, system } = parseUserAgent(ua);
    const first = await store.markSeen(sha(`seen|${secret}|${ip}|${ua}`).slice(0, 16));
    v = { id, start: h.t, end: h.t, loc, ref: str(hit.ref, 300), browser, system, width: Number.isFinite(+hit.w) ? Math.max(0, Math.min(10000, Math.round(+hit.w))) : 0, first, hits: [h] };
  } else {
    // Same second, same path: a duplicate beacon (sendBeacon plus pagehide), skip it.
    const last = v.hits[v.hits.length - 1];
    if (!(last && last.p === h.p && last.e === h.e && Math.abs(Date.parse(last.t) - t) < 1000)) v.hits.push(h);
    if (v.hits.length > 200) v.hits = v.hits.slice(-200);
    v.end = h.t;
    if (!v.ref && hit.ref) v.ref = str(hit.ref, 300);
  }
  await store.putVisit(v);
  // Email once the visit looks finished: shortly after the page sends its
  // closing summary, or after ten quiet minutes if it never does. Ten
  // minutes also lands before Render's free tier spins the server down.
  if (!v.emailed) {
    const ended = v.hits.some((x) => x.e && x.p.startsWith('visit/'));
    await store.schedule(v.id, t + (ended ? SETTLE_AFTER_SUMMARY_MS : SETTLE_IDLE_MS));
  }
  return v;
}
