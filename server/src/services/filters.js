/**
 * Query-string filters applied to events before ranking. Filtering first is
 * cheap and keeps the ranker's candidate budget for shows the user can
 * actually go to.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_GENRE_FILTERS = 10;

function csv(value) {
  if (!value) return [];
  return String(value).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, MAX_GENRE_FILTERS);
}

export function parseFilters(query = {}) {
  const maxPrice = Number(query.maxPrice);
  return {
    from: DATE_RE.test(query.from || '') ? query.from : null,
    to: DATE_RE.test(query.to || '') ? query.to : null,
    weekend: query.weekend === '1' || query.weekend === 'true',
    maxPrice: Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : null,
    genres: csv(query.genres),
    exclude: csv(query.exclude)
  };
}

/** Every Ticketmaster genre label attached to an event or its performers. */
export function eventGenres(event) {
  const out = new Set(event.genres || []);
  for (const a of event.attractions || []) for (const g of a.genres || []) out.add(g);
  return out;
}

function isWeekend(date) {
  // Local date string; noon UTC avoids any day shift from the parse.
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 5 || day === 6 || day === 0;
}

export function applyFilters(events, filters) {
  const kept = events.filter((e) => {
    if (filters.from && e.date && e.date < filters.from) return false;
    if (filters.to && e.date && e.date > filters.to) return false;
    if (filters.weekend && e.date && !isWeekend(e.date)) return false;
    // Shows without a listed price are kept: unknown is not the same as too expensive.
    if (filters.maxPrice != null && e.priceRange && e.priceRange.min > filters.maxPrice) return false;
    if (filters.genres.length || filters.exclude.length) {
      const genres = eventGenres(e);
      if (filters.exclude.some((g) => genres.has(g))) return false;
      if (filters.genres.length && !filters.genres.some((g) => genres.has(g))) return false;
    }
    return true;
  });
  return { events: kept, filteredOut: events.length - kept.length };
}

/** Genre labels present in a set of events, most common first, for filter chips. */
export function availableGenres(events, limit = 30) {
  const counts = new Map();
  for (const e of events) for (const g of eventGenres(e)) counts.set(g, (counts.get(g) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([genre, count]) => ({ genre, count }));
}
