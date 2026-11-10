import cors from 'cors';

/**
 * The app-wide CORS rule, which allows only the Concertify frontend. Routes
 * that serve the portfolio site (the demo and the visit log) bring their own
 * CORS with a wider origin list, so the app-wide rule steps aside for them.
 * Otherwise it answers their preflights first, with the wrong origin, and the
 * browser blocks any request that carries an Authorization header.
 */
export function siteCors(frontendUrl, ownCors = ['/api/demo', '/api/visits']) {
  const appCors = cors({ origin: frontendUrl, credentials: true });
  return (req, res, next) => (ownCors.some((p) => req.path === p || req.path.startsWith(p + '/')) ? next() : appCors(req, res, next));
}
