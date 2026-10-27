/**
 * Durable-ish per-user and per-plan documents on top of the cache backend.
 *
 * The same Memory/Redis backends serve both caching and storage: the memory
 * backend is for development, Redis for deployments. Documents are small
 * JSON blobs written whole; the read-modify-write in updateUser is not
 * atomic, which is fine for one user's own clicks but would need a Lua
 * script or a real database under concurrent writers.
 */

const DOC_TTL_SEC = 365 * 24 * 3600;
const USER_INDEX_KEY = 'users:index';

export function defaultUser(id) {
  return {
    id,
    displayName: null,
    location: null, // {name, lat, lng, radius}
    watchlist: {}, // artistId -> Artist & {addedAt}
    feedback: { artists: {}, genres: {} },
    examples: [], // {features, label, at} from ratings, for learned ranking weights
    alerts: [], // newest first, capped
    alertedEventIds: {}, // eventId -> ISO date, so a show is only alerted once
    plans: [] // plan codes
  };
}

export function createStore(cache) {
  const userKey = (id) => `user:${id}`;
  const planKey = (code) => `plan:${code}`;

  async function indexUser(id) {
    const ids = (await cache.get(USER_INDEX_KEY)) || [];
    if (!ids.includes(id)) await cache.set(USER_INDEX_KEY, [...ids, id], DOC_TTL_SEC);
  }

  return {
    async getUser(id) {
      return { ...defaultUser(id), ...((await cache.get(userKey(id))) || {}) };
    },

    /** Applies `mutate(user)` (may return a new object or mutate in place) and saves. */
    async updateUser(id, mutate) {
      const user = await this.getUser(id);
      const next = (await mutate(user)) || user;
      await cache.set(userKey(id), next, DOC_TTL_SEC);
      await indexUser(id);
      return next;
    },

    async listUserIds() {
      return (await cache.get(USER_INDEX_KEY)) || [];
    },

    async getPlan(code) {
      return (await cache.get(planKey(code))) || null;
    },

    async setPlan(plan) {
      await cache.set(planKey(plan.code), plan, DOC_TTL_SEC);
      return plan;
    }
  };
}
