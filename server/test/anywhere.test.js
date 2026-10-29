import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { apiRouter } from '../src/routes/api.js';
import { defaultUser } from '../src/lib/store.js';

// Drives the recommendations route end to end with fakes to check that
// radius=any swaps the radius search for per-artist lookups and still
// reports distances from the caller's location.
const AUSTIN = { lat: 30.27, lng: -97.74 };
const NYC = { lat: 40.71, lng: -74.0 };
const event = (id, performer, venue, date = '2099-11-20') => ({
  id, name: `${performer} Live`, url: `https://tm/${id}`, date, dateTime: `${date}T20:00:00Z`,
  genres: ['indie rock'], venue: { name: 'Venue', city: 'X', lat: venue.lat, lng: venue.lng },
  attractions: [{ id: `att-${id}`, name: performer, genres: ['indie rock'], spotifyId: null }]
});

function build() {
  const artists = [{ id: 'mitski', name: 'Mitski', genres: ['indie rock'] }, { id: 'bigthief', name: 'Big Thief', genres: ['indie folk'] }];
  const spotify = { getTopArtistsAllRanges: async () => ({ short_term: artists, medium_term: artists, long_term: [] }) };
  const ticketmaster = {
    eventsNear: vi.fn(async () => [event('near', 'Mitski', AUSTIN)]),
    eventsForArtist: vi.fn(async (name) => (name === 'Mitski' ? [event('nyc', 'Mitski', NYC), event('near', 'Mitski', AUSTIN)] : [event('bt', 'Big Thief', NYC)])),
    genresForArtist: async () => []
  };
  const users = new Map();
  const store = {
    getUser: async (id) => users.get(id) || defaultUser(id),
    updateUser: async (id, fn) => { const u = users.get(id) || defaultUser(id); fn(u); users.set(id, u); return u; },
    getPlan: async () => null, setPlan: async () => {}
  };
  const mem = new Map();
  const cache = { get: async (k) => mem.get(k), set: async (k, v) => mem.set(k, v) };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { accessToken: 't', userId: 'u1', displayName: 'U' }; next(); });
  app.use('/api', apiRouter({ spotify, ticketmaster, store, cache, fitWeights: async () => ({ weights: { direct: 0.55, genre: 0.3, proximity: 0.08, soon: 0.07 }, personalized: false, examples: 0 }) }));
  return { app, ticketmaster };
}

async function get(app, path) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const body = await res.json();
  server.close();
  return { status: res.status, body };
}

describe('radius=any', () => {
  it('looks up shows per artist instead of by radius and keeps distances for display', async () => {
    const { app, ticketmaster } = build();
    const { status, body } = await get(app, '/api/recommendations?lat=30.27&lng=-97.74&radius=any');
    expect(status).toBe(200);
    expect(ticketmaster.eventsNear).not.toHaveBeenCalled();
    expect(ticketmaster.eventsForArtist.mock.calls.map((c) => c[0]).sort()).toEqual(['Big Thief', 'Mitski']);
    expect(body.anywhere).toBe(true);
    expect(body.radiusMiles).toBeNull();
    const ids = body.recommendations.flatMap((r) => [r.event.id, ...r.moreDates.map((d) => d.id)]).sort();
    expect(ids).toEqual(['bt', 'near', 'nyc']);
    const byId = Object.fromEntries(body.recommendations.map((r) => [r.event.id, r]));
    for (const r of body.recommendations) expect(typeof r.distanceMi).toBe('number');
    expect(byId.bt.distanceMi).toBeGreaterThan(1500);
    // distance must not affect the ranking
    for (const r of body.recommendations) expect(r.components.proximity).toBe(0.5);
  });

  it('still searches by radius for a number', async () => {
    const { app, ticketmaster } = build();
    const { body } = await get(app, '/api/recommendations?lat=30.27&lng=-97.74&radius=100');
    expect(ticketmaster.eventsNear).toHaveBeenCalledWith(AUSTIN, { radiusMiles: 100 });
    expect(body.anywhere).toBe(false);
    expect(body.radiusMiles).toBe(100);
  });

  it('saves "any" as a location radius', async () => {
    const { app } = build();
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/me/location`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Austin', ...AUSTIN, radius: 'any' })
    });
    expect((await res.json()).location.radius).toBe('any');
    server.close();
  });
});
