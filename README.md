# Concertify

Concert discovery ranked by what you actually listen to. Log in with Spotify, pick a location, and Concertify scores every upcoming show nearby against your listening history, explains why each one was picked, and learns from thumbs up/down.

React (Vite) front end, Node/Express back end, Spotify Web API + Ticketmaster Discovery API.

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

Explicit feedback adjusts the profile (a thumbs-down removes an artist and suppresses its genres; a thumbs-up boosts it). Multiple dates of the same artist collapse into one card. Finally a maximal-marginal-relevance pass trades a little affinity for genre diversity so the top of the list isn't ten near-identical shows. Every result carries its component scores and plain-English reasons.

## Infrastructure

- **Caching** ([`lib/cache.js`](server/src/lib/cache.js)): read-through cache with single-flight coalescing so concurrent misses share one upstream call. In-memory LRU by default; Redis when `REDIS_URL` is set so instances share a cache.
- **Rate limiting** ([`lib/limiter.js`](server/src/lib/limiter.js)): token bucket plus a concurrency gate keep Ticketmaster traffic under its 5 req/s quota; `express-rate-limit` protects the API per user.
- **Resilience** ([`lib/http.js`](server/src/lib/http.js)): retries with exponential backoff and full jitter, honoring `Retry-After` on 429s.
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
| `GET /api/me` | current user |
| `GET /api/me/top-artists?time_range=short_term\|medium_term\|long_term` | top artists for a window |
| `GET /api/concerts?lat&lng` | upcoming shows anywhere for your top artists, nearest first |
| `GET /api/recommendations?lat&lng&radius&limit` | ranked local shows, "new to you" artists, and scoring breakdowns |
| `GET /api/feedback`, `POST /api/feedback {type, id, signal}` | thumbs up/down on an artist or genre |

## Tests

```bash
cd server && npm test
```
