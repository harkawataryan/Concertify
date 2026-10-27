import { bestMatch } from '../lib/fuzzy.js';
import { haversineMiles } from '../lib/geo.js';
import { genreVectors, genreSimilarity, cosine } from './taste.js';
import { profileToProto } from './rankerClient.js';

/**
 * Two-stage event recommender.
 *
 * Stage 1 (retrieval) scores every event near the user using only data we
 * already have: Ticketmaster's genre labels and a fuzzy match of performer
 * names against the user's top artists. It's cheap, so it runs over hundreds
 * of events.
 *
 * Stage 2 (ranking) takes the best candidates, resolves each performer, and
 * computes the full affinity score from the user's artist weights, genre
 * vector, distance, date and explicit feedback, then applies a maximal-
 * marginal-relevance pass for variety. When a `ranker` client is provided
 * the numeric work runs in the Go ranking service; otherwise the reference
 * implementation below runs in-process (tests, local dev).
 */

export const WEIGHTS = {
  direct: 0.55, // user already listens to this artist
  genre: 0.30, // genre overlap with the user's profile
  proximity: 0.08,
  soon: 0.07
};

const STAGE1_KEEP = 60;
const SCORE_CONCURRENCY = 6;
const MAX_ATTRACTIONS_PER_EVENT = 2;
const DISTANCE_SCALE_MI = 40; // proximity score halves every ~28 miles
const DATE_SCALE_DAYS = 120;
const DIRECT_NAME_THRESHOLD = 0.88;
const LIKED_BOOST = 0.15;

export async function recommendEvents({
  events,
  profile,
  origin = null,
  resolveArtist,
  now = Date.now(),
  limit = 20,
  diversity = 0.3,
  likedArtists = new Set(),
  weights = WEIGHTS,
  ranker = null
}) {
  const candidates = retrieve(events, profile);
  const prepared = (await mapLimit(candidates, SCORE_CONCURRENCY, (c) => prepareCandidate(c, {
    profile, origin, resolveArtist, now, likedArtists
  }))).filter(Boolean);

  const scored = ranker
    ? await scoreRemotely(prepared, { profile, weights, ranker })
    : prepared.map((p) => scoreLocally(p, profile, weights));

  const explained = scored.map((s) => ({ ...s, reasons: explain(s, profile) }));
  const grouped = groupByArtist(explained);
  const ranked = ranker
    ? await rerankRemotely(grouped, { profile, weights, limit, diversity, ranker })
    : rerankForDiversity(grouped, { limit, diversity });

  const discover = grouped
    .filter((r) => r.components.direct === 0 && r.components.genre >= 0.25 && r.artist)
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, 10)
    .map((r) => ({
      artist: { ...r.artist, image: r.artist.image || r.event.image },
      affinity: r.affinity,
      reasons: r.reasons,
      event: r.event
    }));

  return {
    recommendations: ranked.map(stripInternal),
    discover,
    meta: { scanned: events.length, candidates: candidates.length, scored: scored.length, ranker: ranker ? 'grpc' : 'local' }
  };
}

/** Stage 1: cheap scoring over every event; keeps direct hits and the best genre matches. */
export function retrieve(events, profile) {
  const stage1 = events
    .map((event) => ({ event, prelim: preliminaryScore(event, profile) }))
    .filter((c) => c.prelim.score > 0)
    .sort((a, b) => b.prelim.score - a.prelim.score);
  // Direct hits are rare and never worth dropping to save a lookup.
  return stage1.filter((c, i) => c.prelim.direct > 0 || i < STAGE1_KEEP);
}

/** Ticketmaster genre labels from the event and its performers, deduplicated. */
export function ticketmasterGenres(event) {
  const out = new Set(event.genres);
  for (const a of event.attractions) for (const g of a.genres || []) out.add(g);
  return [...out];
}

function preliminaryScore(event, profile) {
  const { weight: direct } = directFromNames(event, profile);
  const tm = genreVectors(ticketmasterGenres(event).map((g) => [g, 1]));
  const genre = cosine(tm.tokens, profile.genres.tokens);
  return { direct, genre, score: 0.6 * direct + 0.4 * genre };
}

/** Strongest profile match among the event's performers, by Spotify id or fuzzy name. */
export function directFromNames(event, profile) {
  let best = { weight: 0, attraction: null };
  for (const a of event.attractions) {
    const byId = a.spotifyId && profile.artists.get(a.spotifyId);
    let weight = byId ? byId.weight : 0;
    if (!byId) {
      const hit = bestMatch(a.name, profile.artistNames, { threshold: DIRECT_NAME_THRESHOLD, key: (x) => x.name });
      if (hit) weight = profile.artists.get(hit.match.id)?.weight || 0;
    }
    if (weight > best.weight) best = { weight, attraction: a };
  }
  return best;
}

/**
 * Resolves performers and gathers everything the scorer needs: direct
 * weight, candidate genre labels, distance, days out. Returns null when the
 * user has thumbed the performer down.
 */
export async function prepareCandidate({ event }, { profile, origin, resolveArtist, now, likedArtists }) {
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
  // Fall back to the name match when ids didn't line up, and make sure the
  // card is headlined by the performer that matched, not whoever is listed first.
  if (direct === 0) {
    const byName = directFromNames(event, profile);
    if (byName.weight > 0) {
      direct = byName.weight;
      directArtist = resolved.find((a) => a.name === byName.attraction.name)
        || { id: byName.attraction.spotifyId || `tm:${byName.attraction.id}`, name: byName.attraction.name, genres: byName.attraction.genres || [], image: null, url: null };
    }
  }

  // Candidate genre labels: Spotify genres when present (rare now), plus
  // Ticketmaster's event and performer labels.
  const genres = [];
  for (const a of resolved) for (const g of a.genres || []) genres.push(g);
  for (const g of ticketmasterGenres(event)) genres.push(g);

  const distanceMi = origin && event.venue.lat != null ? haversineMiles(origin, event.venue) : null;
  const eventTime = Date.parse(event.dateTime || event.date);
  const daysOut = Number.isNaN(eventTime) ? null : Math.max(0, (eventTime - now) / 86_400_000);
  const primary = directArtist || resolved[0] || null;

  return {
    event,
    artist: primary,
    direct,
    genres,
    genreVector: genreVectors(genres.map((g) => [g, 1])),
    liked: Boolean(primary && likedArtists.has(primary.id)),
    distanceMi,
    daysOut
  };
}

/** Reference scorer; the Go service's scoreOne is a port of this. */
export function scoreLocally(p, profile, weights = WEIGHTS) {
  return finishScore(p, {
    direct: p.direct,
    genre: genreSimilarity(p.genreVector, profile.genres),
    proximity: p.distanceMi == null ? 0.5 : Math.exp(-p.distanceMi / DISTANCE_SCALE_MI),
    soon: p.daysOut == null ? 0.5 : Math.exp(-p.daysOut / DATE_SCALE_DAYS)
  }, weights);
}

function finishScore(p, components, weights, affinityOverride) {
  let affinity = affinityOverride;
  if (affinity == null) {
    affinity = weights.direct * components.direct + weights.genre * components.genre
      + weights.proximity * components.proximity + weights.soon * components.soon;
    if (p.liked) affinity += LIKED_BOOST;
    affinity = Math.min(1, affinity);
  }
  return {
    event: p.event,
    artist: p.artist,
    affinity: round(affinity),
    components: Object.fromEntries(['direct', 'genre', 'proximity', 'soon'].map((k) => [k, round(components[k])])),
    genreVector: p.genreVector,
    distanceMi: p.distanceMi == null ? null : Math.round(p.distanceMi),
    daysOut: p.daysOut == null ? null : Math.round(p.daysOut),
    candidate: p
  };
}

/** Candidate in the shape the gRPC Ranker expects. */
export function toProtoCandidate(p, directByMember) {
  return {
    id: p.event.id,
    artist_id: p.artist?.id || p.event.attractions[0]?.id || p.event.id,
    direct: p.direct,
    genres: p.genres,
    distance_mi: p.distanceMi == null ? -1 : p.distanceMi,
    days_out: p.daysOut == null ? -1 : p.daysOut,
    liked: p.liked,
    direct_by_member: directByMember || {}
  };
}

async function scoreRemotely(prepared, { profile, weights, ranker }) {
  if (!prepared.length) return [];
  const res = await ranker.rank({
    candidates: prepared.map((p) => toProtoCandidate(p)),
    profile: profileToProto(profile),
    weights,
    limit: prepared.length,
    diversity: 0
  });
  const byId = new Map(prepared.map((p) => [p.event.id, p]));
  return res.all.map((s) => finishScore(byId.get(s.id), s.components, weights, s.affinity));
}

/** Diversity re-ranking over the grouped (one per artist) list, delegated to Go. */
async function rerankRemotely(grouped, { profile, weights, limit, diversity, ranker }) {
  if (!grouped.length) return [];
  const res = await ranker.rank({
    candidates: grouped.map((g) => toProtoCandidate(g.candidate)),
    profile: profileToProto(profile),
    weights,
    limit,
    diversity
  });
  const byId = new Map(grouped.map((g) => [g.event.id, g]));
  return res.results.map((s) => byId.get(s.id)).filter(Boolean);
}

function explain({ components, artist, genreVector, distanceMi, daysOut }, profile) {
  const { direct, genre } = components;
  const reasons = [];
  if (direct >= 0.5) reasons.push(`${artist?.name || 'This artist'} is one of your most-played artists`);
  else if (direct > 0) reasons.push(`You listen to ${artist?.name || 'this artist'}`);

  const shared = [...genreVector.exact.keys()]
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
  const remaining = [...items].sort((a, b) => b.affinity - a.affinity);
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
  return picked.map(stripInternal);
}

/** genreVector and candidate are internal; strip them from API responses. */
function stripInternal({ genreVector, candidate, ...rest }) {
  return rest;
}

async function mapLimit(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}
