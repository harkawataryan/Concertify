import { bestMatch } from '../lib/fuzzy.js';
import { haversineMiles } from '../lib/geo.js';
import { genreVectors, genreSimilarity, cosine } from './taste.js';

/**
 * Two-stage event recommender.
 *
 * Stage 1 (retrieval) scores every event near the user using only data we
 * already have: Ticketmaster's genre labels and a fuzzy match of performer
 * names against the user's top artists. It's cheap, so it runs over hundreds
 * of events.
 *
 * Stage 2 (ranking) takes the best candidates, resolves each performer to a
 * Spotify artist (cached), and computes the full affinity score from the
 * user's artist weights, genre vector, distance, date and explicit feedback.
 * A final maximal-marginal-relevance pass trades a little affinity for
 * variety so the list isn't ten shows from one genre.
 */

export const WEIGHTS = {
  direct: 0.55, // user already listens to this artist
  genre: 0.30, // genre overlap with the user's profile
  proximity: 0.08,
  soon: 0.07
};

const STAGE1_KEEP = 60;
const MAX_ATTRACTIONS_PER_EVENT = 2;
const DISTANCE_SCALE_MI = 40; // proximity score halves every ~28 miles
const DATE_SCALE_DAYS = 120;
const DIRECT_NAME_THRESHOLD = 0.88;

export async function recommendEvents({
  events,
  profile,
  origin = null,
  resolveArtist,
  now = Date.now(),
  limit = 20,
  diversity = 0.3,
  likedArtists = new Set()
}) {
  const stage1 = events
    .map((event) => ({ event, prelim: preliminaryScore(event, profile) }))
    .filter((c) => c.prelim.score > 0)
    .sort((a, b) => b.prelim.score - a.prelim.score);

  // Keep every direct hit plus the best genre matches. Direct hits are rare
  // and never worth dropping to save a lookup.
  const candidates = stage1.filter((c, i) => c.prelim.direct > 0 || i < STAGE1_KEEP);

  const scored = [];
  for (const c of candidates) {
    const result = await scoreCandidate(c, { profile, origin, resolveArtist, now, likedArtists });
    if (result) scored.push(result);
  }

  const grouped = groupByArtist(scored);
  const ranked = rerankForDiversity(grouped, { limit, diversity });
  const discover = grouped
    .filter((r) => r.components.direct === 0 && r.components.genre >= 0.25 && r.artist)
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, 10)
    .map((r) => ({ artist: r.artist, affinity: r.affinity, reasons: r.reasons, event: r.event }));

  return {
    recommendations: ranked,
    discover,
    meta: { scanned: events.length, candidates: candidates.length, scored: scored.length }
  };
}

function preliminaryScore(event, profile) {
  const direct = directFromNames(event, profile);
  const tm = genreVectors(event.genres.map((g) => [g, 1]));
  const genre = cosine(tm.tokens, profile.genres.tokens);
  return { direct, genre, score: 0.6 * direct + 0.4 * genre };
}

function directFromNames(event, profile) {
  let best = 0;
  for (const a of event.attractions) {
    const byId = a.spotifyId && profile.artists.get(a.spotifyId);
    if (byId) {
      best = Math.max(best, byId.weight);
      continue;
    }
    const hit = bestMatch(a.name, profile.artistNames, { threshold: DIRECT_NAME_THRESHOLD, key: (x) => x.name });
    if (hit) best = Math.max(best, profile.artists.get(hit.match.id)?.weight || 0);
  }
  return best;
}

async function scoreCandidate({ event }, { profile, origin, resolveArtist, now, likedArtists }) {
  const attractions = event.attractions.slice(0, MAX_ATTRACTIONS_PER_EVENT);
  const resolved = (await Promise.all(attractions.map((a) => resolveArtist(a)))).filter(Boolean);

  if (resolved.some((a) => profile.dislikedArtists.has(a.id))) return null;

  let direct = 0;
  let directArtist = null;
  for (const a of resolved) {
    const w = profile.artists.get(a.id)?.weight || 0;
    if (w > direct) {
      direct = w;
      directArtist = a;
    }
  }
  // Fall back to the name match when Spotify search couldn't resolve the performer.
  if (direct === 0) direct = directFromNames(event, profile);

  // Candidate genre vector: Spotify genres at full weight, Ticketmaster's
  // coarser labels at half so they inform but don't dominate.
  const weighted = [];
  for (const a of resolved) for (const g of a.genres) weighted.push([g, 1]);
  for (const g of event.genres) weighted.push([g, 0.5]);
  const candidateGenres = genreVectors(weighted);
  const genre = genreSimilarity(candidateGenres, profile.genres);

  const distanceMi = origin && event.venue.lat != null ? haversineMiles(origin, event.venue) : null;
  const proximity = distanceMi == null ? 0.5 : Math.exp(-distanceMi / DISTANCE_SCALE_MI);

  const eventTime = Date.parse(event.dateTime || event.date);
  const daysOut = Number.isNaN(eventTime) ? null : Math.max(0, (eventTime - now) / 86_400_000);
  const soon = daysOut == null ? 0.5 : Math.exp(-daysOut / DATE_SCALE_DAYS);

  const primary = directArtist || resolved[0] || null;
  let affinity = WEIGHTS.direct * direct + WEIGHTS.genre * genre + WEIGHTS.proximity * proximity + WEIGHTS.soon * soon;
  if (primary && likedArtists.has(primary.id)) affinity += 0.15;
  affinity = Math.min(1, affinity);

  const components = { direct, genre, proximity, soon };
  return {
    event,
    artist: primary,
    affinity: round(affinity),
    components: Object.fromEntries(Object.entries(components).map(([k, v]) => [k, round(v)])),
    genreVector: candidateGenres,
    distanceMi: distanceMi == null ? null : Math.round(distanceMi),
    daysOut: daysOut == null ? null : Math.round(daysOut),
    reasons: explain({ direct, genre, primary, candidateGenres, profile, distanceMi, daysOut })
  };
}

function explain({ direct, genre, primary, candidateGenres, profile, distanceMi, daysOut }) {
  const reasons = [];
  if (direct >= 0.5) reasons.push(`${primary?.name || 'This artist'} is one of your most-played artists`);
  else if (direct > 0) reasons.push(`You listen to ${primary?.name || 'this artist'}`);

  const shared = [...candidateGenres.exact.keys()]
    .filter((g) => profile.genres.exact.has(g))
    .sort((a, b) => profile.genres.exact.get(b) - profile.genres.exact.get(a))
    .slice(0, 3);
  if (shared.length) reasons.push(`Matches your taste in ${shared.join(', ')}`);
  else if (genre > 0.2) reasons.push('Similar to genres you listen to');
  if (direct === 0 && genre >= 0.25) reasons.push('New to you');

  if (distanceMi != null && distanceMi <= 25) reasons.push(`${Math.round(distanceMi)} mi away`);
  if (daysOut != null && daysOut <= 14) reasons.push(daysOut < 1 ? 'Tonight' : `In ${Math.round(daysOut)} days`);
  return reasons;
}

/**
 * Collapses multiple dates of the same artist into one card with the best
 * scoring date first. Without this, a three-night residency fills the top
 * of the list with near-identical results.
 */
function groupByArtist(scored) {
  const byKey = new Map();
  for (const r of scored) {
    const key = r.artist?.id || r.event.attractions[0]?.id || r.event.id;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...r, moreDates: [] });
    } else if (r.affinity > existing.affinity) {
      byKey.set(key, { ...r, moreDates: [...existing.moreDates, slimDate(existing.event)] });
    } else {
      existing.moreDates.push(slimDate(r.event));
    }
  }
  return [...byKey.values()];
}

function slimDate(event) {
  return { id: event.id, date: event.date, venue: event.venue.name, url: event.url };
}

/**
 * Maximal marginal relevance: greedily pick the item that maximizes
 * (1 - d) * affinity - d * (max genre similarity to already-picked items).
 */
export function rerankForDiversity(items, { limit, diversity }) {
  const remaining = [...items];
  const picked = [];
  while (picked.length < limit && remaining.length) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const r = remaining[i];
      const redundancy = picked.length
        ? Math.max(...picked.map((p) => genreSimilarity(r.genreVector, p.genreVector)))
        : 0;
      const mmr = (1 - diversity) * r.affinity - diversity * redundancy;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestIdx = i;
      }
    }
    picked.push(remaining.splice(bestIdx, 1)[0]);
  }
  // genreVector is internal; strip it from the API response.
  return picked.map(({ genreVector, ...rest }) => rest);
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}
