import express from 'express';
import crypto from 'node:crypto';
import { log } from '../lib/logger.js';

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
