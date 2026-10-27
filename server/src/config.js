import dotenv from 'dotenv';

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`Env var ${name} must be an integer, got "${raw}"`);
  return n;
}

export function loadConfig(env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  // Hosts such as Render expose the service's public URL; when the client is
  // served from the same origin, that URL is both the frontend and the
  // OAuth callback host, so neither needs to be configured by hand.
  const publicUrl = (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  return {
    isProd,
    port: int('PORT', 8088),
    publicUrl,
    frontendUrl: env.FRONTEND_URL || publicUrl || 'http://127.0.0.1:5173',
    clientDist: env.CLIENT_DIST || null,
    sessionSecret: isProd ? required('SESSION_SECRET') : env.SESSION_SECRET || 'dev-only-session-secret',
    spotify: {
      clientId: required('SPOTIFY_CLIENT_ID'),
      clientSecret: required('SPOTIFY_CLIENT_SECRET'),
      redirectUri: env.SPOTIFY_REDIRECT_URI || `${publicUrl || 'http://127.0.0.1:8088'}/auth/callback`
    },
    ticketmaster: {
      apiKey: required('TICKETMASTER_API_KEY'),
      // Ticketmaster's published Discovery API quota is 5 requests/second.
      requestsPerSecond: int('TM_RPS', 5),
      maxConcurrency: int('TM_CONCURRENCY', 3)
    },
    redisUrl: env.REDIS_URL || null,
    cache: {
      maxEntries: int('CACHE_MAX_ENTRIES', 5000)
    },
    rateLimit: {
      windowMs: int('RATE_LIMIT_WINDOW_MS', 60_000),
      max: int('RATE_LIMIT_MAX', 60)
    }
  };
}
