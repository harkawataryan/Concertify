import express from 'express';
import crypto from 'node:crypto';
import { log } from '../lib/logger.js';

const SCOPES = ['user-top-read'];

export function authRouter({ spotify, frontendUrl }) {
  const router = express.Router();

  router.get('/login', (req, res) => {
    // Random, unguessable state is what makes the OAuth flow CSRF-safe.
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
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
      req.session = {
        userId: profile.id,
        displayName: profile.displayName,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt
      };
      log.info('user logged in', { userId: profile.id });
      return res.redirect(frontendUrl);
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
