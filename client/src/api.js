import axios from 'axios';

// In development the API runs on its own port; in production the server
// serves this bundle itself, so requests are same-origin.
export const SERVER = import.meta.env.VITE_SERVER_URL ?? (import.meta.env.DEV ? 'http://127.0.0.1:8088' : '');

const http = axios.create({ baseURL: SERVER, withCredentials: true, timeout: 30_000 });

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function call(promise) {
  try {
    return (await promise).data;
  } catch (err) {
    const status = err.response?.status;
    const code = err.response?.data?.error;
    const message = status === 401 ? 'Please log in again'
      : status === 429 ? 'Too many requests; give it a moment'
        : status === 404 ? 'Not found'
          : code === 'upstream_unavailable' ? `${err.response.data.upstream} is unavailable right now`
            : typeof code === 'string' && status === 400 ? code
              : 'Something went wrong';
    throw new ApiError(message, status);
  }
}

function locParams(loc) {
  return loc ? { lat: loc.lat, lng: loc.lng } : {};
}

export const api = {
  loginUrl: (returnTo) => `${SERVER}/auth/login${returnTo ? `?return=${encodeURIComponent(returnTo)}` : ''}`,
  logout: () => call(http.post('/auth/logout')),

  me: () => call(http.get('/api/me')),
  saveLocation: (location) => call(http.put('/api/me/location', location)),
  topArtists: (timeRange) => call(http.get('/api/me/top-artists', { params: { time_range: timeRange } })),
  taste: () => call(http.get('/api/me/taste')),

  recommendations: (loc, radius, filters = {}) => call(http.get('/api/recommendations', {
    params: {
      ...locParams(loc),
      radius,
      limit: filters.limit,
      from: filters.from || undefined,
      to: filters.to || undefined,
      weekend: filters.weekend ? 1 : undefined,
      maxPrice: filters.maxPrice || undefined,
      genres: filters.genres?.length ? filters.genres.join(',') : undefined,
      exclude: filters.exclude?.length ? filters.exclude.join(',') : undefined
    }
  })),
  concerts: (loc) => call(http.get('/api/concerts', { params: locParams(loc) })),
  calendarUrl: (eventId) => `${SERVER}/api/events/${encodeURIComponent(eventId)}/calendar.ics`,

  watchlist: () => call(http.get('/api/watchlist')),
  addToWatchlist: (artist) => call(http.put(`/api/watchlist/${encodeURIComponent(artist.id)}`, artist)),
  removeFromWatchlist: (artistId) => call(http.delete(`/api/watchlist/${encodeURIComponent(artistId)}`)),

  alerts: () => call(http.get('/api/alerts')),
  markAlertsRead: (body) => call(http.post('/api/alerts/read', body)),
  refreshAlerts: () => call(http.post('/api/alerts/refresh')),

  feedback: () => call(http.get('/api/feedback')),
  sendFeedback: (type, id, signal) => call(http.post('/api/feedback', { type, id, signal })),

  plans: () => call(http.get('/api/plans')),
  createPlan: (name) => call(http.post('/api/plans', { name })),
  plan: (code) => call(http.get(`/api/plans/${encodeURIComponent(code)}`)),
  leavePlan: (code) => call(http.delete(`/api/plans/${encodeURIComponent(code)}/members/me`)),
  planRecommendations: (code, loc, radius, limit) => call(http.get(`/api/plans/${encodeURIComponent(code)}/recommendations`, {
    params: { ...locParams(loc), radius, limit }
  }))
};
