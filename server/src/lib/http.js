import axios from 'axios';
import { log } from './logger.js';
import { upstreamRequests } from './metrics.js';

export class UpstreamError extends Error {
  constructor(message, { status, upstream, retryable }) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.upstream = upstream;
    this.retryable = retryable;
  }
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function isRetryable(err) {
  if (err.response) return RETRYABLE_STATUSES.has(err.response.status);
  // No response at all: timeout, DNS, reset. Worth one more try.
  return Boolean(err.request) || err.code === 'ECONNABORTED';
}

function retryAfterMs(err) {
  const header = err.response?.headers?.['retry-after'];
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/**
 * Runs an axios request with exponential backoff and full jitter. Honors
 * Retry-After on 429s so we back off exactly as long as the upstream asks,
 * instead of hammering it with a fixed schedule.
 */
export async function requestWithRetry(config, {
  retries = 3,
  baseDelayMs = 250,
  maxDelayMs = 4000,
  upstream = 'upstream',
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random
} = {}) {
  let attempt = 0;
  for (;;) {
    try {
      const res = await axios({ timeout: 8000, ...config });
      upstreamRequests.inc({ upstream, status: res.status });
      return res;
    } catch (err) {
      const status = err.response?.status;
      upstreamRequests.inc({ upstream, status: status || 'network' });
      const retryable = isRetryable(err);
      if (!retryable || attempt >= retries) {
        throw new UpstreamError(`${upstream} request failed${status ? ` (${status})` : ''}`, {
          status, upstream, retryable
        });
      }
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt) * random();
      const delay = retryAfterMs(err) ?? backoff;
      log.warn('retrying upstream request', { upstream, status, attempt: attempt + 1, delayMs: Math.round(delay) });
      await sleep(delay);
      attempt += 1;
    }
  }
}
