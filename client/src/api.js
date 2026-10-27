import axios from 'axios';

export const SERVER = import.meta.env.VITE_SERVER_URL || 'http://127.0.0.1:8088';

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
      : status === 429 ? 'Slow down a little; too many requests'
        : code === 'upstream_unavailable' ? `${err.response.data.upstream} is unavailable right now`
          : 'Something went wrong';
    throw new ApiError(message, status);
  }
}

export const api = {
  me: () => call(http.get('/api/me')),
  topArtists: (timeRange) => call(http.get('/api/me/top-artists', { params: { time_range: timeRange } })),
  concerts: (loc) => call(http.get('/api/concerts', { params: loc || {} })),
  recommendations: (loc, radius) => call(http.get('/api/recommendations', { params: { ...loc, radius } })),
  feedback: () => call(http.get('/api/feedback')),
  sendFeedback: (type, id, signal) => call(http.post('/api/feedback', { type, id, signal })),
  logout: () => call(http.post('/auth/logout')),
  loginUrl: `${SERVER}/auth/login`
};
