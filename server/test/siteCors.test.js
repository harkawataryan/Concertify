import { describe, it, expect } from 'vitest';
import express from 'express';
import http from 'node:http';
import { siteCors } from '../src/lib/siteCors.js';
import { visitsRouter } from '../src/routes/visits.js';
import { MemoryVisitStore } from '../src/lib/visits.js';

// The real app order: app-wide CORS first, then the portfolio routes.
function app() {
  const a = express();
  a.use(siteCors('https://concertify.example'));
  a.use('/api/visits', visitsRouter({ store: new MemoryVisitStore(), token: 't', origins: ['https://concertify.example', 'https://aryanh.dev'] }));
  a.get('/api/me', (_q, r) => r.json({}));
  return a;
}
async function preflight(path, origin) {
  const server = http.createServer(app());
  await new Promise((r) => server.listen(0, r));
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
  server.close();
  return res.headers;
}

describe('site CORS', () => {
  it('lets the visit log answer its own preflight for the portfolio origin', async () => {
    const h = await preflight('/api/visits/', 'https://aryanh.dev');
    expect(h.get('access-control-allow-origin')).toBe('https://aryanh.dev');
    expect(h.get('access-control-allow-headers')).toMatch(/authorization/i);
  });
  it('keeps the app-wide rule everywhere else', async () => {
    const h = await preflight('/api/me', 'https://aryanh.dev');
    expect(h.get('access-control-allow-origin')).toBe('https://concertify.example');
  });
});
