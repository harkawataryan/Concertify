import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { demoRouter } from '../src/routes/demo.js';

// The public demo route with fakes: artists resolve through the app token,
// events come from the radius search, and the ranker runs in-process.
const AUSTIN = { lat: 30.27, lng: -97.74 };
const event = (id, performer, date = '2099-11-20') => ({
  id, name: `${performer} Live`, url: `https://tm/${id}`, date, dateTime: `${date}T20:00:00Z`,
  genres: ['indie rock'], venue: { name: 'Venue', city: 'Austin', lat: AUSTIN.lat, lng: AUSTIN.lng },
  attractions: [{ id: `att-${id}`, name: performer, genres: ['indie rock'], spotifyId: null }]
});
const ID1 = '2uYWxilOVlUdk4oV9DvwqK', ID2 = '1r1uxoy19fzMxunt3ONAkG';

function build() {
  const spotify = {
    appToken: vi.fn(async () => 'app'),
    searchArtists: vi.fn(async (q) => (q.startsWith('mit') ? [{ id: ID1, name: 'Mitski', image: 'img' }] : [])),
    getArtist: vi.fn(async (_t, id) => ({ [ID1]: { id: ID1, name: 'Mitski', genres: ['indie rock'] }, [ID2]: { id: ID2, name: 'Phoebe Bridgers', genres: [] } }[id] || Promise.reject(new Error('404'))))
  };
  const ticketmaster = { eventsNear: vi.fn(async () => [event('a', 'Mitski'), event('b', 'Someone Else')]), genresForArtist: vi.fn(async () => ['indie folk']) };
  const mem = new Map();
  const withCache = async (k, _ttl, fn) => { if (!mem.has(k)) mem.set(k, await fn()); return mem.get(k); };
  const app = express();
  app.use('/api/demo', demoRouter({ spotify, ticketmaster, withCache, origins: ['https://aryanh.dev'] }));
  return { app, spotify, ticketmaster };
}
async function get(app, path, headers = {}) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers });
  const body = await res.json();
  server.close();
  return { status: res.status, body, headers: res.headers };
}

describe('demo routes', () => {
  it('searches artists with the app token and allows the portfolio origin', async () => {
    const { app } = build();
    const r = await get(app, '/api/demo/artists?q=mits', { Origin: 'https://aryanh.dev' });
    expect(r.status).toBe(200);
    expect(r.body.artists).toEqual([{ id: ID1, name: 'Mitski', image: 'img' }]);
    expect(r.headers.get('access-control-allow-origin')).toBe('https://aryanh.dev');
  });

  it('ranks nearby shows for the named artists without a session', async () => {
    const { app, spotify, ticketmaster } = build();
    const r = await get(app, `/api/demo/recommendations?artists=${ID1},${ID2},notanid&lat=30.27&lng=-97.74&radius=25`);
    expect(r.status).toBe(200);
    expect(spotify.getArtist).toHaveBeenCalledTimes(2);
    expect(ticketmaster.eventsNear).toHaveBeenCalledWith(AUSTIN, { radiusMiles: 25 });
    expect(r.body.artists.map((a) => a.name)).toEqual(['Mitski', 'Phoebe Bridgers']);
    expect(r.body.recommendations[0].artist.name).toBe('Mitski');
    expect(r.body.recommendations[0].reasons.join(' ')).toMatch(/Mitski/);
    expect(r.body.recommendations[0].event).toMatchObject({ venue: 'Venue', city: 'Austin', url: 'https://tm/a' });
  });

  it('rejects requests without artists or a location', async () => {
    const { app } = build();
    expect((await get(app, '/api/demo/recommendations?lat=1&lng=2')).status).toBe(400);
    expect((await get(app, `/api/demo/recommendations?artists=${ID1}`)).status).toBe(400);
  });
});
