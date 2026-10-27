import { describe, it, expect, vi } from 'vitest';
import { enrichGenres } from '../src/services/genres.js';

const artist = (id, genres = []) => ({ id, name: id, genres });

describe('enrichGenres', () => {
  it('fills genres only for artists that have none, with one lookup per unique artist', async () => {
    const genresForArtist = vi.fn(async (name) => (name === 'b' ? ['rock', 'alternative rock'] : []));
    const out = await enrichGenres({
      short_term: [artist('a', ['pop']), artist('b')],
      medium_term: [artist('b'), artist('c')]
    }, { genresForArtist });

    expect(out.short_term[0].genres).toEqual(['pop']);
    expect(out.short_term[1].genres).toEqual(['rock', 'alternative rock']);
    expect(out.medium_term[0].genres).toEqual(['rock', 'alternative rock']);
    expect(out.medium_term[1].genres).toEqual([]);
    expect(genresForArtist).toHaveBeenCalledTimes(2);
  });

  it('returns the input untouched when nothing is missing', async () => {
    const genresForArtist = vi.fn();
    const input = { short_term: [artist('a', ['pop'])] };
    expect(await enrichGenres(input, { genresForArtist })).toBe(input);
    expect(genresForArtist).not.toHaveBeenCalled();
  });

  it('returns within the time budget using whatever has resolved, leaving the rest to finish', async () => {
    let releaseSlow;
    const genresForArtist = vi.fn((name) => (name === 'fast'
      ? Promise.resolve(['pop'])
      : new Promise((resolve) => { releaseSlow = () => resolve(['jazz']); })));

    const started = Date.now();
    const out = await enrichGenres({ short_term: [artist('fast'), artist('slow')] }, { genresForArtist }, { budgetMs: 30 });
    expect(Date.now() - started).toBeLessThan(500);
    expect(out.short_term[0].genres).toEqual(['pop']);
    expect(out.short_term[1].genres).toEqual([]);

    releaseSlow(); // the slow lookup still completes (and would populate the cache)
    await Promise.resolve();
  });

  it('tolerates lookup failures', async () => {
    const genresForArtist = vi.fn().mockRejectedValue(new Error('tm down'));
    const out = await enrichGenres({ short_term: [artist('a')] }, { genresForArtist });
    expect(out.short_term[0].genres).toEqual([]);
  });
});
