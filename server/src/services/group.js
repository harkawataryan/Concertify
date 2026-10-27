import { buildTasteProfile } from './taste.js';
import { recommendEvents, retrieve, prepareCandidate, directFromNames, toProtoCandidate } from './recommender.js';
import { profileToProto } from './rankerClient.js';

/**
 * Group ranking: score the same events for every member, then combine.
 *
 * Plain averaging lets one superfan drag the group to a show nobody else
 * wants, so the group score blends the mean with the minimum ("least
 * misery"). The weights favor the mean because a group of five rarely has
 * a show everyone scores highly, but the floor still matters.
 *
 * With a `ranker` client the per-member scoring and aggregation run in the
 * Go service in one RPC; otherwise each member is ranked in-process.
 */
export const GROUP_WEIGHTS = { mean: 0.7, min: 0.3 };
const CONSENSUS_THRESHOLD = 0.3;

export async function rankForGroup({ plan, events, origin, resolveArtist, now = Date.now(), limit = 20, ranker = null }) {
  const members = plan.members.map((m) => ({ ...m, profile: buildTasteProfile(m.topByRange || {}) }));
  const entries = ranker
    ? await scoreGroupRemotely({ members, events, origin, resolveArtist, now, limit, ranker })
    : await scoreGroupLocally({ members, events, origin, resolveArtist, now });

  const n = members.length;
  const ranked = entries.map(({ best, affinities }) => {
    const scores = members.map((m) => ({ id: m.id, displayName: m.displayName, affinity: affinities.get(m.id) || 0 }));
    const mean = scores.reduce((s, x) => s + x.affinity, 0) / n;
    const min = Math.min(...scores.map((x) => x.affinity));
    const fans = scores.filter((x) => x.affinity >= CONSENSUS_THRESHOLD).length;
    return {
      ...best,
      groupScore: best.groupScore ?? round(GROUP_WEIGHTS.mean * mean + GROUP_WEIGHTS.min * min),
      perMember: scores.sort((a, b) => b.affinity - a.affinity),
      consensus: fans === n ? 'everyone' : fans * 2 > n ? 'most' : 'some',
      reasons: groupReasons(scores, best)
    };
  });

  return ranked.sort((a, b) => b.groupScore - a.groupScore).slice(0, limit);
}

/** Reference path: rank for each member, then merge by headline artist. */
async function scoreGroupLocally({ members, events, origin, resolveArtist, now }) {
  const perMember = await Promise.all(members.map(async (m) => {
    const { recommendations } = await recommendEvents({
      events, profile: m.profile, origin, resolveArtist, now, limit: 500, diversity: 0
    });
    return { member: m, recs: recommendations };
  }));

  const byKey = new Map();
  for (const { member, recs } of perMember) {
    for (const rec of recs) {
      const key = rec.artist?.id || rec.event.id;
      const entry = byKey.get(key) || { best: rec, bestAffinity: -1, affinities: new Map() };
      entry.affinities.set(member.id, rec.affinity);
      if (rec.affinity > entry.bestAffinity) {
        entry.best = rec;
        entry.bestAffinity = rec.affinity;
      }
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()];
}

/**
 * gRPC path: the union of every member's retrieval set goes to the ranker
 * with per-member direct weights; Go scores each member and aggregates.
 */
async function scoreGroupRemotely({ members, events, origin, resolveArtist, now, limit, ranker }) {
  const union = new Map();
  for (const m of members) for (const c of retrieve(events, m.profile)) union.set(c.event.id, c);
  // Prepare with the first member's profile for performer resolution; direct
  // weights are recomputed per member below.
  const prepared = (await Promise.all([...union.values()].map((c) => prepareCandidate(c, {
    profile: members[0].profile, origin, resolveArtist, now, likedArtists: new Set()
  })))).filter(Boolean);

  const candidates = prepared.map((p) => toProtoCandidate(p, Object.fromEntries(
    members.map((m) => [m.id, directFromNames(p.event, m.profile).weight])
  )));
  const res = await ranker.rankGroup({
    candidates,
    members: members.map((m) => ({ id: m.id, profile: profileToProto(m.profile) })),
    limit: limit * 3, // leave room for collapsing dates of the same artist
    mean_weight: GROUP_WEIGHTS.mean,
    min_weight: GROUP_WEIGHTS.min
  });

  const byEvent = new Map(prepared.map((p) => [p.event.id, p]));
  const byKey = new Map();
  for (const g of res.results) {
    const p = byEvent.get(g.id);
    if (!p) continue;
    const key = p.artist?.id || p.event.id;
    if (byKey.has(key)) continue; // results arrive best-first; keep the top date per artist
    byKey.set(key, {
      best: {
        event: p.event,
        artist: p.artist,
        affinity: round(g.per_member[0]?.affinity || 0),
        groupScore: round(g.group_score),
        components: g.components,
        moreDates: [],
        distanceMi: p.distanceMi == null ? null : Math.round(p.distanceMi),
        daysOut: p.daysOut == null ? null : Math.round(p.daysOut),
        reasons: []
      },
      affinities: new Map(g.per_member.map((s) => [s.member_id, round(s.affinity)]))
    });
  }
  return [...byKey.values()];
}

function groupReasons(scores, best) {
  const fans = scores.filter((x) => x.affinity >= CONSENSUS_THRESHOLD);
  const reasons = [];
  if (fans.length === scores.length) reasons.push('A match for everyone');
  else if (fans.length) reasons.push(`A match for ${fans.map((f) => f.displayName).join(', ')}`);
  const direct = (best.reasons || []).find((r) => /most-played|You listen to/.test(r));
  if (direct) reasons.push(direct.replace(/^You listen to/, `${scores[0].displayName} listens to`).replace('your', `${scores[0].displayName}'s`));
  else if (best.components?.direct >= 0.5 && best.artist) reasons.push(`${best.artist.name} is one of ${scores[0].displayName}'s most-played artists`);
  if (best.distanceMi != null && best.distanceMi <= 25) reasons.push(`${best.distanceMi} mi away`);
  return reasons;
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}
