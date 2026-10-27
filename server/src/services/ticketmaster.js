import { requestWithRetry } from '../lib/http.js';
import { cacheKeyForPoint } from '../lib/geo.js';
import { bestMatch } from '../lib/fuzzy.js';
import { log } from '../lib/logger.js';

const EVENTS_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';
const ATTRACTIONS_URL = 'https://app.ticketmaster.com/discovery/v2/attractions.json';
// Discovery API refuses deep pagination: size * page must stay under 1000.
const PAGE_SIZE = 200;
const MAX_PAGES = 4;

/**
 * Ticketmaster client. Every request goes through `limit` (token bucket +
 * concurrency gate) and `withCache` so the 5 req/s quota is never exceeded
 * even when many users load the app at once.
 */
export function createTicketmasterClient({ apiKey, limit, withCache }) {
  async function fetchPage(params, { url = EVENTS_URL, priority = 0 } = {}) {
    return limit(() => requestWithRetry({
      url,
      params: { apikey: apiKey, classificationName: 'Music', ...params }
    }, { upstream: 'ticketmaster' }), { priority });
  }

  return {
    /**
     * Resolves an artist name to Ticketmaster's attraction record (id, genre
     * labels, Spotify link) by fuzzy-matching search results. Cached for a
     * day; misses are cached as null so unknown names cost one lookup.
     */
    async findAttraction(name, { priority = 1 } = {}) {
      const key = `tm:attraction:${name.toLowerCase()}`;
      const hit = await withCache(key, 24 * 3600, async () => {
        try {
          // Usually background cache warming, so low priority by default: it
          // must not hold up event pages a user is waiting on.
          const res = await fetchPage({ keyword: name, size: 5 }, { url: ATTRACTIONS_URL, priority });
          const attractions = res.data._embedded?.attractions || [];
          const match = bestMatch(name, attractions, { threshold: 0.85, key: (a) => a.name });
          if (!match) return null;
          const a = match.match;
          return { id: a.id, name: a.name, genres: classificationGenres(a.classifications), spotifyId: spotifyIdFromLinks(a.externalLinks) };
        } catch (err) {
          log.warn('ticketmaster attraction lookup failed', { name, err: err.message });
          return null;
        }
      });
      return hit ?? null;
    },

    /**
     * Genre labels for an artist from Ticketmaster's taxonomy. Spotify stopped
     * returning genres on artist objects in 2025, so this is now the main
     * genre signal for the taste profile.
     */
    async genresForArtist(name) {
      return (await this.findAttraction(name))?.genres || [];
    },

    /** All upcoming music events within `radiusMiles` of a point. */
    async eventsNear(point, { radiusMiles = 50 } = {}) {
      const key = `tm:near:${cacheKeyForPoint(point)}:${radiusMiles}`;
      return withCache(key, 15 * 60, async () => {
        const params = {
          latlong: `${point.lat},${point.lng}`,
          radius: radiusMiles,
          unit: 'miles',
          size: PAGE_SIZE,
          sort: 'date,asc'
        };
        // The first page tells us how many there are; the rest fetch in parallel.
        const first = await fetchPage({ ...params, page: 0 });
        const totalPages = Math.min(MAX_PAGES, first.data.page?.totalPages ?? 1);
        const rest = await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, i) => fetchPage({ ...params, page: i + 1 }))
        );
        const events = [first, ...rest]
          .flatMap((res) => res.data._embedded?.events || [])
          .filter(isConcert)
          .map(normalizeEvent);
        log.debug('ticketmaster events fetched', { key, count: events.length, pages: totalPages });
        return dedupe(events);
      });
    },

    /** One event by Ticketmaster id, for calendar export of a previously seen event. */
    async eventById(id) {
      if (!/^[\w-]{1,64}$/.test(id)) return null;
      return withCache(`tm:event:${id}`, 24 * 3600, async () => {
        try {
          const res = await fetchPage({}, { url: `https://app.ticketmaster.com/discovery/v2/events/${id}.json` });
          return normalizeEvent(res.data);
        } catch (err) {
          if (err.status === 404) return null;
          throw err;
        }
      });
    },

    /**
     * Upcoming events for one artist, anywhere. Used for the touring view and
     * watchlist alerts. Keyword search is loose ("Wednesday" matches every
     * Wednesday-night residency), so the artist is first resolved to an
     * attraction id and events are fetched by that; the keyword path is only
     * a fallback, filtered to events whose performer actually matches.
     */
    async eventsForArtist(name, { priority = 0 } = {}) {
      const key = `tm:artist:${name.toLowerCase()}`;
      return withCache(key, 60 * 60, async () => {
        try {
          const attraction = await this.findAttraction(name, { priority });
          const params = attraction
            ? { attractionId: attraction.id, size: 20, sort: 'date,asc' }
            : { keyword: name, size: 20, sort: 'date,asc' };
          const res = await fetchPage(params, { priority });
          return (res.data._embedded?.events || [])
            .filter(isConcert)
            .map(normalizeEvent)
            .filter((e) => attraction || performedBy(e, name));
        } catch (err) {
          // One flaky artist lookup shouldn't blank the whole page.
          log.warn('ticketmaster artist lookup failed', { name, err: err.message });
          return [];
        }
      });
    }
  };
}

const ANCILLARY = /^(premium seating|parking|vip|official platinum|upgrade)\b|\b(parking|package|upgrade|shuttle|camping)\b/i;

/**
 * Ticketmaster lists ticket add-ons (premium seating, parking, VIP packages)
 * as separate events alongside the concert itself. Drop those and anything
 * cancelled so they can't outrank the real show.
 */
export function isConcert(ev) {
  if (ev.dates?.status?.code === 'cancelled') return false;
  return !ANCILLARY.test(ev.name || '');
}

/** True when one of the event's performers (or, lacking any, its title) fuzzy-matches the artist. */
export function performedBy(event, artistName) {
  const names = event.attractions.length ? event.attractions.map((a) => a.name) : [event.name];
  return bestMatch(artistName, names, { threshold: 0.85 }) !== null;
}

/**
 * Flattens Ticketmaster's deeply nested event shape into the handful of
 * fields the app uses. Attractions (performers) carry Ticketmaster's own
 * genre taxonomy and, when available, a direct link to the Spotify artist,
 * which lets the recommender skip a search entirely.
 */
export function normalizeEvent(ev) {
  const venue = ev._embedded?.venues?.[0];
  const loc = venue?.location;
  const attractions = (ev._embedded?.attractions || []).map((a) => ({
    id: a.id,
    name: a.name,
    genres: classificationGenres(a.classifications),
    spotifyId: spotifyIdFromLinks(a.externalLinks)
  }));
  return {
    id: ev.id,
    name: ev.name,
    url: ev.url,
    date: ev.dates?.start?.localDate || null,
    dateTime: ev.dates?.start?.dateTime || null,
    image: pickImage(ev.images),
    priceRange: ev.priceRanges?.[0]
      ? { min: ev.priceRanges[0].min, max: ev.priceRanges[0].max, currency: ev.priceRanges[0].currency }
      : null,
    venue: {
      name: venue?.name || null,
      city: venue?.city?.name || null,
      state: venue?.state?.stateCode || null,
      country: venue?.country?.countryCode || null,
      lat: loc ? Number(loc.latitude) : null,
      lng: loc ? Number(loc.longitude) : null
    },
    genres: classificationGenres(ev.classifications),
    attractions
  };
}

function classificationGenres(classifications = []) {
  const out = new Set();
  for (const c of classifications) {
    for (const field of ['genre', 'subGenre']) {
      const name = c?.[field]?.name;
      if (name && name !== 'Undefined' && name !== 'Other') out.add(name.toLowerCase());
    }
  }
  return [...out];
}

function spotifyIdFromLinks(links) {
  const url = links?.spotify?.[0]?.url;
  const m = url && url.match(/artist\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function pickImage(images = []) {
  const wide = images.filter((i) => i.ratio === '16_9').sort((a, b) => b.width - a.width);
  return (wide[0] || images[0])?.url || null;
}

function dedupe(events) {
  const seen = new Set();
  return events.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}
