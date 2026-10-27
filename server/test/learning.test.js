import { describe, it, expect } from 'vitest';
import { fitWeights, toExample, MIN_EXAMPLES } from '../src/services/learning.js';
import { WEIGHTS } from '../src/services/recommender.js';

const ex = (features, label) => ({ features, label });

describe('fitWeights', () => {
  it('returns the global weights until there is enough feedback', () => {
    const out = fitWeights([ex({ direct: 1, genre: 0, proximity: 0.5, soon: 0.5 }, 1)]);
    expect(out.personalized).toBe(false);
    expect(out.weights).toEqual(WEIGHTS);
  });

  it('shifts weight toward the signal the user keeps rewarding', () => {
    // This user likes genre matches of artists they don't know, and dislikes
    // shows of their own top artists: genre should overtake direct.
    const examples = [];
    for (let i = 0; i < 12; i += 1) {
      examples.push(ex({ direct: 0, genre: 0.8, proximity: 0.9, soon: 0.8 }, 1));
      examples.push(ex({ direct: 0.9, genre: 0.1, proximity: 0.9, soon: 0.8 }, 0));
    }
    const { weights, personalized } = fitWeights(examples);
    expect(personalized).toBe(true);
    expect(weights.genre).toBeGreaterThan(weights.direct);
    expect(weights.genre).toBeGreaterThan(WEIGHTS.genre);
    const sum = Object.values(weights).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1, 2);
  });

  it('stays close to the prior when feedback agrees with it', () => {
    const examples = [];
    for (let i = 0; i < MIN_EXAMPLES + 3; i += 1) {
      examples.push(ex({ direct: 1, genre: 0.7, proximity: 0.8, soon: 0.8 }, 1));
      examples.push(ex({ direct: 0, genre: 0.1, proximity: 0.8, soon: 0.8 }, 0));
    }
    const { weights } = fitWeights(examples);
    expect(weights.direct).toBeGreaterThan(weights.genre);
    expect(Math.abs(weights.direct - WEIGHTS.direct)).toBeLessThan(0.25);
  });

  it('never produces negative weights', () => {
    const examples = Array.from({ length: 20 }, (_, i) => ex({ direct: 0, genre: 0, proximity: 1, soon: 1 }, i % 2));
    const { weights } = fitWeights(examples);
    for (const v of Object.values(weights)) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe('toExample', () => {
  it('captures the four features and a binary label', () => {
    const e = toExample({ direct: 0.9, genre: 0.2, proximity: 0.8, soon: 0.5, extra: 1 }, -1, '2026-11-01T00:00:00Z');
    expect(e).toEqual({ features: { direct: 0.9, genre: 0.2, proximity: 0.8, soon: 0.5 }, label: 0, at: '2026-11-01T00:00:00Z' });
  });
});
