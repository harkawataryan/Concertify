import axios from 'axios';

// barebones score: shared genre count + popularity * tiny factor
function scoreCandidate(candidate, genreBag) {
  const shared = (candidate.genres || []).filter(g => genreBag.has(g)).length;
  return shared + (candidate.popularity || 0) * 0.01;
}

export async function recommendArtists(accessToken) {
  // pull user top artists
  const top = await axios.get('https://api.spotify.com/v1/me/top/artists', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { limit: 10, time_range: 'medium_term' }
  }).then(r => r.data.items || []);

  const genreBag = new Set();
  top.forEach(a => (a.genres || []).forEach(g => genreBag.add(g)));

  // grab related artists for each top artist, merge candidates
  const candidates = new Map();
  for (const a of top) {
    try {
      const rel = await axios.get(`https://api.spotify.com/v1/artists/${a.id}/related-artists`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      }).then(r => r.data.artists || []);
      rel.forEach(c => {
        if (!candidates.has(c.id)) candidates.set(c.id, c);
      });
    } catch (e) {
      // if one fails, meh, continue
      console.warn('related failed for', a.name);
    }
  }

  // score and sort
  const scored = Array.from(candidates.values())
    .filter(c => !top.find(t => t.id === c.id)) // avoid recommending already-top artists
    .map(c => ({ ...c, _score: scoreCandidate(c, genreBag) }))
    .sort((a, b) => b._score - a._score);

  // hand back trimmed fields
  return scored.slice(0, 30).map(a => ({
    id: a.id,
    name: a.name,
    genres: a.genres,
    popularity: a.popularity,
    image: a.images?.[0]?.url
  }));
}
