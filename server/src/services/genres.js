import { log } from '../lib/logger.js';

/**
 * Fills in genres for artists that Spotify returned without any.
 *
 * Spotify's Web API stopped populating `genres` on artist objects in 2025,
 * which would leave the taste profile with artist weights but no genre
 * vector. Ticketmaster's attractions carry their own genre taxonomy, and
 * since events are labeled with the same taxonomy, using it for the profile
 * makes the genre comparison exact rather than cross-vocabulary.
 *
 * Lookups are rate-limited upstream, so a cold profile with dozens of
 * artists can't be enriched instantly. Callers pass a time budget: whatever
 * resolves in time is used now, the rest keep running to warm the cache for
 * the next request. Artists are processed in rank order so the ones that
 * matter most are covered first.
 */

const MAX_LOOKUPS = 40;

export async function enrichGenres(topByRange, { genresForArtist }, { budgetMs = Infinity } = {}) {
  const missing = new Map();
  for (const list of Object.values(topByRange)) {
    for (const a of list || []) {
      if (!a.genres?.length && !missing.has(a.id) && missing.size < MAX_LOOKUPS) missing.set(a.id, a.name);
    }
  }
  if (!missing.size) return topByRange;

  const genresById = new Map();
  const lookups = [...missing].map(([id, name]) => genresForArtist(name)
    .then((genres) => genresById.set(id, genres))
    .catch(() => genresById.set(id, [])));

  const all = Promise.all(lookups);
  if (budgetMs === Infinity) {
    await all;
  } else {
    let timer;
    await Promise.race([all, new Promise((resolve) => { timer = setTimeout(resolve, budgetMs); })]);
    clearTimeout(timer);
    const pending = missing.size - genresById.size;
    if (pending) log.info('genre enrichment over budget; continuing in background', { pending, budgetMs });
  }

  const enriched = {};
  for (const [range, list] of Object.entries(topByRange)) {
    enriched[range] = (list || []).map((a) => (a.genres?.length ? a : { ...a, genres: genresById.get(a.id) || [] }));
  }
  // Non-enumerable so callers iterating ranges never see it; the API reports
  // it so the client knows a refetch will be more complete.
  Object.defineProperty(enriched, 'pending', { value: missing.size - genresById.size, enumerable: false });
  return enriched;
}
