import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { parseLatLng } from '../lib/geo.js';
import { buildTasteProfile } from '../services/taste.js';
import { enrichGenres } from '../services/genres.js';
import { recommendEvents } from '../services/recommender.js';
import { parseFilters, applyFilters, availableGenres } from '../services/filters.js';
import { resolveArtist } from './api.js';

const MAX_ARTISTS = 5;
const MAX_RADIUS_MI = 150;
const ENRICH_BUDGET_MS = 2500;
const RESULT_TTL_SEC = 10 * 60;

/**
 * Login-free demo used by the portfolio site. A visitor names a few artists
 * and a city; the same ranker that serves logged-in users ranks the shows
 * near them. Everything is read-only and app-authenticated, so it never
 * touches Spotify's per-user allowlist.
 */
export function demoRouter({ spotify, ticketmaster, withCache, ranker = null, origins = [] }) {
  const router = express.Router();
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

  router.use(cors({ origin: origins, credentials: false, maxAge: 86400 }));
  router.use(rateLimit({ windowMs: 60_000, max: 40, standardHeaders: true, legacyHeaders: false }));

  router.get('/artists', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q.length < 2) return res.json({ artists: [] });
    const artists = await spotify.searchArtists(q, { limit: 6 });
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ artists: artists.map((a) => ({ id: a.id, name: a.name, image: a.image })) });
  }));

  router.get('/recommendations', wrap(async (req, res) => {
    const ids = String(req.query.artists || '').split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9]{22}$/.test(s)).slice(0, MAX_ARTISTS);
    const origin = parseLatLng(req.query.lat, req.query.lng);
    if (!ids.length || !origin) return res.status(400).json({ error: 'expected artists=<spotify ids> and lat, lng' });
    const radiusMiles = Math.min(MAX_RADIUS_MI, Math.max(10, Number(req.query.radius) || 50));
    const limit = Math.min(10, Math.max(1, Number(req.query.limit) || 5));
    const filters = parseFilters(req.query);

    const key = `demo:${[...ids].sort().join(',')}:${origin.lat.toFixed(2)},${origin.lng.toFixed(2)}:${radiusMiles}:${limit}:${JSON.stringify(filters)}`;
    const out = await withCache(key, RESULT_TTL_SEC, async () => {
      const token = await spotify.appToken();
      const [artists, allEvents] = await Promise.all([
        Promise.all(ids.map((id) => spotify.getArtist(token, id).catch(() => null))),
        ticketmaster.eventsNear(origin, { radiusMiles })
      ]);
      const listed = artists.filter(Boolean);
      if (!listed.length) return { error: 'no such artists' };
      const { events, filteredOut } = applyFilters(allEvents, filters);
      const topByRange = await enrichGenres({ short_term: listed, medium_term: listed }, ticketmaster, { budgetMs: ENRICH_BUDGET_MS });
      const profile = buildTasteProfile(topByRange);
      const result = await recommendEvents({ events, profile, origin, resolveArtist, limit, ranker });
      return {
        artists: listed.map((a) => ({ id: a.id, name: a.name, image: a.image })),
        scanned: allEvents.length,
        filteredOut,
        radiusMiles,
        genres: availableGenres(allEvents, 12),
        recommendations: result.recommendations.map((r) => ({
          affinity: r.affinity,
          reasons: r.reasons,
          components: r.components,
          artist: r.artist ? { name: r.artist.name, image: r.artist.image } : null,
          moreDates: (r.moreDates || []).length,
          event: {
            id: r.event.id,
            name: r.event.name,
            date: r.event.date,
            url: r.event.url,
            image: r.event.image,
            venue: r.event.venue?.name,
            city: r.event.venue?.city,
            distanceMi: r.distanceMi
          }
        }))
      };
    });
    if (out.error) return res.status(404).json(out);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(out);
  }));

  return router;
}
