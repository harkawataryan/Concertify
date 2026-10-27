/**
 * Fills in genres for artists that Spotify returned without any.
 *
 * Spotify's Web API stopped populating `genres` on artist objects in 2025,
 * which would leave the taste profile with artist weights but no genre
 * vector. Ticketmaster's attractions carry their own genre taxonomy, and
 * since events are labeled with the same taxonomy, using it for the profile
 * makes the genre comparison exact rather than cross-vocabulary.
 */

const MAX_LOOKUPS = 60;

export async function enrichGenres(topByRange, { genresForArtist }) {
  // Unique artists in rank order so, if we hit the cap, the ones that matter most are covered.
  const missing = new Map();
  for (const list of Object.values(topByRange)) {
    for (const a of list || []) {
      if (!a.genres?.length && !missing.has(a.id) && missing.size < MAX_LOOKUPS) missing.set(a.id, a.name);
    }
  }
  if (!missing.size) return topByRange;

  const lookups = await Promise.all([...missing].map(async ([id, name]) => [id, await genresForArtist(name)]));
  const genresById = new Map(lookups);

  const enriched = {};
  for (const [range, list] of Object.entries(topByRange)) {
    enriched[range] = (list || []).map((a) => (a.genres?.length ? a : { ...a, genres: genresById.get(a.id) || [] }));
  }
  return enriched;
}
