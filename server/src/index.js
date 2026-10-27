import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import cookieSession from 'cookie-session';
import rateLimit from 'express-rate-limit';
import { loadConfig } from './config.js';
import { log } from './lib/logger.js';
import { createCache, cached } from './lib/cache.js';
import { limited } from './lib/limiter.js';
import { UpstreamError } from './lib/http.js';
import { createSpotifyClient } from './services/spotify.js';
import { createTicketmasterClient } from './services/ticketmaster.js';
import { authRouter } from './routes/auth.js';
import { apiRouter } from './routes/api.js';

export async function createApp(config) {
  const cache = await createCache({ redisUrl: config.redisUrl, maxEntries: config.cache.maxEntries });
  const withCache = cached(cache);

  // Spotify publishes no hard quota but 429s bursts; keep lookups polite.
  const spotify = createSpotifyClient({
    ...config.spotify,
    withCache,
    limit: limited({ ratePerSecond: 8, maxConcurrency: 4 })
  });
  const ticketmaster = createTicketmasterClient({
    apiKey: config.ticketmaster.apiKey,
    withCache,
    limit: limited({
      ratePerSecond: config.ticketmaster.requestsPerSecond,
      maxConcurrency: config.ticketmaster.maxConcurrency
    })
  });

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '10kb' }));
  app.use(cors({ origin: config.frontendUrl, credentials: true }));
  app.use(cookieSession({
    name: 'concertify.sid',
    secret: config.sessionSecret,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd
  }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/auth', authRouter({ spotify, frontendUrl: config.frontendUrl }));
  app.use('/api', rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.session?.userId || req.ip
  }));
  app.use('/api', apiRouter({ spotify, ticketmaster, cache }));

  // In production the built client is served from the same origin as the
  // API, so the session cookie is first-party and no CORS is involved.
  if (config.clientDist && fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    app.use(express.static(config.clientDist, { maxAge: '1h', index: false }));
    app.get(/^(?!\/(api|auth|assets)\/).*/, (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
    log.info('serving client', { dir: config.clientDist });
  }

  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof UpstreamError) {
      log.warn('upstream failure', { upstream: err.upstream, status: err.status, path: req.path });
      const status = err.status === 429 ? 429 : 502;
      return res.status(status).json({ error: 'upstream_unavailable', upstream: err.upstream });
    }
    log.error('unhandled error', { err: err.stack || err.message, path: req.path });
    return res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  const config = loadConfig();
  createApp(config)
    .then((app) => app.listen(config.port, () => log.info('server listening', { port: config.port })))
    .catch((err) => {
      log.error('failed to start', { err: err.stack || err.message });
      process.exit(1);
    });
}
