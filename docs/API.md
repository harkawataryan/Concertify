# Concertify API

All `/api` routes require the session cookie set by `/auth/login`. Errors are JSON: `{ error: string }` with 400/401/404/429/502/500. Every `event` object has the shape:

```ts
type Event = {
  id: string; name: string; url: string;
  date: string | null;        // "2026-11-14" (venue-local)
  time: string | null;        // "20:00:00" venue-local wall clock; display this, not dateTime
  dateTime: string | null;    // ISO, UTC (same instant; for calendars/sorting)
  image: string | null;
  priceRange: { min: number; max: number; currency: string } | null;
  venue: { name; city; state; country; lat: number | null; lng: number | null };
  genres: string[];           // Ticketmaster labels, lowercase
  attractions: { id; name; genres: string[]; spotifyId: string | null }[];
};

type Artist = { id: string; name: string; genres: string[]; popularity?: number; image: string | null; url: string | null };

type Recommendation = {
  event: Event;
  artist: Artist | null;             // headline performer
  affinity: number;                  // 0..1
  components: { direct: number; genre: number; proximity: number; soon: number };
  reasons: string[];                 // "Wednesday is one of your most-played artists", "6 mi away", ...
  moreDates: { id; date; venue; url }[];
  distanceMi: number | null;
  daysOut: number | null;
  saved: boolean;                    // artist is on the watchlist
};
```

## Auth
| route | |
|---|---|
| `GET /auth/login` | redirects to Spotify |
| `GET /auth/callback` | Spotify redirects here; sets cookie; redirects to `/` (or `/plan/:code` if `?return=` was set at login via `/auth/login?return=/plan/CODE`) |
| `POST /auth/logout` | `{ ok: true }` |

## Me
| route | response |
|---|---|
| `GET /api/me` | `{ id, displayName, location: {name,lat,lng,radius} \| null, watchlistCount, unreadAlerts }` |
| `PUT /api/me/location` body `{ name, lat, lng, radius }` | `{ location }` (saved; used by alerts) |
| `GET /api/me/top-artists?time_range=short_term\|medium_term\|long_term` | `Artist[]` |
| `GET /api/me/taste` | `{ topGenres: {genre, weight}[] (weight 0..1, max 12), artistCount, windows: { short_term: Artist[10], medium_term: Artist[10], long_term: Artist[10] }, pending: number }` (`pending` as above) |

## Recommendations
`GET /api/recommendations?lat&lng&radius=50&limit=20&from=YYYY-MM-DD&to=YYYY-MM-DD&weekend=1&maxPrice=80&genres=rock,pop&exclude=country`

Response:
```ts
{
  recommendations: Recommendation[];
  discover: { artist: Artist; affinity; reasons; event: Event }[];   // "new to you"
  profile: { topGenres: string[]; artistCount: number; pending: number };   // pending > 0: genre lookups still running; refetch once in a few seconds for a fuller ranking
  radiusMiles: number;
  filters: { from, to, weekend, maxPrice, genres: string[], exclude: string[] };   // as applied
  meta: { scanned, candidates, scored, filteredOut };
  availableGenres: { genre: string; count: number }[];   // labels present in the scanned events, for filter chips
}
```

`GET /api/concerts?lat&lng` → `{ events: (Event & { artist: Artist; distanceMi })[] }` upcoming shows anywhere for the user's top artists, nearest first.

## Watchlist
| route | response |
|---|---|
| `GET /api/watchlist` | `{ artists: (Artist & { addedAt: string; nextShow: Event \| null })[] }` |
| `PUT /api/watchlist/:artistId` body `Artist` | same as GET |
| `DELETE /api/watchlist/:artistId` | same as GET |

Watchlisted artists get a ranking boost.

## Alerts
| route | response |
|---|---|
| `GET /api/alerts` | `{ alerts: { id; artist: Artist; event: Event; distanceMi; createdAt; read: boolean }[]; unread: number }` |
| `POST /api/alerts/read` body `{ ids: string[] } \| { all: true }` | same as GET |
| `POST /api/alerts/refresh` | runs the watchlist check now → `{ created: number, ...GET }` |

A background job runs the same check every 6 hours for every user with a saved location.

## Feedback
`GET /api/feedback` → `{ artists: {[id]: 1|-1}, genres: {[genre]: 1|-1} }`
`POST /api/feedback` body `{ type: 'artist'|'genre', id, signal: 1|-1|0 }` → same

## Group plans
| route | response |
|---|---|
| `POST /api/plans` body `{ name }` | `Plan` |
| `GET /api/plans` | `{ plans: Plan[] }` (ones I'm a member of) |
| `GET /api/plans/:code` | `Plan`; joins the caller as a member (snapshotting their taste) if not already |
| `DELETE /api/plans/:code/members/me` | `{ ok }` |
| `GET /api/plans/:code/recommendations?lat&lng&radius&limit` | `{ plan: Plan, recommendations: GroupRecommendation[] }` |

```ts
type Plan = { code: string; name: string; ownerId: string; createdAt: string;
              members: { id: string; displayName: string; joinedAt: string; topGenres: string[] }[] };
type GroupRecommendation = Recommendation & {
  groupScore: number;                                     // 0.7 * mean + 0.3 * min of member affinities
  perMember: { id; displayName; affinity: number }[];     // sorted desc
  consensus: 'everyone' | 'most' | 'some';                // members with affinity >= 0.3
};
```
Share URL for a plan is `/plan/:code` on the frontend; unauthenticated visitors there should be sent to `/auth/login?return=/plan/:code`.

## Calendar
`GET /api/events/:id/calendar.ics` → `text/calendar` for one event (id from any Event previously returned; 404 if unknown to the cache).

## Ops
`GET /health` → `{ ok: true }`. `GET /metrics` → Prometheus text format (request latency histogram, cache hit/miss, upstream calls by service and status).
