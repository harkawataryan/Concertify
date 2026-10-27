import { describe, it, expect } from 'vitest';
import { isConcert, normalizeEvent, performedBy } from '../src/services/ticketmaster.js';

describe('isConcert', () => {
  it('keeps real shows', () => {
    expect(isConcert({ name: 'Knocked Loose' })).toBe(true);
    expect(isConcert({ name: 'Mitski: The Land Is Inhospitable Tour' })).toBe(true);
    expect(isConcert({ name: 'Parquet Courts' })).toBe(true); // "Par-king" must not match
  });

  it('drops ticket add-ons and cancelled events', () => {
    expect(isConcert({ name: 'Premium Seating - Knocked Loose' })).toBe(false);
    expect(isConcert({ name: 'Knocked Loose VIP Package' })).toBe(false);
    expect(isConcert({ name: 'PARKING: Luke Combs' })).toBe(false);
    expect(isConcert({ name: 'Mitski', dates: { status: { code: 'cancelled' } } })).toBe(false);
  });
});

describe('performedBy', () => {
  const ev = (attractions, name = 'Some Event') => ({ name, attractions: attractions.map((n) => ({ name: n })) });

  it('matches on a listed performer, tolerating tour suffixes', () => {
    expect(performedBy(ev(['Mannequin Pussy', 'Wednesday']), 'Wednesday')).toBe(true);
    expect(performedBy(ev(['Mitski - The Land Is Inhospitable Tour']), 'Mitski')).toBe(true);
  });

  it('rejects keyword-only hits', () => {
    expect(performedBy(ev(['Wednesday Night Jazz Jam']), 'Wednesday')).toBe(false);
    expect(performedBy(ev([], 'Wednesday Comedy Open Mic'), 'Wednesday')).toBe(false);
  });

  it('falls back to the event title when no performers are listed', () => {
    expect(performedBy(ev([], 'Spoon'), 'Spoon')).toBe(true);
  });
});

describe('normalizeEvent', () => {
  it('extracts performer genres and the Spotify id from external links', () => {
    const ev = normalizeEvent({
      id: 'e1', name: 'Show', url: 'u',
      dates: { start: { localDate: '2026-11-14' } },
      classifications: [{ genre: { name: 'Rock' }, subGenre: { name: 'Undefined' } }],
      _embedded: {
        venues: [{ name: 'V', city: { name: 'Austin' }, location: { latitude: '30.2', longitude: '-97.7' } }],
        attractions: [{
          id: 'a1', name: 'Wednesday',
          classifications: [{ genre: { name: 'Rock' }, subGenre: { name: 'Alternative Rock' } }],
          externalLinks: { spotify: [{ url: 'https://open.spotify.com/artist/abc123' }] }
        }]
      }
    });
    expect(ev.genres).toEqual(['rock']);
    expect(ev.attractions[0]).toMatchObject({ name: 'Wednesday', genres: ['rock', 'alternative rock'], spotifyId: 'abc123' });
    expect(ev.venue).toMatchObject({ lat: 30.2, lng: -97.7 });
  });
});
