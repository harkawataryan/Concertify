import express from 'express';
import axios from 'axios';
import { recommendArtists } from '../services/recommender.js';
import { findConcertsForArtists } from '../services/ticketmaster.js';

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session?.access_token) return res.status(401).json({ error: 'not logged in' });
  next();
}

router.get('/me/top-artists', requireAuth, async (req, res) => {
  try {
    const r = await axios.get('https://api.spotify.com/v1/me/top/artists', {
      headers: { Authorization: `Bearer ${req.session.access_token}` },
      params: { limit: 20, time_range: 'medium_term' }
    });
    res.json(r.data.items);
  } catch (e) {
    console.error('top artists fail', e.response?.data || e.message);
    res.status(500).json({ error: 'failed to get artists' });
  }
});

router.get('/concerts', requireAuth, async (req, res) => {
  try {
    const topRes = await axios.get('https://api.spotify.com/v1/me/top/artists', {
      headers: { Authorization: `Bearer ${req.session.access_token}` },
      params: { limit: 20, time_range: 'medium_term' }
    });
    const artists = topRes.data.items || [];
    const shows = await findConcertsForArtists(artists.map(a => a.name));
    res.json(shows);
  } catch (e) {
    console.error('concerts fail', e.response?.data || e.message);
    res.status(500).json({ error: 'failed to get concerts' });
  }
});

router.get('/recommendations', requireAuth, async (req, res) => {
  try {
    const recs = await recommendArtists(req.session.access_token);
    // filter to only artists with at least 1 upcoming show
    const withShows = await findConcertsForArtists(recs.map(r => r.name));
    const okNames = new Set(withShows.map(x => x.artist).filter(Boolean));
    const final = recs.filter(r => okNames.has(r.name)).slice(0, 10);
    res.json({ recommendations: final, concerts: withShows });
  } catch (e) {
    console.error('recs fail', e.response?.data || e.message);
    res.status(500).json({ error: 'failed to get recs' });
  }
});

export default router;
