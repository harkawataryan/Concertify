import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { parseLatLng, haversineMiles } from '../lib/geo.js';
import { buildTasteProfile } from '../services/taste.js';
import { recommendEvents } from '../services/recommender.js';
import { TIME_RANGES } from '../services/spotify.js';

const FEEDBACK_TTL_SEC = 30 * 24 * 3600;
const MAX_RADIUS_MI = 150;

export function apiRouter({ spotify, ticketmaster, cache }) {
  const router = express.Router();
  const auth = requireAuth(spotify);

  const feedbackKey = (userId) => `feedback:${userId}`;
  const loadFeedback = async (userId) => (await cache.get(feedbackKey(userId))) || { artists: {}, genres: {} };

  router.get('/me', auth, (req, res) => {
    res.json({ id: req.user.id, displayName: req.user.displayName });
  });

  router.get('/me/top-artists', auth, async (req, res, next) => {
    try {
      const timeRange = TIME_RANGES.includes(req.query.time_range) ? req.query.time_range : 'medium_term';
      const artists = await spotify.getTopArtists(req.user.accessToken, { userId: req.user.id, timeRange });
      res.json(artists);
    } catch (err) {
      next(err);
    }
  });

  /** Upcoming shows anywhere for the user's top artists, nearest first when a location is given. */
  router.get('/concerts', auth, async (req, res, next) => {
    try {
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
    } catch (err) {
      next(err);
    }
  });

  /**
   * Ranked local shows. Requires lat/lng; radius defaults to 50 miles.
   * Returns the ranked list, a "new to you" artist list, and the scoring
   * breakdown for each result so the UI can show why it was picked.
   */
  router.get('/recommendations', auth, async (req, res, next) => {
    try {
      const origin = parseLatLng(req.query.lat, req.query.lng);
      if (!origin) return res.status(400).json({ error: 'lat and lng query params are required' });
      const radiusMiles = Math.min(MAX_RADIUS_MI, Math.max(5, Number(req.query.radius) || 50));
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

      const [topByRange, feedback, events] = await Promise.all([
        spotify.getTopArtistsAllRanges(req.user.accessToken, { userId: req.user.id }),
        loadFeedback(req.user.id),
        ticketmaster.eventsNear(origin, { radiusMiles })
      ]);

      const profile = buildTasteProfile(topByRange, feedback);
      const likedArtists = new Set(Object.entries(feedback.artists).filter(([, s]) => s > 0).map(([id]) => id));

      const resolveArtist = async (attraction) => {
        if (attraction.spotifyId) return spotify.getArtist(req.user.accessToken, attraction.spotifyId).catch(() => null);
        return spotify.findArtistByName(req.user.accessToken, attraction.name).catch(() => null);
      };

      const result = await recommendEvents({ events, profile, origin, resolveArtist, limit, likedArtists });
      return res.json({ ...result, profile: { topGenres: profile.topGenres, artistCount: profile.artists.size }, radiusMiles });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/feedback', auth, async (req, res, next) => {
    try {
      res.json(await loadFeedback(req.user.id));
    } catch (err) {
      next(err);
    }
  });

  /** Thumbs up/down on an artist or genre. signal: 1, -1, or 0 to clear. */
  router.post('/feedback', auth, async (req, res, next) => {
    try {
      const { type, id, signal } = req.body || {};
      if (!['artist', 'genre'].includes(type) || typeof id !== 'string' || ![1, -1, 0].includes(signal)) {
        return res.status(400).json({ error: 'expected {type: "artist"|"genre", id: string, signal: 1|-1|0}' });
      }
      const current = await loadFeedback(req.user.id);
      const bucket = type === 'artist' ? current.artists : current.genres;
      if (signal === 0) delete bucket[id];
      else bucket[id] = signal;
      await cache.set(feedbackKey(req.user.id), current, FEEDBACK_TTL_SEC);
      return res.json(current);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
