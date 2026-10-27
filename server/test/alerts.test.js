import { describe, it, expect, vi } from 'vitest';
import { checkAlertsForUser } from '../src/services/alerts.js';
import { defaultUser } from '../src/lib/store.js';

const NOW = Date.parse('2026-11-01T00:00:00Z');
const AUSTIN = { lat: 30.2672, lng: -97.7431 };
const show = (id, date, venue = AUSTIN) => ({ id, name: id, date, url: 'u', venue: { name: 'V', ...venue }, genres: [], attractions: [] });

function userWith(watchlist, location = { name: 'Austin', ...AUSTIN, radius: 50 }) {
  const u = defaultUser('u1');
  u.location = location;
  for (const a of watchlist) u.watchlist[a.id] = { ...a, addedAt: '2026-10-01T00:00:00Z' };
  return u;
}

describe('checkAlertsForUser', () => {
  it('creates alerts for upcoming shows within the radius and never twice for the same show', async () => {
    const ticketmaster = { eventsForArtist: vi.fn(async () => [
      show('near', '2026-11-20'),
      show('far', '2026-11-21', { lat: 32.78, lng: -96.8 }), // Dallas
      show('past', '2026-10-01')
    ]) };
    const user = userWith([{ id: 'mitski', name: 'Mitski' }]);
    expect(await checkAlertsForUser(user, { ticketmaster, now: NOW })).toBe(1);
    expect(user.alerts.map((a) => a.event.id)).toEqual(['near']);
    expect(user.alerts[0]).toMatchObject({ read: false, distanceMi: 0, artist: { name: 'Mitski' } });

    expect(await checkAlertsForUser(user, { ticketmaster, now: NOW })).toBe(0);
    expect(user.alerts).toHaveLength(1);
  });

  it('does nothing without a saved location or watchlist', async () => {
    const ticketmaster = { eventsForArtist: vi.fn() };
    expect(await checkAlertsForUser(userWith([]), { ticketmaster, now: NOW })).toBe(0);
    expect(await checkAlertsForUser(userWith([{ id: 'x', name: 'X' }], null), { ticketmaster, now: NOW })).toBe(0);
    expect(ticketmaster.eventsForArtist).not.toHaveBeenCalled();
  });
});
