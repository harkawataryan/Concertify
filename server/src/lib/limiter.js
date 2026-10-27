/**
 * Outbound rate limiting for third-party APIs.
 *
 * A token bucket enforces an average request rate (Ticketmaster allows 5/s)
 * while still letting short bursts through, and a concurrency gate caps how
 * many requests are in flight at once so a single page load can't open fifty
 * sockets to the same upstream.
 */
export class TokenBucket {
  constructor({ ratePerSecond, burst = ratePerSecond, now = Date.now, sleep = defaultSleep }) {
    this.rate = ratePerSecond;
    this.capacity = burst;
    this.tokens = burst;
    this.lastRefill = now();
    this.now = now;
    this.sleep = sleep;
  }

  refill() {
    const t = this.now();
    const elapsedSec = (t - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.rate);
    this.lastRefill = t;
  }

  /** Resolves once a token is available, consuming it. */
  async take() {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil(((1 - this.tokens) / this.rate) * 1000);
      await this.sleep(waitMs);
    }
  }
}

export class ConcurrencyGate {
  constructor(max) {
    this.max = max;
    this.active = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.active < this.max) {
      this.active += 1;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
    this.active += 1;
  }

  release() {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

/** Wraps an async function so every call waits for both limiters. */
export function limited({ ratePerSecond, maxConcurrency, burst, now, sleep }) {
  const bucket = new TokenBucket({ ratePerSecond, burst, now, sleep });
  const gate = new ConcurrencyGate(maxConcurrency);
  return async function run(fn) {
    await gate.acquire();
    try {
      await bucket.take();
      return await fn();
    } finally {
      gate.release();
    }
  };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
