import express from 'express';
import crypto from 'node:crypto';
import { log } from '../lib/logger.js';
import { allowlistConfigured, ensureAccess, isListed, isDailyCapError } from '../lib/spotifyAllowlist.js';

const SCOPES = ['user-top-read'];

export function authRouter({ spotify, frontendUrl, onLogin = () => {} }) {
  const router = express.Router();

  router.get('/login', (req, res) => {
    // Random, unguessable state is what makes the OAuth flow CSRF-safe.
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    // Only same-site paths may be returned to, never absolute URLs.
    const back = typeof req.query.return === 'string' && /^\/(?!\/)/.test(req.query.return) ? req.query.return : null;
    req.session.returnTo = back;
    res.redirect(spotify.authorizeUrl({ state, scopes: SCOPES }));
  });

  // Spotify's Development Mode only lets five listed accounts log in. When
  // the dashboard cookie is configured, a visitor gives the email on their
  // Spotify account, we add it (evicting the longest-listed one if the list is
  // full) and then send them into the normal login.
  const recentRequests = []; // timestamps, for a small global rate limit
  router.get('/access-mode', (_req, res) => res.json({ gated: allowlistConfigured() }));

  router.get('/request-access', async (req, res) => {
    const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';
    const back = typeof req.query.return === 'string' && /^\/(?!\/)/.test(req.query.return) ? req.query.return : '';
    const loginUrl = `/auth/login${back ? `?return=${encodeURIComponent(back)}` : ''}`;
    if (!allowlistConfigured()) return res.redirect(loginUrl);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.redirect(`${frontendUrl}/?access_error=${encodeURIComponent('Enter the email on your Spotify account.')}`);
    }
    const now = Date.now();
    while (recentRequests.length && recentRequests[0] < now - 60 * 60 * 1000) recentRequests.shift();
    if (recentRequests.length >= 20) {
      return res.redirect(`${frontendUrl}/?access_error=${encodeURIComponent('Too many access requests right now, try again in a bit.')}`);
    }
    recentRequests.push(now);
    try {
      const result = await ensureAccess(email, req.query.name?.toString().slice(0, 60) || 'Concertify visitor');
      log.info('allowlist updated', { email, ...result });
      // Give the dashboard a moment to propagate before Spotify checks the list.
      if (result.added) await new Promise((r) => setTimeout(r, 1500));
      return res.redirect(loginUrl);
    } catch (err) {
      log.warn('allowlist update failed', { email, err: err.message });
      // A duplicate submission can lose the race and still be fine.
      if (await isListed(email).catch(() => false)) return res.redirect(loginUrl);
      const msg = isDailyCapError(err)
        ? "Spotify only lets us add a few new listeners a day and today's are used up. Try again tomorrow, or email harkawat.aryan@gmail.com and I'll get you in."
        : "Couldn't get you set up right now. Email harkawat.aryan@gmail.com and I'll sort it out.";
      return res.redirect(`${frontendUrl}/?access_error=${encodeURIComponent(msg)}`);
    }
  });

  router.get('/callback', async (req, res, next) => {
    const { code, state, error } = req.query;
    if (error) return res.redirect(`${frontendUrl}/?auth_error=${encodeURIComponent(error)}`);
    if (!code || !state || state !== req.session?.oauthState) {
      return res.status(400).json({ error: 'invalid_oauth_state' });
    }
    try {
      const tokens = await spotify.exchangeCode(code);
      const profile = await spotify.getProfile(tokens.accessToken);
      const returnTo = req.session?.returnTo || '/';
      req.session = {
        userId: profile.id,
        displayName: profile.displayName,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt
      };
      log.info('user logged in', { userId: profile.id });
      // Fire and forget: warm the user's listening profile while they pick a location.
      Promise.resolve(onLogin({ accessToken: tokens.accessToken, userId: profile.id, displayName: profile.displayName }))
        .catch((err) => log.warn('profile warm-up failed', { userId: profile.id, err: err.message }));
      return res.redirect(frontendUrl + returnTo);
    } catch (err) {
      return next(err);
    }
  });

  router.post('/logout', (req, res) => {
    req.session = null;
    res.json({ ok: true });
  });

  return router;
}
