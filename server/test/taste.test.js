import { describe, it, expect } from 'vitest';
import { buildTasteProfile, cosine, genreVectors, genreSimilarity, tokenizeGenre } from '../src/services/taste.js';

const artist = (id, genres, name = id) => ({ id, name, genres, popularity: 50 });

describe('tokenizeGenre', () => {
  it('splits compound labels and drops filler words', () => {
    expect(tokenizeGenre('Hip-Hop/Rap')).toEqual(['hip', 'hop', 'rap']);
    expect(tokenizeGenre('Rock Music')).toEqual(['rock']);
  });
});

describe('cosine', () => {
  it('is 1 for identical, 0 for disjoint vectors', () => {
    const a = new Map([['x', 1], ['y', 2]]);
    expect(cosine(a, a)).toBeCloseTo(1);
    expect(cosine(a, new Map([['z', 1]]))).toBe(0);
    expect(cosine(a, new Map())).toBe(0);
  });
});

describe('genreSimilarity', () => {
  it('bridges fine-grained Spotify genres and coarse Ticketmaster labels via tokens', () => {
    const spotify = genreVectors([['indie rock', 1], ['shoegaze', 1]]);
    const tm = genreVectors([['rock', 1], ['alternative rock', 1]]);
    const unrelated = genreVectors([['country', 1]]);
    expect(genreSimilarity(spotify, tm)).toBeGreaterThan(0.1);
    expect(genreSimilarity(spotify, unrelated)).toBe(0);
  });
});

describe('buildTasteProfile', () => {
  it('weights recent listening and higher ranks more', () => {
    const profile = buildTasteProfile({
      short_term: [artist('a', ['pop']), artist('b', ['pop'])],
      long_term: [artist('c', ['rock'])]
    });
    const w = (id) => profile.artists.get(id).weight;
    expect(w('a')).toBe(1);
    expect(w('a')).toBeGreaterThan(w('b'));
    expect(w('b')).toBeGreaterThan(w('c'));
  });

  it('accumulates weight for artists present in several windows', () => {
    const profile = buildTasteProfile({
      short_term: [artist('x', ['pop']), artist('y', ['pop'])],
      medium_term: [artist('y', ['pop']), artist('x', ['pop'])],
      long_term: [artist('y', ['pop'])]
    });
    expect(profile.artists.get('y').weight).toBeGreaterThan(profile.artists.get('x').weight);
  });

  it('derives a genre vector dominated by the heaviest artists', () => {
    const profile = buildTasteProfile({
      short_term: [artist('a', ['indie rock']), artist('b', ['indie rock']), artist('c', ['jazz'])]
    });
    expect(profile.topGenres[0]).toBe('indie rock');
    expect(profile.genres.exact.get('indie rock')).toBeGreaterThan(profile.genres.exact.get('jazz'));
  });

  it('applies explicit feedback: disliked artists vanish, disliked genres are suppressed', () => {
    const profile = buildTasteProfile(
      { short_term: [artist('a', ['metal']), artist('b', ['folk'])] },
      { artists: { a: -1 }, genres: { folk: -1 } }
    );
    expect(profile.artists.has('a')).toBe(false);
    expect(profile.dislikedArtists.has('a')).toBe(true);
    expect(profile.genres.exact.has('folk')).toBe(false);
  });
});
