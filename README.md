# Concertify

Concert discovery ranked by what you actually listen to. Log in with Spotify, pick a location, and Concertify scores every upcoming show nearby against your listening history, explains why each one was picked, and learns from your feedback.

React (Vite) front end, Node/Express back end, Spotify Web API + Ticketmaster Discovery API. Full endpoint reference in [`docs/API.md`](docs/API.md).

## Features

- **Ranked local shows** with plain-English reasons and a per-result score breakdown, filterable by date range, weekends, max ticket price, radius and genre.
- **Group plans**: create a plan, share the link, and friends who join have their taste merged into one ranking (mean affinity with a least-misery floor), with per-person scores on every show.
- **Watchlist and alerts**: save artists; a background job checks for newly listed shows within your saved radius and surfaces them in an inbox.
- **Map view**, **taste insights** (your genre profile across listening windows), **calendar export** for any show, and thumbs up/down that reshape your profile.
- **Operational**: Prometheus `/metrics` (request latency, cache hit ratio, upstream status mix), structured logs, health check.

## How recommendations work

The recommender is a two-stage, content-based ranker in [`server/src/services/recommender.js`](server/src/services/recommender.js).

**Taste profile** ([`taste.js`](server/src/services/taste.js)). The user's top artists are pulled for three listening windows (last month, 6 months, all time). Each artist gets a weight that decays with rank and favors recent windows, so the band you've had on repeat this month outranks a favorite from 2019. Those weights roll up into a genre vector; both an exact-label vector ("indie rock") and a word-token vector ("indie", "rock") are kept so Spotify's micro-genres can be compared with Ticketmaster's coarser taxonomy. Spotify stopped returning `genres` on artist objects in 2025, so for artists that come back without any, genres are looked up from Ticketmaster's attractions taxonomy ([`genres.js`](server/src/services/genres.js)); that is the same vocabulary events are labeled with, so the comparison is exact.

**Stage 1, retrieval.** Every music event within the radius (up to 800, paged from Ticketmaster) is scored cheaply using only data already in hand: Ticketmaster's genre labels and a fuzzy match (Sørensen–Dice on bigrams, after name normalization) of the performer against the user's top artists. Anything with no signal is dropped; the best 60 plus every direct artist hit move on.

**Stage 2, ranking.** Each candidate's performer is resolved to a Spotify artist, via the Spotify link Ticketmaster sometimes provides or a cached name search, and scored:

| component | weight | signal |
|---|---|---|
| direct | 0.55 | user's listening weight for this exact artist |
| genre | 0.30 | cosine similarity between candidate and profile genre vectors |
| proximity | 0.08 | `exp(-miles / 40)` from the user's location |
| soon | 0.07 | `exp(-days / 120)` until the show |

Explicit feedback does two things: it adjusts the profile (a thumbs-down removes an artist and suppresses its genres; a thumbs-up boosts it), and it trains the weights themselves. Every rating on a scored show is a labeled example of the four component scores; once a user has five or more, a logistic regression ([`learning.js`](server/src/services/learning.js)), L2-regularized toward the defaults above, replaces the fixed weights with that user's own. Multiple dates of the same artist collapse into one card. Finally a maximal-marginal-relevance pass trades a little affinity for genre diversity so the top of the list isn't ten near-identical shows. Every result carries its component scores and plain-English reasons.

## Infrastructure

- **Caching** ([`lib/cache.js`](server/src/lib/cache.js)): read-through cache with single-flight coalescing so concurrent misses share one upstream call. In-memory LRU by default; Redis when `REDIS_URL` is set so instances share a cache.
- **Rate limiting** ([`lib/limiter.js`](server/src/lib/limiter.js)): token bucket plus a concurrency gate keep Ticketmaster traffic under its 5 req/s quota; `express-rate-limit` protects the API per user.
- **Resilience** ([`lib/http.js`](server/src/lib/http.js)): retries with exponential backoff and full jitter, honoring `Retry-After` on 429s.
- **Latency**: the listening profile is warmed in the background the moment a user logs in; a request waits at most 2.5s for cold genre lookups and ranks with what it has while the rest finish for next time; event pages fetch in parallel; the ranking path makes no Spotify calls at all.
- **Auth** ([`middleware/auth.js`](server/src/middleware/auth.js)): Spotify Authorization Code flow with CSRF state, and transparent refresh-token rotation before the access token expires.
- **Tests**: `vitest` unit tests for the ranker, taste profile, fuzzy matcher, cache, limiter and retry logic. CI runs them and builds the client on every push.

## Running locally

Requirements: Node 20+, a [Spotify app](https://developer.spotify.com/dashboard) (add `http://127.0.0.1:8088/auth/callback` as a redirect URI; Spotify rejects `localhost`), and a [Ticketmaster API key](https://developer.ticketmaster.com).

```bash
cp server/.env.sample server/.env   # fill in the keys
cd server && npm install && npm run dev
# in another shell
cd client && npm install && npm run dev
```

Open http://127.0.0.1:5173 (not `localhost`: Spotify only accepts the loopback IP as a redirect URI, and session cookies are scoped to the hostname).

With Docker, `docker compose up` starts the server with Redis-backed caching; run the client separately.

## Deploying

The root `Dockerfile` builds the client and runs the server, which serves the client from the same origin so the session cookie is first-party. `render.yaml` describes a single free Render web service: create a Blueprint from this repo, enter `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` and `TICKETMASTER_API_KEY` when prompted, and add `https://<your-service>.onrender.com/auth/callback` as a redirect URI on the Spotify app. The public URL is picked up from `RENDER_EXTERNAL_URL`; on other hosts set `PUBLIC_URL` instead. Set `REDIS_URL` to share the cache across instances.

## API

All `/api` routes require a session cookie from `/auth/login`.

| route | description |
|---|---|
| `GET /api/me` | current user, saved location, unread alert count |
| `GET /api/me/top-artists?time_range=short_term\|medium_term\|long_term` | top artists for a window |
| `GET /api/concerts?lat&lng` | upcoming shows anywhere for your top artists, nearest first |
| `GET /api/recommendations?lat&lng&radius&limit&from&to&weekend&maxPrice&genres&exclude` | ranked local shows, "new to you" artists, and scoring breakdowns |
| `GET /api/feedback`, `POST /api/feedback {type, id, signal}` | thumbs up/down on an artist or genre |
| `GET/PUT/DELETE /api/watchlist[/:artistId]` | saved artists with their next show |
| `GET /api/alerts`, `POST /api/alerts/read`, `POST /api/alerts/refresh` | watchlist alerts inbox |
| `POST /api/plans`, `GET /api/plans/:code`, `GET /api/plans/:code/recommendations` | group plans and group ranking |
| `GET /api/events/:id/calendar.ics` | iCalendar file for a show |
| `GET /metrics` | Prometheus metrics |

## Tests

```bash
cd server && npm test
```
