import { describe, it, expect } from 'vitest';
import { normalizeName, similarity, bestMatch } from '../src/lib/fuzzy.js';

describe('normalizeName', () => {
  it('strips articles, punctuation, accents and tour suffixes', () => {
    expect(normalizeName('The Weeknd')).toBe('weeknd');
    expect(normalizeName('Tyler, The Creator')).toBe('tyler the creator');
    expect(normalizeName('Beyoncé - Renaissance World Tour')).toBe('beyonce');
    expect(normalizeName('Florence + The Machine (Live)')).toBe('florence the machine');
  });
});

describe('similarity', () => {
  it('is 1 for names that normalize identically', () => {
    expect(similarity('The Weeknd', 'Weeknd')).toBe(1);
    expect(similarity('Tyler, The Creator', 'Tyler the Creator')).toBe(1);
  });

  it('is high for small spelling differences and low for different artists', () => {
    expect(similarity('Phoebe Bridgers', 'Pheobe Bridgers')).toBeGreaterThan(0.7);
    expect(similarity('Phoebe Bridgers', 'Bright Eyes')).toBeLessThan(0.3);
  });

  it('handles empty input', () => {
    expect(similarity('', 'x')).toBe(0);
  });
});

describe('bestMatch', () => {
  const artists = [{ name: 'Mitski' }, { name: 'Japanese Breakfast' }, { name: 'Big Thief' }];

  it('returns the best candidate above the threshold', () => {
    const hit = bestMatch('Japanese Breakfast - Jubilee Tour', artists, { key: (a) => a.name });
    expect(hit.match.name).toBe('Japanese Breakfast');
  });

  it('returns null when nothing is close enough', () => {
    expect(bestMatch('Mitski Tribute Band', artists, { key: (a) => a.name })).toBeNull();
    expect(bestMatch('Radiohead', artists, { key: (a) => a.name })).toBeNull();
  });
});
