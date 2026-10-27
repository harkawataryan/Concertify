import { log } from '../lib/logger.js';

const REFRESH_SKEW_MS = 60_000;

/**
 * Requires a logged-in session and transparently refreshes the Spotify access
 * token when it's within a minute of expiring, so users stay signed in for
 * as long as the cookie lives instead of being bounced out every hour.
 */
export function requireAuth(spotify) {
  return async function auth(req, res, next) {
    const s = req.session;
    if (!s?.accessToken || !s?.userId) return res.status(401).json({ error: 'not_authenticated' });

    if (s.expiresAt && s.expiresAt - Date.now() < REFRESH_SKEW_MS) {
      if (!s.refreshToken) {
        req.session = null;
        return res.status(401).json({ error: 'session_expired' });
      }
      try {
        const t = await spotify.refreshAccessToken(s.refreshToken);
        s.accessToken = t.accessToken;
        s.expiresAt = t.expiresAt;
        if (t.refreshToken) s.refreshToken = t.refreshToken;
        log.info('refreshed spotify token', { userId: s.userId });
      } catch (err) {
        log.warn('token refresh failed; clearing session', { userId: s.userId, err: err.message });
        req.session = null;
        return res.status(401).json({ error: 'session_expired' });
      }
    }
    req.user = { id: s.userId, displayName: s.displayName, accessToken: s.accessToken };
    return next();
  };
}
