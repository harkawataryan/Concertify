import { describe, it, expect, vi } from 'vitest';
import { createWeightFitter } from '../src/services/trainerClient.js';
import { fitWeights } from '../src/services/learning.js';
import { WEIGHTS } from '../src/services/recommender.js';

const examples = Array.from({ length: 12 }, (_, i) => ({
  features: i % 2 ? { direct: 0, genre: 0.8, proximity: 0.9, soon: 0.8 } : { direct: 0.9, genre: 0.1, proximity: 0.9, soon: 0.8 },
  label: i % 2
}));

describe('createWeightFitter', () => {
  it('fits in-process when no trainer address is configured', async () => {
    const fit = createWeightFitter({});
    expect(await fit(examples)).toEqual(fitWeights(examples));
    expect((await fit([])).weights).toEqual(WEIGHTS);
  });

  it('uses the trainer client when given one and maps its response', async () => {
    const client = { train: vi.fn(async () => ({ weights: { direct: 0.2, genre: 0.6, proximity: 0.1, soon: 0.1 }, personalized: true, examples: 12, loss: 0.3 })) };
    const fit = createWeightFitter({ client });
    const out = await fit(examples, { l2: 0.2 });
    expect(client.train).toHaveBeenCalledWith(examples, { l2: 0.2 });
    expect(out).toEqual({ weights: { direct: 0.2, genre: 0.6, proximity: 0.1, soon: 0.1 }, personalized: true, examples: 12, loss: 0.3 });
  });

  it('falls back to the in-process fit when the trainer call fails', async () => {
    const client = { train: vi.fn(async () => { throw new Error('UNAVAILABLE'); }) };
    const fit = createWeightFitter({ client });
    expect(await fit(examples)).toEqual(fitWeights(examples));
  });
});
