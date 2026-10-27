import { describe, it, expect } from 'vitest';
import { TokenBucket, ConcurrencyGate, limited } from '../src/lib/limiter.js';

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms) => { t += ms; },
    advance: (ms) => { t += ms; }
  };
}

describe('TokenBucket', () => {
  it('allows a burst up to capacity then throttles to the configured rate', async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ ratePerSecond: 5, burst: 5, now: clock.now, sleep: clock.sleep });
    for (let i = 0; i < 5; i += 1) await bucket.take();
    expect(clock.now()).toBe(0);
    await bucket.take(); // sixth request must wait for one token: 200ms at 5/s
    expect(clock.now()).toBe(200);
    await bucket.take();
    expect(clock.now()).toBe(400);
  });

  it('refills while idle without exceeding capacity', async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ ratePerSecond: 5, burst: 5, now: clock.now, sleep: clock.sleep });
    for (let i = 0; i < 5; i += 1) await bucket.take();
    clock.advance(10_000);
    for (let i = 0; i < 5; i += 1) await bucket.take();
    expect(clock.now()).toBe(10_000);
    await bucket.take();
    expect(clock.now()).toBe(10_200);
  });
});

describe('ConcurrencyGate', () => {
  it('never lets more than max callers run at once', async () => {
    const gate = new ConcurrencyGate(2);
    let active = 0;
    let peak = 0;
    const work = async () => {
      await gate.acquire();
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      gate.release();
    };
    await Promise.all([work(), work(), work(), work(), work()]);
    expect(peak).toBe(2);
  });
});

describe('ConcurrencyGate priority', () => {
  it('runs lower-priority-number waiters first regardless of arrival order', async () => {
    const gate = new ConcurrencyGate(1);
    const order = [];
    await gate.acquire(); // occupy the single slot
    const bg = gate.acquire(5).then(() => { order.push('background'); gate.release(); });
    const fg = gate.acquire(0).then(() => { order.push('foreground'); gate.release(); });
    gate.release();
    await Promise.all([bg, fg]);
    expect(order).toEqual(['foreground', 'background']);
  });
});

describe('limited', () => {
  it('returns the wrapped function result and releases on error', async () => {
    const run = limited({ ratePerSecond: 100, maxConcurrency: 1 });
    await expect(run(async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(await run(async () => 42)).toBe(42);
  });
});
