import { buildTasteProfile } from './taste.js';
import { recommendEvents } from './recommender.js';

/**
 * Group ranking: score the same events for every member, then combine.
 *
 * Plain averaging lets one superfan drag the group to a show nobody else
 * wants, so the group score blends the mean with the minimum ("least
 * misery"). The weights favor the mean because a group of five rarely has
 * a show everyone scores highly, but the floor still matters.
 */
export const GROUP_WEIGHTS = { mean: 0.7, min: 0.3 };
const CONSENSUS_THRESHOLD = 0.3;

export async function rankForGroup({ plan, events, origin, resolveArtist, now = Date.now(), limit = 20 }) {
  const members = plan.members;
  const perMember = await Promise.all(members.map(async (m) => {
    const profile = buildTasteProfile(m.topByRange || {});
    const { recommendations } = await recommendEvents({
      events, profile, origin, resolveArtist, now, limit: 500, diversity: 0
    });
    return { member: m, recs: recommendations };
  }));

  // Key by headline artist so each member's choice of date collapses together.
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

  const n = members.length;
  const ranked = [...byKey.values()].map(({ best, affinities }) => {
    const scores = members.map((m) => ({ id: m.id, displayName: m.displayName, affinity: affinities.get(m.id) || 0 }));
    const mean = scores.reduce((s, x) => s + x.affinity, 0) / n;
    const min = Math.min(...scores.map((x) => x.affinity));
    const fans = scores.filter((x) => x.affinity >= CONSENSUS_THRESHOLD).length;
    return {
      ...best,
      groupScore: round(GROUP_WEIGHTS.mean * mean + GROUP_WEIGHTS.min * min),
      perMember: scores.sort((a, b) => b.affinity - a.affinity),
      consensus: fans === n ? 'everyone' : fans * 2 >= n ? 'most' : 'some',
      reasons: groupReasons(scores, best)
    };
  });

  return ranked.sort((a, b) => b.groupScore - a.groupScore).slice(0, limit);
}

function groupReasons(scores, best) {
  const fans = scores.filter((x) => x.affinity >= CONSENSUS_THRESHOLD);
  const reasons = [];
  if (fans.length === scores.length) reasons.push('A match for everyone');
  else if (fans.length) reasons.push(`A match for ${fans.map((f) => f.displayName).join(', ')}`);
  const direct = best.reasons.find((r) => /most-played|You listen to/.test(r));
  if (direct) reasons.push(direct.replace(/^You listen to/, `${scores[0].displayName} listens to`).replace('your', `${scores[0].displayName}'s`));
  const near = best.reasons.find((r) => / mi away$/.test(r));
  if (near) reasons.push(near);
  return reasons;
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}
