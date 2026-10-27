/**
 * Fuzzy name matching for reconciling artist names across Spotify and
 * Ticketmaster, which disagree constantly: "The Weeknd" vs "Weeknd",
 * "Tyler, The Creator" vs "Tyler the Creator", trailing " - Tour 2026", etc.
 */

const STRIP_SUFFIX = /\s*[-–:|(].*$/;

export function normalizeName(name = '') {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // accents
    .replace(STRIP_SUFFIX, '') // "Artist - World Tour" -> "artist"
    .replace(/&/g, 'and')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i += 1) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

/** Sørensen–Dice similarity on character bigrams, in [0, 1]. */
export function similarity(a, b) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const bx = bigrams(x);
  const by = bigrams(y);
  let overlap = 0;
  for (const [g, n] of bx) overlap += Math.min(n, by.get(g) || 0);
  return (2 * overlap) / (x.length - 1 + y.length - 1);
}

/**
 * Finds the best candidate for a query name. Returns null below the
 * threshold, which is deliberately high: a false positive here means telling
 * a user their favorite artist is playing when it's a cover band.
 */
export function bestMatch(query, candidates, { threshold = 0.85, key = (c) => c } = {}) {
  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const s = similarity(query, key(c));
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return bestScore >= threshold ? { match: best, score: bestScore } : null;
}
