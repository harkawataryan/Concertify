/**
 * Builds a user's taste profile from their Spotify top artists.
 *
 * The profile is two things: a weight per artist (how much the user listens
 * to them, decayed by rank and recency window) and a genre vector derived
 * from those weights. Both are consumed by the recommender to score events.
 */

// Recent listening says more about what someone wants to see live this
// month than their all-time favorites, so shorter windows weigh more.
export const RANGE_WEIGHTS = { short_term: 1.0, medium_term: 0.8, long_term: 0.6 };
const RANK_DECAY = 20; // rank 0 -> 1.0, rank 20 -> 0.37, rank 50 -> 0.08

const TOKEN_STOPWORDS = new Set(['music', 'and', 'the', 'of', 'other', 'undefined', 'misc']);

export function tokenizeGenre(genre) {
  return genre
    .toLowerCase()
    .split(/[\s/&,-]+/)
    .map((t) => t.trim())
    .filter((t) => t && !TOKEN_STOPWORDS.has(t));
}

/** Cosine similarity between two sparse vectors stored as Maps. */
export function cosine(a, b) {
  if (!a.size || !b.size) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [, v] of a) na += v * v;
  for (const [, v] of b) nb += v * v;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [k, v] of small) {
    const w = large.get(k);
    if (w) dot += v * w;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Converts a genre list into two sparse vectors: exact genre labels
 * ("indie rock") and word tokens ("indie", "rock"). Exact matches are
 * precise; tokens bridge Spotify's micro-genres and Ticketmaster's coarse
 * taxonomy ("alternative rock" vs "rock").
 */
export function genreVectors(weightedGenres) {
  const exact = new Map();
  const tokens = new Map();
  for (const [genre, weight] of weightedGenres) {
    const g = genre.toLowerCase().trim();
    if (!g) continue;
    exact.set(g, (exact.get(g) || 0) + weight);
    const toks = tokenizeGenre(g);
    for (const t of toks) tokens.set(t, (tokens.get(t) || 0) + weight / toks.length);
  }
  return { exact, tokens };
}

/** Blended genre similarity between two {exact, tokens} vector pairs. */
export function genreSimilarity(a, b) {
  return 0.6 * cosine(a.exact, b.exact) + 0.4 * cosine(a.tokens, b.tokens);
}

/**
 * @param topByRange  {short_term: Artist[], medium_term: Artist[], long_term: Artist[]}
 * @param feedback    {artists: {[id]: 1|-1}, genres: {[genre]: 1|-1}} explicit thumbs up/down
 */
export function buildTasteProfile(topByRange, feedback = { artists: {}, genres: {} }) {
  const artists = new Map(); // id -> {id, name, genres, weight}

  for (const [range, list] of Object.entries(topByRange)) {
    if (!Array.isArray(list)) continue;
    const rangeWeight = RANGE_WEIGHTS[range] ?? 0.5;
    list.forEach((artist, rank) => {
      const w = rangeWeight * Math.exp(-rank / RANK_DECAY);
      const entry = artists.get(artist.id) || { id: artist.id, name: artist.name, genres: artist.genres || [], weight: 0 };
      entry.weight += w;
      artists.set(artist.id, entry);
    });
  }

  // Normalize so the single most-listened artist has weight 1.
  const maxWeight = Math.max(1e-9, ...[...artists.values()].map((a) => a.weight));
  for (const a of artists.values()) a.weight /= maxWeight;

  for (const [id, signal] of Object.entries(feedback.artists || {})) {
    if (signal < 0) artists.delete(id);
    else if (signal > 0 && !artists.has(id)) artists.set(id, { id, name: null, genres: [], weight: 0.75 });
  }

  const weightedGenres = [];
  for (const a of artists.values()) {
    for (const g of a.genres) weightedGenres.push([g, a.weight]);
  }
  // Explicit genre feedback nudges the vector by a fixed amount so a single
  // thumbs-down can suppress a genre without zeroing out everything related.
  for (const [genre, signal] of Object.entries(feedback.genres || {})) {
    weightedGenres.push([genre, 1.5 * signal]);
  }
  const genres = genreVectors(weightedGenres);
  for (const [g, w] of genres.exact) if (w <= 0) genres.exact.delete(g);
  for (const [t, w] of genres.tokens) if (w <= 0) genres.tokens.delete(t);

  const topGenres = [...genres.exact.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([g]) => g);

  return {
    artists,
    artistNames: [...artists.values()].filter((a) => a.name).map((a) => ({ id: a.id, name: a.name })),
    genres,
    topGenres,
    dislikedArtists: new Set(Object.entries(feedback.artists || {}).filter(([, s]) => s < 0).map(([id]) => id))
  };
}
