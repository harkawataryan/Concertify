import client from 'prom-client';

/**
 * Prometheus metrics. Three things matter operationally for this service:
 * how slow requests are, how often the cache saves an upstream call, and
 * how the upstreams are behaving (status mix, 429s).
 */
export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Request latency by route and status',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry]
});

export const cacheRequests = new client.Counter({
  name: 'cache_requests_total',
  help: 'Read-through cache outcomes',
  labelNames: ['result'], // hit | miss | coalesced
  registers: [registry]
});

export const upstreamRequests = new client.Counter({
  name: 'upstream_requests_total',
  help: 'Calls to third-party APIs by final status',
  labelNames: ['upstream', 'status'],
  registers: [registry]
});

export const alertsCreated = new client.Counter({
  name: 'alerts_created_total',
  help: 'Watchlist alerts generated',
  registers: [registry]
});

export function metricsMiddleware() {
  return (req, res, next) => {
    const end = httpDuration.startTimer();
    res.on('finish', () => {
      // Express only knows the matched route after routing, hence on finish.
      const route = req.route ? `${req.baseUrl}${req.route.path}` : req.path;
      end({ method: req.method, route, status: res.statusCode });
    });
    next();
  };
}

export async function metricsHandler(_req, res) {
  res.set('Content-Type', registry.contentType);
  res.send(await registry.metrics());
}
