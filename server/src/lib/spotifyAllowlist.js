// Manages the Development Mode user allowlist on the Spotify developer
// dashboard, which has no public API. The dashboard's own front end logs in
// with the owner's sp_dc session cookie through a PKCE flow against
// accounts.spotify.com and then calls an internal JSON API; this module does
// the same from the server so visitors can be added (and the oldest evicted)
// without anyone touching the dashboard.
//
// Requires SPOTIFY_DASHBOARD_SP_DC (the owner's sp_dc cookie) and
// SPOTIFY_CLIENT_ID. Everything is best-effort: any failure surfaces as an
// error the caller can turn into a friendly message.

import crypto from 'node:crypto';

const DASHBOARD_CLIENT_ID = 'cfe923b2d660439caf2b557b21f31221'; // the dashboard web app itself
const DASHBOARD_ORIGIN = 'https://developer.spotify.com';
const SCOPES = 'email openid profile user-self-provisioning';
const MAX_USERS = 5;

let cachedToken = null; // { token, expiresAt }

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function allowlistConfigured() {
  return Boolean(process.env.SPOTIFY_DASHBOARD_SP_DC && process.env.SPOTIFY_CLIENT_ID);
}

async function dashboardToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const spdc = process.env.SPOTIFY_DASHBOARD_SP_DC;
  if (!spdc) throw new Error('SPOTIFY_DASHBOARD_SP_DC not set');

  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(9));
  const authUrl =
    'https://accounts.spotify.com/oauth2/v2/auth?' +
    new URLSearchParams({
      response_type: 'code',
      client_id: DASHBOARD_CLIENT_ID,
      scope: SCOPES,
      redirect_uri: DASHBOARD_ORIGIN,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });
  const authRes = await fetch(authUrl, {
    headers: { cookie: `sp_dc=${spdc}`, 'user-agent': 'Mozilla/5.0', accept: 'text/html' },
    redirect: 'manual',
  });
  // With a valid session this is a 303 to the dashboard with ?code=...;
  // in a browser it can instead be a small page that posts the code.
  let code = null;
  const loc = authRes.headers.get('location') || '';
  const q = loc.match(/[?&]code=([A-Za-z0-9_-]+)/);
  if (q) code = q[1];
  else {
    const html = await authRes.text();
    const m = html.match(/["']?code["']?\s*:\s*["']([A-Za-z0-9_-]+)["']/);
    if (m) code = m[1];
  }
  if (!code) throw new Error(`dashboard login failed (status ${authRes.status}); sp_dc cookie may have expired`);

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: DASHBOARD_CLIENT_ID,
      code,
      redirect_uri: DASHBOARD_ORIGIN,
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) throw new Error(`dashboard token exchange failed (${tokenRes.status})`);
  const tok = await tokenRes.json();
  cachedToken = { token: tok.access_token, expiresAt: Date.now() + (tok.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

async function api(method, path, body) {
  const token = await dashboardToken();
  const res = await fetch(`${DASHBOARD_ORIGIN}/api/ws4d/warp/clients/${process.env.SPOTIFY_CLIENT_ID}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': 'application/json',
      referer: `${DASHBOARD_ORIGIN}/dashboard/${process.env.SPOTIFY_CLIENT_ID}/users`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) cachedToken = null;
  if (!res.ok) throw new Error(`dashboard API ${method} ${path} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export async function listUsers() {
  const data = await api('GET', '/users');
  return (data.users || []).map((u) => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt }));
}

export async function removeUser(id) {
  await api('DELETE', `/users/id/${id}`);
}

export async function addUser(name, email) {
  return api('POST', '/users', { name, email, clientId: process.env.SPOTIFY_CLIENT_ID });
}

export async function isListed(email) {
  const normalized = email.trim().toLowerCase();
  const users = await listUsers();
  return users.some((u) => (u.email || '').toLowerCase() === normalized);
}

// Spotify also caps additions at five per app per rolling 24 hours; the
// dashboard answers 429 with this message when that's hit.
export function isDailyCapError(err) {
  return /429|more than 5 users/i.test(err?.message || '');
}

async function ensureAccessNow(email, name) {
  const normalized = email.trim().toLowerCase();
  const users = await listUsers();
  if (users.some((u) => (u.email || '').toLowerCase() === normalized)) return { added: false, evicted: null };
  let evicted = null;
  if (users.length >= MAX_USERS) {
    const oldest = [...users].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
    await removeUser(oldest.id);
    evicted = oldest.email;
  }
  await addUser(name, normalized);
  return { added: true, evicted };
}

// Makes sure `email` can log in. If it's already listed, nothing changes. If
// the list is full, the entry added longest ago is removed first. Calls are
// serialized so two requests for the same email (a double-submitted form)
// can't both try to add it. Returns { added, evicted } for logging.
let queue = Promise.resolve();
export function ensureAccess(email, name = 'Concertify visitor') {
  const run = queue.then(() => ensureAccessNow(email, name));
  queue = run.catch(() => {});
  return run;
}
