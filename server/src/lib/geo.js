const EARTH_RADIUS_MI = 3958.8;

/** Great-circle distance in miles between two {lat, lng} points. */
export function haversineMiles(a, b) {
  if (!a || !b) return null;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(s));
}

/** Parses "lat,lng" query params, returning null if either is missing or invalid. */
export function parseLatLng(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (lat === undefined || lng === undefined) return null;
  if (Number.isNaN(la) || Number.isNaN(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { lat: la, lng: ln };
}

/**
 * Rounds a coordinate to ~0.01 degrees (about 0.7 miles) so nearby users
 * share cache entries instead of each generating a unique Ticketmaster query.
 */
export function cacheKeyForPoint({ lat, lng }) {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}
