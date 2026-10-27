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
});
