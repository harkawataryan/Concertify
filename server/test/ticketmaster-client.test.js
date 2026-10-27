import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { createTicketmasterClient } from '../src/services/ticketmaster.js';

vi.mock('axios', () => ({ default: vi.fn() }));

const attraction = (id, name, genre, sub) => ({
  id, name, classifications: [{ genre: { name: genre }, subGenre: { name: sub } }],
  externalLinks: { spotify: [{ url: `https://open.spotify.com/artist/sp-${id}` }] }
});

function client() {
  const store = new Map();
  const withCache = async (key, _ttl, compute) => {
    if (!store.has(key)) store.set(key, await compute());
    return store.get(key);
  };
  return createTicketmasterClient({ apiKey: 'k', withCache, limit: (fn) => fn() });
}

describe('ticketmaster client', () => {
  beforeEach(() => axios.mockReset());

  it('genresForArtist works when destructured (no this-binding) and fuzzy-matches the attraction', async () => {
    axios.mockResolvedValueOnce({ data: { _embedded: { attractions: [
      attraction('a1', 'Wednesday Night Jazz', 'Jazz', 'Undefined'),
      attraction('a2', 'Wednesday', 'Rock', 'Alternative Rock')
    ] } } });
    const { genresForArtist } = client();
    expect(await genresForArtist('Wednesday')).toEqual(['rock', 'alternative rock']);
    expect(axios).toHaveBeenCalledTimes(1);
    expect(axios.mock.calls[0][0].url).toMatch(/attractions\.json$/);
  });

  it('eventsForArtist queries by resolved attraction id instead of keyword', async () => {
    axios
      .mockResolvedValueOnce({ data: { _embedded: { attractions: [attraction('a2', 'Wednesday', 'Rock', 'Alternative Rock')] } } })
      .mockResolvedValueOnce({ data: { _embedded: { events: [
        { id: 'e1', name: 'Wednesday', dates: { start: { localDate: '2026-11-14', localTime: '20:00:00' } }, _embedded: { attractions: [{ id: 'a2', name: 'Wednesday' }] } },
        { id: 'e2', name: 'Parking: Wednesday', dates: { start: { localDate: '2026-11-14' } } }
      ] } } });
    const { eventsForArtist } = client();
    const events = await eventsForArtist('Wednesday');
    expect(events.map((e) => e.id)).toEqual(['e1']);
    expect(events[0].time).toBe('20:00:00');
    expect(axios.mock.calls[1][0].params).toMatchObject({ attractionId: 'a2' });
  });

  it('returns no genres for an unknown artist without throwing', async () => {
    axios.mockResolvedValueOnce({ data: {} });
    const { genresForArtist } = client();
    expect(await genresForArtist('Nobody')).toEqual([]);
  });
});
