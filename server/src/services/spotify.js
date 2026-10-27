import { requestWithRetry } from '../lib/http.js';
import { normalizeName, bestMatch } from '../lib/fuzzy.js';

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';

export const TIME_RANGES = ['short_term', 'medium_term', 'long_term'];

/**
 * Spotify client. Token refresh is handled by the auth middleware, which
 * calls refreshAccessToken() before a request if the session token is about
 * to expire; this module itself is stateless.
 */
export function createSpotifyClient({ clientId, clientSecret, redirectUri, withCache, limit = (fn) => fn() }) {
  const basicAuth = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const apiGet = (url, accessToken, params) => limit(() => requestWithRetry({
    url, params, headers: { Authorization: `Bearer ${accessToken}` }
  }, { upstream: 'spotify' }));

  async function tokenRequest(form) {
    const res = await requestWithRetry({
      method: 'post',
      url: `${ACCOUNTS}/api/token`,
      data: new URLSearchParams(form).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth }
    }, { upstream: 'spotify-auth', retries: 1 });
    return {
      accessToken: res.data.access_token,
      // Spotify only returns a new refresh token sometimes; callers keep the old one otherwise.
      refreshToken: res.data.refresh_token,
      expiresAt: Date.now() + res.data.expires_in * 1000
    };
  }

  return {
    authorizeUrl({ state, scopes }) {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        scope: scopes.join(' '),
        redirect_uri: redirectUri,
        state
      });
      return `${ACCOUNTS}/authorize?${params}`;
    },

    exchangeCode(code) {
      return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
    },

    refreshAccessToken(refreshToken) {
      return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
    },

    async getProfile(accessToken) {
      const res = await requestWithRetry({
        url: `${API}/me`,
        headers: { Authorization: `Bearer ${accessToken}` }
      }, { upstream: 'spotify' });
      return { id: res.data.id, displayName: res.data.display_name, country: res.data.country };
    },

    /** Top artists for one listening window; cached briefly per user so page loads don't refetch. */
    async getTopArtists(accessToken, { userId, timeRange = 'medium_term', limit = 50 }) {
      return withCache(`spotify:top:${userId}:${timeRange}:${limit}`, 10 * 60, async () => {
        const res = await requestWithRetry({
          url: `${API}/me/top/artists`,
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { limit, time_range: timeRange }
        }, { upstream: 'spotify' });
        return (res.data.items || []).map(slimArtist);
      });
    },

    /** Top artists across every listening window, keyed by range. */
    async getTopArtistsAllRanges(accessToken, { userId }) {
      const results = await Promise.all(
        TIME_RANGES.map((timeRange) => this.getTopArtists(accessToken, { userId, timeRange }))
      );
      return Object.fromEntries(TIME_RANGES.map((r, i) => [r, results[i]]));
    },

    async getArtist(accessToken, id) {
      return withCache(`spotify:artist:${id}`, 24 * 3600, async () => {
        const res = await apiGet(`${API}/artists/${id}`, accessToken);
        return slimArtist(res.data);
      });
    },

    /**
     * Resolves a free-text name (usually from Ticketmaster) to a Spotify
     * artist. Cached for a day per normalized name since the mapping is
     * stable and this is the most frequent upstream call in the recommender.
     */
    async findArtistByName(accessToken, name) {
      const key = normalizeName(name);
      if (!key) return null;
      const result = await withCache(`spotify:search:${key}`, 24 * 3600, async () => {
        const res = await apiGet(`${API}/search`, accessToken, {
          q: `artist:"${name.replace(/"/g, '')}"`, type: 'artist', limit: 5
        });
        const items = (res.data.artists?.items || []).map(slimArtist);
        const hit = bestMatch(name, items, { threshold: 0.85, key: (a) => a.name });
        // Cache misses too (as null), otherwise every unknown local act costs a search per load.
        return hit ? hit.match : null;
      });
      return result ?? null;
    }
  };
}

export function slimArtist(a) {
  return {
    id: a.id,
    name: a.name,
    genres: a.genres || [],
    popularity: a.popularity ?? 0,
    image: a.images?.[0]?.url || null,
    url: a.external_urls?.spotify || null
  };
}
