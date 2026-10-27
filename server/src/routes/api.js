import express from 'express';
import crypto from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { parseLatLng, haversineMiles } from '../lib/geo.js';
import { buildTasteProfile } from '../services/taste.js';
import { enrichGenres } from '../services/genres.js';
import { recommendEvents } from '../services/recommender.js';
import { parseFilters, applyFilters, availableGenres } from '../services/filters.js';
import { rankForGroup } from '../services/group.js';
import { checkAlertsForUser } from '../services/alerts.js';
import { eventToIcs } from '../services/calendar.js';
import { TIME_RANGES } from '../services/spotify.js';

const MAX_RADIUS_MI = 150;
// How long a request waits for cold genre lookups before ranking with what it has.
const ENRICH_BUDGET_MS = 2500;
const MAX_PLAN_MEMBERS = 12;
const MAX_WATCHLIST = 100;

/**
 * Loads the user's top artists with genres filled in. Called at login to
 * warm the cache (no budget) and per request (with a budget).
 */
export function loadListeningProfile({ spotify, ticketmaster }, { accessToken, userId, id }, opts) {
  return spotify.getTopArtistsAllRanges(accessToken, { userId: userId || id })
    .then((ranges) => enrichGenres(ranges, ticketmaster, opts));
}

/** Performers resolve from Ticketmaster data alone; see docs/API.md and the recommender notes. */
function attractionToArtist(attraction) {
  return {
    id: attraction.spotifyId || `tm:${attraction.id}`,
    name: attraction.name,
    genres: attraction.genres,
    image: null,
    url: attraction.spotifyId ? `https://open.spotify.com/artist/${attraction.spotifyId}` : null
  };
}

const resolveArtist = async (attraction) => attractionToArtist(attraction);

/** 8 lowercase alphanumerics (no ambiguous 0/o/1/l): ~2^37 codes, easy to read aloud. */
function shareCode() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(8);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

function parseRadius(value) {
  return Math.min(MAX_RADIUS_MI, Math.max(5, Number(value) || 50));
}

function slimArtistForStore(a) {
  return { id: a.id, name: a.name, genres: a.genres || [], image: a.image || null, url: a.url || null };
}

/** Trims a listening profile to what group ranking needs; it's stored per plan member. */
function snapshotProfile(topByRange) {
  const out = {};
  for (const [range, list] of Object.entries(topByRange)) {
    out[range] = (list || []).map((a) => ({ id: a.id, name: a.name, genres: a.genres || [] }));
  }
  return out;
}

function publicPlan(plan) {
  return {
    code: plan.code,
    name: plan.name,
    ownerId: plan.ownerId,
    createdAt: plan.createdAt,
    members: Object.values(plan.members).map((m) => ({
      id: m.id, displayName: m.displayName, joinedAt: m.joinedAt, topGenres: m.topGenres
    }))
  };
}

export function apiRouter({ spotify, ticketmaster, store }) {
  const router = express.Router();
  const auth = requireAuth(spotify);
  const deps = { spotify, ticketmaster };

  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

  async function watchlistResponse(user) {
    const artists = Object.values(user.watchlist).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    const nextShows = await Promise.all(artists.map(async (a) => {
      const events = await ticketmaster.eventsForArtist(a.name);
      const today = new Date().toISOString().slice(0, 10);
      return events.find((e) => !e.date || e.date >= today) || null;
    }));
    return { artists: artists.map((a, i) => ({ ...a, nextShow: nextShows[i] })) };
  }

  function alertsResponse(user) {
    return { alerts: user.alerts, unread: user.alerts.filter((a) => !a.read).length };
  }

  // ---- me -----------------------------------------------------------------

  router.get('/me', auth, wrap(async (req, res) => {
    const user = await store.getUser(req.user.id);
    res.json({
      id: req.user.id,
      displayName: req.user.displayName,
      location: user.location,
      watchlistCount: Object.keys(user.watchlist).length,
      unreadAlerts: user.alerts.filter((a) => !a.read).length
    });
  }));

  router.put('/me/location', auth, wrap(async (req, res) => {
    const { name, lat, lng, radius } = req.body || {};
    const point = parseLatLng(lat, lng);
    if (!point || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'expected {name, lat, lng, radius}' });
    }
    const location = { name: name.trim().slice(0, 80), ...point, radius: parseRadius(radius) };
    await store.updateUser(req.user.id, (u) => { u.location = location; u.displayName = req.user.displayName; });
    return res.json({ location });
  }));

  router.get('/me/top-artists', auth, wrap(async (req, res) => {
    const timeRange = TIME_RANGES.includes(req.query.time_range) ? req.query.time_range : 'medium_term';
    res.json(await spotify.getTopArtists(req.user.accessToken, { userId: req.user.id, timeRange }));
  }));

  router.get('/me/taste', auth, wrap(async (req, res) => {
    const topByRange = await loadListeningProfile(deps, req.user, { budgetMs: ENRICH_BUDGET_MS });
    const profile = buildTasteProfile(topByRange);
    const max = Math.max(1e-9, ...profile.genres.exact.values());
    const topGenres = [...profile.genres.exact.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([genre, w]) => ({ genre, weight: Math.round((w / max) * 1000) / 1000 }));
    const windows = Object.fromEntries(TIME_RANGES.map((r) => [r, (topByRange[r] || []).slice(0, 10)]));
    res.json({ topGenres, artistCount: profile.artists.size, windows });
  }));

  // ---- recommendations ----------------------------------------------------

  router.get('/concerts', auth, wrap(async (req, res) => {
    const origin = parseLatLng(req.query.lat, req.query.lng);
    const artists = await spotify.getTopArtists(req.user.accessToken, { userId: req.user.id, limit: 20 });
    const perArtist = await Promise.all(
      artists.map(async (a) => (await ticketmaster.eventsForArtist(a.name)).map((e) => ({ ...e, artist: a })))
    );
    const events = perArtist.flat().map((e) => ({
      ...e,
      distanceMi: origin && e.venue.lat != null ? Math.round(haversineMiles(origin, e.venue)) : null
    }));
    events.sort((a, b) => {
      if (origin && a.distanceMi !== b.distanceMi) return (a.distanceMi ?? Infinity) - (b.distanceMi ?? Infinity);
      return (a.date || '').localeCompare(b.date || '');
    });
    res.json({ events });
  }));

  router.get('/recommendations', auth, wrap(async (req, res) => {
    const origin = parseLatLng(req.query.lat, req.query.lng);
    if (!origin) return res.status(400).json({ error: 'lat and lng query params are required' });
    const radiusMiles = parseRadius(req.query.radius);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const filters = parseFilters(req.query);

    const [topByRange, user, allEvents] = await Promise.all([
      loadListeningProfile(deps, req.user, { budgetMs: ENRICH_BUDGET_MS }),
      store.getUser(req.user.id),
      ticketmaster.eventsNear(origin, { radiusMiles })
    ]);

    const { events, filteredOut } = applyFilters(allEvents, filters);
    const profile = buildTasteProfile(topByRange, user.feedback);
    const watchlistIds = new Set(Object.keys(user.watchlist));
    const likedArtists = new Set([
      ...watchlistIds,
      ...Object.entries(user.feedback.artists).filter(([, s]) => s > 0).map(([id]) => id)
    ]);

    const result = await recommendEvents({ events, profile, origin, resolveArtist, limit, likedArtists });
    const saved = (rec) => ({ ...rec, saved: Boolean(rec.artist && watchlistIds.has(rec.artist.id)) });
    return res.json({
      ...result,
      recommendations: result.recommendations.map(saved),
      profile: { topGenres: profile.topGenres, artistCount: profile.artists.size },
      radiusMiles,
      filters,
      meta: { ...result.meta, filteredOut },
      availableGenres: availableGenres(allEvents)
    });
  }));

  // ---- watchlist ----------------------------------------------------------

  router.get('/watchlist', auth, wrap(async (req, res) => {
    res.json(await watchlistResponse(await store.getUser(req.user.id)));
  }));

  router.put('/watchlist/:artistId', auth, wrap(async (req, res) => {
    const body = req.body || {};
    if (typeof body.name !== 'string' || !body.name.trim()) return res.status(400).json({ error: 'artist name is required' });
    const user = await store.updateUser(req.user.id, (u) => {
      if (!u.watchlist[req.params.artistId] && Object.keys(u.watchlist).length >= MAX_WATCHLIST) {
        throw Object.assign(new Error('watchlist full'), { status: 400 });
      }
      u.watchlist[req.params.artistId] = {
        ...slimArtistForStore({ ...body, id: req.params.artistId }),
        addedAt: u.watchlist[req.params.artistId]?.addedAt || new Date().toISOString()
      };
    });
    return res.json(await watchlistResponse(user));
  }));

  router.delete('/watchlist/:artistId', auth, wrap(async (req, res) => {
    const user = await store.updateUser(req.user.id, (u) => { delete u.watchlist[req.params.artistId]; });
    res.json(await watchlistResponse(user));
  }));

  // ---- alerts -------------------------------------------------------------

  router.get('/alerts', auth, wrap(async (req, res) => {
    res.json(alertsResponse(await store.getUser(req.user.id)));
  }));

  router.post('/alerts/read', auth, wrap(async (req, res) => {
    const { ids, all } = req.body || {};
    const set = new Set(Array.isArray(ids) ? ids : []);
    const user = await store.updateUser(req.user.id, (u) => {
      for (const a of u.alerts) if (all === true || set.has(a.id)) a.read = true;
    });
    res.json(alertsResponse(user));
  }));

  router.post('/alerts/refresh', auth, wrap(async (req, res) => {
    let created = 0;
    const user = await store.updateUser(req.user.id, async (u) => {
      created = await checkAlertsForUser(u, { ticketmaster });
    });
    res.json({ created, ...alertsResponse(user) });
  }));

  // ---- feedback -----------------------------------------------------------

  router.get('/feedback', auth, wrap(async (req, res) => {
    res.json((await store.getUser(req.user.id)).feedback);
  }));

  /** Thumbs up/down on an artist or genre. signal: 1, -1, or 0 to clear. */
  router.post('/feedback', auth, wrap(async (req, res) => {
    const { type, id, signal } = req.body || {};
    if (!['artist', 'genre'].includes(type) || typeof id !== 'string' || ![1, -1, 0].includes(signal)) {
      return res.status(400).json({ error: 'expected {type: "artist"|"genre", id: string, signal: 1|-1|0}' });
    }
    const user = await store.updateUser(req.user.id, (u) => {
      const bucket = type === 'artist' ? u.feedback.artists : u.feedback.genres;
      if (signal === 0) delete bucket[id];
      else bucket[id] = signal;
    });
    return res.json(user.feedback);
  }));

  // ---- group plans --------------------------------------------------------

  async function memberRecord(req) {
    const topByRange = await loadListeningProfile(deps, req.user, { budgetMs: ENRICH_BUDGET_MS });
    const profile = buildTasteProfile(topByRange);
    return {
      id: req.user.id,
      displayName: req.user.displayName || 'Someone',
      joinedAt: new Date().toISOString(),
      topGenres: profile.topGenres.slice(0, 5),
      topByRange: snapshotProfile(topByRange)
    };
  }

  router.post('/plans', auth, wrap(async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : '';
    if (!name) return res.status(400).json({ error: 'plan name is required' });
    const member = await memberRecord(req);
    const plan = {
      code: shareCode(),
      name,
      ownerId: req.user.id,
      createdAt: new Date().toISOString(),
      members: { [member.id]: member }
    };
    await store.setPlan(plan);
    await store.updateUser(req.user.id, (u) => { u.plans = [...new Set([...u.plans, plan.code])]; });
    return res.status(201).json(publicPlan(plan));
  }));

  router.get('/plans', auth, wrap(async (req, res) => {
    const user = await store.getUser(req.user.id);
    const plans = (await Promise.all(user.plans.map((code) => store.getPlan(code)))).filter(Boolean);
    res.json({ plans: plans.map(publicPlan) });
  }));

  /** Opening a plan link joins you to it; your taste snapshot is refreshed each time. */
  router.get('/plans/:code', auth, wrap(async (req, res) => {
    const plan = await store.getPlan(req.params.code);
    if (!plan) return res.status(404).json({ error: 'plan not found' });
    if (!plan.members[req.user.id] && Object.keys(plan.members).length >= MAX_PLAN_MEMBERS) {
      return res.status(400).json({ error: 'plan is full' });
    }
    const existing = plan.members[req.user.id];
    const member = await memberRecord(req);
    plan.members[req.user.id] = existing ? { ...member, joinedAt: existing.joinedAt } : member;
    await store.setPlan(plan);
    await store.updateUser(req.user.id, (u) => { u.plans = [...new Set([...u.plans, plan.code])]; });
    return res.json(publicPlan(plan));
  }));

  router.delete('/plans/:code/members/me', auth, wrap(async (req, res) => {
    const plan = await store.getPlan(req.params.code);
    if (plan) {
      delete plan.members[req.user.id];
      await store.setPlan(plan);
    }
    await store.updateUser(req.user.id, (u) => { u.plans = u.plans.filter((c) => c !== req.params.code); });
    res.json({ ok: true });
  }));

  router.get('/plans/:code/recommendations', auth, wrap(async (req, res) => {
    const plan = await store.getPlan(req.params.code);
    if (!plan || !plan.members[req.user.id]) return res.status(404).json({ error: 'plan not found' });
    const origin = parseLatLng(req.query.lat, req.query.lng);
    if (!origin) return res.status(400).json({ error: 'lat and lng query params are required' });
    const radiusMiles = parseRadius(req.query.radius);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

    const [events, user] = await Promise.all([
      ticketmaster.eventsNear(origin, { radiusMiles }),
      store.getUser(req.user.id)
    ]);
    const ranked = await rankForGroup({ plan: publicPlanWithProfiles(plan), events, origin, resolveArtist, limit });
    const watchlistIds = new Set(Object.keys(user.watchlist));
    return res.json({
      plan: publicPlan(plan),
      recommendations: ranked.map((r) => ({ ...r, saved: Boolean(r.artist && watchlistIds.has(r.artist.id)) }))
    });
  }));

  function publicPlanWithProfiles(plan) {
    return { ...publicPlan(plan), members: Object.values(plan.members) };
  }

  // ---- calendar -----------------------------------------------------------

  router.get('/events/:id/calendar.ics', auth, wrap(async (req, res) => {
    const event = await ticketmaster.eventById(req.params.id);
    if (!event) return res.status(404).json({ error: 'event not found' });
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${event.id}.ics"`);
    return res.send(eventToIcs(event));
  }));

  return router;
}
