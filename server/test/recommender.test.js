import { describe, it, expect, vi } from 'vitest';
import { buildTasteProfile } from '../src/services/taste.js';
import { recommendEvents, rerankForDiversity } from '../src/services/recommender.js';
import { genreVectors } from '../src/services/taste.js';

const NOW = Date.parse('2026-11-01T00:00:00Z');
const AUSTIN = { lat: 30.27, lng: -97.74 };

const spotifyArtists = {
  mitski: { id: 'mitski', name: 'Mitski', genres: ['indie rock', 'art pop'], popularity: 80 },
  bigthief: { id: 'bigthief', name: 'Big Thief', genres: ['indie folk', 'indie rock'], popularity: 70 },
  wednesday: { id: 'wednesday', name: 'Wednesday', genres: ['indie rock', 'shoegaze'], popularity: 50 },
  luke: { id: 'luke', name: 'Luke Combs', genres: ['contemporary country'], popularity: 90 },
  turnstile: { id: 'turnstile', name: 'Turnstile', genres: ['hardcore punk'], popularity: 65 }
};

function event(id, performer, { genres = [], date = '2026-11-20', venue = AUSTIN, spotifyId = null } = {}) {
  return {
    id, name: `${performer} Live`, url: `https://tm/${id}`, date, dateTime: `${date}T20:00:00Z`,
    genres, venue: { name: 'Venue', city: 'Austin', lat: venue.lat, lng: venue.lng },
    attractions: [{ id: `att-${id}`, name: performer, genres, spotifyId }]
  };
}

const resolveByName = vi.fn(async (a) => Object.values(spotifyArtists).find((s) => s.name === a.name) || null);

const profile = buildTasteProfile({
  short_term: [spotifyArtists.mitski, spotifyArtists.bigthief],
  medium_term: [spotifyArtists.mitski]
});

describe('recommendEvents', () => {
  it('ranks shows by the user\'s own artists first, then genre matches, and excludes unrelated ones', async () => {
    const events = [
      event('1', 'Luke Combs', { genres: ['country'] }),
      event('2', 'Wednesday', { genres: ['rock', 'alternative rock'] }),
      event('3', 'Mitski', { genres: ['rock'] }),
      event('4', 'Turnstile', { genres: ['metal'] })
    ];
    const { recommendations, discover, meta } = await recommendEvents({
      events, profile, origin: AUSTIN, resolveArtist: resolveByName, now: NOW
    });
    const order = recommendations.map((r) => r.event.id);
    expect(order[0]).toBe('3');
    expect(order[1]).toBe('2');
    expect(order).not.toContain('1');
    expect(order).not.toContain('4');
    expect(meta.scanned).toBe(4);

    const mitski = recommendations[0];
    expect(mitski.components.direct).toBe(1);
    expect(mitski.reasons[0]).toMatch(/most-played/);

    expect(discover.map((d) => d.artist.id)).toEqual(['wednesday']);
    expect(recommendations[1].reasons).toContain('New to you');
  });

  it('matches performers to top artists by fuzzy name when no Spotify resolution is available', async () => {
    const events = [event('1', 'Mitski - The Land Is Inhospitable Tour', { genres: ['rock'] })];
    const { recommendations } = await recommendEvents({
      events, profile, origin: AUSTIN, resolveArtist: async () => null, now: NOW
    });
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].components.direct).toBe(1);
  });

  it('headlines a co-bill with the performer the user listens to, not the first listed', async () => {
    const ev = event('1', 'Mannequin Pussy', { genres: ['rock'] });
    ev.attractions.push({ id: 'att-w', name: 'Wednesday', genres: ['rock', 'alternative rock'], spotifyId: 'some-other-id' });
    // Resolver returns ids that don't match the profile, so the name fallback must identify Wednesday.
    const resolve = async (a) => ({ id: `tm:${a.id}`, name: a.name, genres: a.genres });
    const { recommendations } = await recommendEvents({ events: [ev], profile: buildTasteProfile({ short_term: [spotifyArtists.wednesday] }), resolveArtist: resolve, now: NOW });
    expect(recommendations[0].artist.name).toBe('Wednesday');
    expect(recommendations[0].components.direct).toBe(1);
  });

  it('uses the Ticketmaster-provided Spotify id without a name lookup', async () => {
    const resolve = vi.fn(async (a) => (a.spotifyId ? spotifyArtists[a.spotifyId] : null));
    const events = [event('1', 'MITSKI (official)', { spotifyId: 'mitski' })];
    const { recommendations } = await recommendEvents({ events, profile, resolveArtist: resolve, now: NOW });
    expect(recommendations[0].components.direct).toBe(1);
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ spotifyId: 'mitski' }));
  });

  it('prefers closer and sooner shows when affinity is otherwise equal', async () => {
    const far = { lat: 32.78, lng: -96.80 }; // Dallas, ~180 mi
    const events = [
      event('far', 'Mitski', { genres: ['rock'], venue: far }),
      event('near', 'Mitski', { genres: ['rock'] }),
      event('later', 'Mitski', { genres: ['rock'], date: '2027-03-01' })
    ];
    const { recommendations } = await recommendEvents({
      events, profile, origin: AUSTIN, resolveArtist: resolveByName, now: NOW
    });
    // Same artist collapses into one card; the near, soon date wins and the rest become moreDates.
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].event.id).toBe('near');
    expect(recommendations[0].moreDates.map((d) => d.id).sort()).toEqual(['far', 'later']);
  });

  it('drops artists the user has thumbed down', async () => {
    const disliking = buildTasteProfile({ short_term: [spotifyArtists.mitski] }, { artists: { mitski: -1 }, genres: {} });
    const events = [event('1', 'Mitski', { genres: ['rock'] })];
    const { recommendations } = await recommendEvents({ events, profile: disliking, resolveArtist: resolveByName, now: NOW });
    expect(recommendations).toHaveLength(0);
  });

  it('skips the expensive resolution step for events with no signal at all', async () => {
    const resolve = vi.fn(async () => null);
    const events = [event('1', 'Some Polka Band', { genres: ['polka'] })];
    const { meta } = await recommendEvents({ events, profile, resolveArtist: resolve, now: NOW });
    expect(meta.candidates).toBe(0);
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('rerankForDiversity', () => {
  const item = (id, affinity, genres) => ({ id, affinity, genreVector: genreVectors(genres.map((g) => [g, 1])) });

  it('promotes a different genre over a near-duplicate when diversity is on', () => {
    const items = [item('a', 0.9, ['pop']), item('b', 0.85, ['pop']), item('c', 0.6, ['jazz'])];
    expect(rerankForDiversity(items, { limit: 3, diversity: 0 }).map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(rerankForDiversity(items, { limit: 3, diversity: 0.4 }).map((i) => i.id)).toEqual(['a', 'c', 'b']);
  });

  it('respects the limit and strips internal vectors', () => {
    const out = rerankForDiversity([item('a', 1, ['x']), item('b', 0.5, ['y'])], { limit: 1, diversity: 0.3 });
    expect(out).toHaveLength(1);
    expect(out[0]).not.toHaveProperty('genreVector');
  });
});
