import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { timingSafeEqual } from 'node:crypto';
import { recordHit, lookupGeo, clientIp, geoStats } from '../lib/visits.js';

const MAX_LIST = 5000;

/**
 * Live visit log for the portfolio site's private dashboard.
 *
 *   POST /api/visits/hit   beacon from aryanh.dev, body is JSON sent as
 *                          text/plain so sendBeacon needs no preflight
 *   GET  /api/visits       the log, bearer-token protected. `since` (ms)
 *                          returns only visits active since then, so the
 *                          dashboard can poll cheaply
 *   GET  /api/visits/status public: whether this server is emailing visits
 *                          and since when it has been recording, which the
 *                          hourly backup job checks before sending its own
 *
 * Mounted only when VISITS_TOKEN is set, so nothing is collected unless
 * there's a way to read it.
 */
export function visitsRouter({ store, token, origins = [], geo = lookupGeo, now = Date.now, notifier = null }) {
  const router = express.Router();
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
  const tokenBuf = Buffer.from(token);
  const authed = (req) => {
    const m = /^Bearer\s+(.+)$/.exec(req.get('authorization') || '');
    if (!m) return false;
    const given = Buffer.from(m[1].trim());
    return given.length === tokenBuf.length && timingSafeEqual(given, tokenBuf);
  };

  router.use(cors({ origin: origins, credentials: false, allowedHeaders: ['Authorization', 'Content-Type'], maxAge: 86400 }));

  router.post('/hit',
    rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }),
    express.text({ type: () => true, limit: '2kb' }),
    wrap(async (req, res) => {
      let hit;
      try { hit = JSON.parse(req.body || '{}'); } catch { return res.status(400).end(); }
      if (!hit || typeof hit !== 'object') return res.status(400).end();
      await recordHit({ store, hit, ip: clientIp(req), ua: req.get('user-agent') || '', secret: token, geo, now });
      res.status(204).end();
      // A beacon is also the moment the server is surely awake.
      notifier?.sweep().catch(() => {});
    }));

  // Recorded the first time the log runs, so the backup job knows which
  // visits only GoatCounter could have seen.
  const since = store.since(now());

  router.get('/status', wrap(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, email: !!notifier, since: new Date(await since).toISOString(), geo: geoStats });
  }));

  router.get('/', wrap(async (req, res) => {
    if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });
    const since = Number(req.query.since) || 0;
    const limit = Math.min(MAX_LIST, Math.max(1, Number(req.query.limit) || MAX_LIST));
    const visits = await store.listSince(since, limit);
    res.set('Cache-Control', 'no-store');
    res.json({ updated: new Date(now()).toISOString(), visits });
  }));

  return router;
}
