import { haversineMiles } from '../lib/geo.js';
import { log } from '../lib/logger.js';
import { alertsCreated } from '../lib/metrics.js';

const MAX_ALERTS = 100;

/**
 * Checks one user's watchlist for newly listed shows within their saved
 * radius and appends alerts. Each event is alerted at most once per user.
 * Returns the number of alerts created; the user document is mutated.
 */
export async function checkAlertsForUser(user, { ticketmaster, now = Date.now(), priority = 0 }) {
  const artists = Object.values(user.watchlist || {});
  if (!user.location || !artists.length) return 0;

  const today = new Date(now).toISOString().slice(0, 10);
  const created = [];
  for (const artist of artists) {
    const events = await ticketmaster.eventsForArtist(artist.name, { priority });
    for (const event of events) {
      if (user.alertedEventIds[event.id]) continue;
      if (event.date && event.date < today) continue;
      if (event.venue.lat == null) continue;
      const distanceMi = haversineMiles(user.location, event.venue);
      if (distanceMi > (user.location.radius || 50)) continue;
      user.alertedEventIds[event.id] = today;
      created.push({
        id: event.id,
        artist,
        event,
        distanceMi: Math.round(distanceMi),
        createdAt: new Date(now).toISOString(),
        read: false
      });
    }
  }
  if (created.length) {
    user.alerts = [...created, ...(user.alerts || [])].slice(0, MAX_ALERTS);
    alertsCreated.inc(created.length);
  }
  return created.length;
}

/**
 * Periodic sweep over every known user. Runs in-process on a timer; with
 * several instances this would move to a single worker or a leased lock.
 */
export function startAlertJob({ store, ticketmaster, intervalMs = 6 * 3600 * 1000 }) {
  const sweep = async () => {
    const ids = await store.listUserIds();
    let total = 0;
    for (const id of ids) {
      try {
        await store.updateUser(id, async (user) => {
          total += await checkAlertsForUser(user, { ticketmaster, priority: 2 });
        });
      } catch (err) {
        log.warn('alert sweep failed for user', { userId: id, err: err.message });
      }
    }
    log.info('alert sweep complete', { users: ids.length, created: total });
  };
  const timer = setInterval(() => sweep().catch((err) => log.error('alert sweep crashed', { err: err.message })), intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer), runNow: sweep };
}
