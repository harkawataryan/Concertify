import express from 'express';
import axios from 'axios';
import qs from 'qs';

const router = express.Router();

const scopes = [
  'user-top-read'
].join(' ');

router.get('/login', (req, res) => {
  // yes, we’re building the URL by hand; it’s fine
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID,
    scope: scopes,
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
    state: Math.random().toString(36).slice(2)
  });
  req.session.state = params.get('state');
  res.redirect('https://accounts.spotify.com/authorize?' + params.toString());
});

router.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || state !== req.session.state) {
    return res.status(400).send('weird auth state');
  }
  try {
    const tokenRes = await axios.post('https://accounts.spotify.com/api/token',
      qs.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
        client_id: process.env.SPOTIFY_CLIENT_ID,
        client_secret: process.env.SPOTIFY_CLIENT_SECRET
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
    req.session.access_token = tokenRes.data.access_token;
    req.session.refresh_token = tokenRes.data.refresh_token;
    // shrug, just bounce to frontend
    res.redirect((process.env.FRONTEND_URL || 'http://localhost:5173') + '/#ok');
  } catch (e) {
    console.error('token exchange failed', e.response?.data || e.message);
    res.status(500).send('auth borked');
  }
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

export default router;
