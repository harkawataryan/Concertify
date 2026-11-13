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
  // The visit a browser's visitor id is currently in, until 30 quiet minutes pass.
  async currentSession(vid, nowMs) { const s = (this.sessions ||= new Map()).get(vid); return s && s.until > nowMs ? s.id : null; }
  async touchSession(vid, id, nowMs, ttlSec) { (this.sessions ||= new Map()).set(vid, { id, until: nowMs + ttlSec * 1000 }); }
  // Visits waiting for their notification email, by due time.
  async schedule(id, dueMs) { (this.due ||= new Map()).set(id, dueMs); }
  async unschedule(id) { this.due?.delete(id); }
  async dueBy(nowMs) { return [...(this.due || new Map())].filter(([, d]) => d <= nowMs).map(([id]) => id); }
  // When this log started recording. Kept forever.
  async since(nowMs) { return (this.started ||= nowMs); }
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
  async markSeen(h, ttlSec = SEEN_TTL_SEC) { return (await this.c.set(`${PREFIX}seen:${h}`, '1', 'EX', ttlSec, 'NX')) === 'OK'; }
  async currentSession(vid) { return this.c.get(`${PREFIX}cur:${vid}`); }
  async touchSession(vid, id, _nowMs, ttlSec) { await this.c.set(`${PREFIX}cur:${vid}`, id, 'EX', ttlSec); }
  async schedule(id, dueMs) { await this.c.zadd(`${PREFIX}due`, dueMs, id); }
  async unschedule(id) { await this.c.zrem(`${PREFIX}due`, id); }
  async dueBy(nowMs) { return this.c.zrangebyscore(`${PREFIX}due`, '-inf', nowMs, 'LIMIT', 0, 50); }
  async since(nowMs) {
    // A log that was already running before this was added starts at its
    // oldest visit, not at this deploy.
    const [, oldest] = await this.c.zrange(`${PREFIX}idx`, 0, 0, 'WITHSCORES');
    await this.c.set(`${PREFIX}since`, String(Math.min(nowMs, Number(oldest) || nowMs)), 'NX');
    return Number(await this.c.get(`${PREFIX}since`));
  }
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

/**
 * Phone, tablet or desktop. The user agent says it directly for most
 * devices. iPads report a Mac user agent, so a "Mac" with a touch screen is
 * an iPad. Screen width only decides when nothing else does.
 */
export function deviceKind(ua = '', width = 0, touchPoints = 0) {
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/Macintosh/i.test(ua) && touchPoints > 1) return 'tablet';
  if (/Mobi|iPhone|iPod|Windows Phone/i.test(ua)) return 'phone';
  if (/Windows|Macintosh|X11|CrOS|Linux/i.test(ua)) return 'desktop';
  if (!width) return 'unknown';
  return width < 700 ? 'phone' : width < 1100 ? 'tablet' : 'desktop';
}

// Hosting and cloud networks by name, for when ip-api isn't the provider that
// answered and there's no hosting flag.
const DATACENTER = /amazon|aws|google|microsoft|azure|digitalocean|linode|akamai|ovh|hetzner|vultr|oracle|alibaba|tencent|choopa|leaseweb|contabo|scaleway|cloudflare|fastly|m247|datacamp|hostinger|colocrossing/i;

const PRIVATE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80|0\.0\.0\.0)/;

const isPublic = (ip) => !!ip && !PRIVATE.test(ip) && !/^::ffff:(127|10|192\.168)\./.test(ip);

/**
 * The visitor's address. Render sits behind Cloudflare and its own proxy, so
 * req.ip (one trusted hop) can land on a proxy instead of the visitor.
 * Cloudflare's own header is the most reliable, then the first public
 * address in X-Forwarded-For, then req.ip.
 */
export function clientIp(req) {
  const h = (n) => (req.get?.(n) || req.headers?.[n] || '').trim();
  for (const n of ['cf-connecting-ip', 'true-client-ip']) if (isPublic(h(n))) return h(n);
  for (const part of h('x-forwarded-for').split(',')) {
    const ip = part.trim().replace(/^::ffff:/, '');
    if (isPublic(ip)) return ip;
  }
  return (req.ip || '').replace(/^::ffff:/, '');
}

// Outcome of recent lookups, for /api/visits/status. Never holds an IP.
export const geoStats = { ok: 0, failed: 0, lastError: null, lastErrorAt: null };
const fail = (why) => { geoStats.failed++; geoStats.lastError = why; geoStats.lastErrorAt = new Date().toISOString(); return ''; };

async function viaIpApi(ip, fetchImpl, timeoutMs) {
  const res = await fetchImpl(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode,region,hosting,org,isp,message`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`ip-api HTTP ${res.status}`);
  const j = await res.json();
  if (j.status !== 'success' || !j.countryCode) throw new Error(`ip-api ${j.message || 'no result'}`);
  return { loc: j.region ? `${j.countryCode}-${j.region}` : j.countryCode, dc: !!j.hosting || DATACENTER.test(`${j.org} ${j.isp}`) };
}
async function viaIpWho(ip, fetchImpl, timeoutMs) {
  const res = await fetchImpl(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country_code,region_code,connection,message`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`ipwho.is HTTP ${res.status}`);
  const j = await res.json();
  if (!j.success || !j.country_code) throw new Error(`ipwho.is ${j.message || 'no result'}`);
  return { loc: j.region_code ? `${j.country_code}-${j.region_code}` : j.country_code, dc: DATACENTER.test(`${j.connection?.org} ${j.connection?.isp}`) };
}

/**
 * Country and region as "US-TX", and whether the address belongs to a data
 * center or cloud host. Tries ip-api.com, then ipwho.is: Render's
 * outbound addresses are shared with many other services, so one free API's
 * per-IP limit can run out. Returns '' when neither answers.
 */
export async function lookupGeo(ip, { fetchImpl = fetch, timeoutMs = 2500 } = {}) {
  if (!isPublic(ip)) return fail(ip ? 'private or proxy address' : 'no address');
  const errors = [];
  for (const provider of [viaIpApi, viaIpWho]) {
    try {
      const found = await provider(ip, fetchImpl, timeoutMs);
      geoStats.ok++;
      return found;
    } catch (e) {
      errors.push(e.name === 'TimeoutError' ? `${provider === viaIpApi ? 'ip-api' : 'ipwho.is'} timeout` : e.message);
    }
  }
  return fail(errors.join('; '));
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const VID = /^[A-Za-z0-9]{12,40}$/;
const SECTION = /^[a-z][a-z0-9-]{0,30}$/;
const SESSION_GAP_SEC = 30 * 60;
const VISITOR_TTL_SEC = 400 * 24 * 3600;
// Old cache entries are a bare "US-TX"; newer ones are JSON with the data center flag.
const parseGeo = (raw) => (raw && raw[0] === '{' ? JSON.parse(raw) : raw ? { loc: raw, dc: false } : null);
const asGeo = (g) => (typeof g === 'string' ? { loc: g, dc: false } : g || { loc: '', dc: false });

export const SETTLE_AFTER_SUMMARY_MS = 90 * 1000;
export const SETTLE_AFTER_PING_MS = 2 * 60 * 1000;
export const SETTLE_IDLE_MS = 10 * 60 * 1000;

/** A data center visit that never scrolled, clicked or touched the page. */
export const isAutomated = (v) => !!(v && v.dc && !v.human);

/**
 * Records one beacon and returns the updated visit.
 *
 * A beacon is { p, e, ref, w, v, tp } for a page view or event, where `v` is
 * a random id the browser keeps in localStorage and `tp` its touch points.
 * Heartbeats add { k: 'ping', s, d, i }: seconds the page has been visible,
 * the deepest section reached, and whether the visitor has interacted.
 *
 * A visit is everything from one visitor id with gaps under 30 minutes. Old
 * cached pages send no id, and those fall back to IP plus user agent with a
 * salt that changes daily.
 */
export async function recordHit({ store, hit, ip, ua, secret, geo = lookupGeo, now = Date.now }) {
  if (isBot(ua)) return null;
  const t = now();
  const ping = hit.k === 'ping';
  const path = str(hit.p, 200) || '/';
  const vid = typeof hit.v === 'string' && VID.test(hit.v) ? hit.v : null;

  let id;
  if (vid) {
    id = (await store.currentSession(vid, t)) || sha(`visit|${secret}|${vid}|${t}`).slice(0, 16);
    await store.touchSession(vid, id, t, SESSION_GAP_SEC);
  } else {
    const salt = await store.salt(dayOf(t));
    id = sha(`${salt}|${ip}|${ua}`).slice(0, 16);
  }

  let v = await store.getVisit(id);
  const h = { t: new Date(t).toISOString(), p: path, e: !!hit.e };
  const activeS = Number.isFinite(+hit.s) ? Math.max(0, Math.min(86400, Math.round(+hit.s))) : 0;
  if (!v) {
    const ipHash = sha(`geo|${secret}|${ip}`).slice(0, 16);
    let g = parseGeo(await store.getGeo(ipHash));
    // Only cache answers: a failed lookup is retried on the next visit
    // instead of pinning that address to "Unknown location" for a day.
    if (!g) { g = asGeo(await geo(ip)); if (g.loc) await store.setGeo(ipHash, JSON.stringify(g)); }
    const { browser, system } = parseUserAgent(ua);
    const first = vid
      ? await store.markSeen(sha(`vid|${secret}|${vid}`).slice(0, 16), VISITOR_TTL_SEC)
      : await store.markSeen(sha(`seen|${secret}|${ip}|${ua}`).slice(0, 16));
    const width = Number.isFinite(+hit.w) ? Math.max(0, Math.min(10000, Math.round(+hit.w))) : 0;
    // A heartbeat can open a visit whose first beacon was lost while the
    // server woke up; it starts as far back as the page has been visible.
    const startT = ping && activeS ? new Date(t - activeS * 1000).toISOString() : h.t;
    v = {
      id, start: startT, end: h.t, loc: g.loc, dc: !!g.dc, ref: str(hit.ref, 300), browser, system, width,
      kind: deviceKind(ua, width, +hit.tp || 0), first, active: 0, deepest: null, human: false,
      hits: ping ? [] : [h]
    };
    if (vid) v.visitor = sha(`who|${secret}|${vid}`).slice(0, 12);
  } else if (!ping) {
    // Same second, same path: a duplicate beacon (visibilitychange plus pagehide), skip it.
    const last = v.hits[v.hits.length - 1];
    if (!(last && last.p === h.p && last.e === h.e && Math.abs(Date.parse(last.t) - t) < 1000)) v.hits.push(h);
    if (v.hits.length > 200) v.hits = v.hits.slice(-200);
    if (!v.ref && hit.ref) v.ref = str(hit.ref, 300);
  }
  v.end = h.t;
  if (activeS) v.active = Math.max(v.active || 0, activeS);
  if (typeof hit.d === 'string' && SECTION.test(hit.d)) v.deepest = hit.d;
  if (hit.i === true) v.human = true;
  await store.putVisit(v);

  // Email once the visit looks finished: shortly after the closing summary,
  // two minutes after the last heartbeat (they come every 30 seconds while
  // the page is open), or after ten quiet minutes for pages too old to send
  // heartbeats. Automated visits are never emailed.
  if (!v.emailed) {
    if (isAutomated(v)) await store.unschedule(v.id);
    else {
      const ended = v.hits.some((x) => x.e && x.p.startsWith('visit/'));
      await store.schedule(v.id, t + (ended ? SETTLE_AFTER_SUMMARY_MS : v.active ? SETTLE_AFTER_PING_MS : SETTLE_IDLE_MS));
    }
  }
  return v;
}
