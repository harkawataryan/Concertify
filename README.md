# Concertify

Finds concerts near you and ranks them by how much you actually listen to the artists. You log in with Spotify, pick a city, and it scores every upcoming show in the area against your listening history. Each result says why it was picked, and you can thumbs-up/down to change what it recommends.

Live at https://concertify-cm6k.onrender.com (free tier, so the first load after a while can take ~30s).

Stack: React + Vite on the front end, Node/Express API, a Go gRPC service for the ranking math, a small Python/PyTorch service that fits per-user ranking weights. Data comes from the Spotify Web API and the Ticketmaster Discovery API. Endpoint reference is in [docs/API.md](docs/API.md), the gRPC contract in [proto/concertify.proto](proto/concertify.proto).

## What it does

- Ranks shows within a radius of you, with filters for dates, weekends only, max ticket price and genre.
- Group plans: make a plan, send the link, whoever joins gets their taste merged into one ranking. Uses the average match with a penalty for shows someone in the group would hate.
- Watchlist and alerts: save artists, and a background job checks every few hours for new shows near you.
- Map view, a page showing your genre profile over different time windows, calendar export, and a Prometheus `/metrics` endpoint.

## How the ranking works

Two stages, both in `server/src/services/`.

**Building a taste profile.** Top artists are pulled for three Spotify windows (last 4 weeks, 6 months, all time). Each artist gets a weight that drops with rank and favors recent windows. Those roll up into a genre vector. Spotify stopped returning genres on artist objects in 2025, so missing genres are filled in from Ticketmaster's own classification of the artist (`genres.js`), which also happens to be the vocabulary events are tagged with.

**Stage 1, retrieval.** All music events in the radius (up to 800) get a cheap score from Ticketmaster's genre tags plus a fuzzy name match against your top artists. The top 60, plus anything that matched an artist directly, move on.

**Stage 2, ranking.** Each candidate is scored on four things:

| signal | weight | what it is |
|---|---|---|
| direct | 0.55 | your listening weight for this exact artist |
| genre | 0.30 | cosine similarity between the show's genres and your profile |
| proximity | 0.08 | `exp(-miles / 40)` |
| soon | 0.07 | `exp(-days / 120)` |

Those weights are the defaults. Once you've rated five or more shows, a logistic regression over the four signals (`learning.js`, regularized toward the defaults) replaces them with your own. Multiple dates for the same artist collapse into one card, and an MMR pass at the end adds some genre variety so the top of the list isn't all the same thing.

The ranking math runs in the Go service (`ranker/`); the Node code has the same logic in-process as a fallback and that's what the unit tests exercise. The Python service (`trainer/`) does the weight fitting.

## Backend notes

- Ticketmaster allows 5 requests/second. Everything going to it passes through a token bucket with a concurrency gate, and a read-through cache that coalesces identical in-flight requests. The cache is in-memory by default, Redis if `REDIS_URL` is set.
- Retries use exponential backoff with jitter and respect `Retry-After`.
- Cold start was the slow part: the profile gets warmed in the background as soon as you log in, genre lookups are capped at 2.5s per request with the rest finishing afterwards, and event pages are fetched in parallel. Cold recommendations went from ~9s to ~2.5s.
- Spotify login uses the authorization code flow with refresh token rotation handled in middleware.
- Tests: `vitest` for the API (72), `go test` for the ranker, `pytest` for the trainer. CI runs all of them and builds the client.

## Running it

You need Node 20+, a [Spotify app](https://developer.spotify.com/dashboard) with `http://127.0.0.1:8088/auth/callback` as a redirect URI (Spotify won't accept `localhost`), and a [Ticketmaster API key](https://developer.ticketmaster.com).

```bash
cp server/.env.sample server/.env   # add your keys
cd server && npm install && npm run dev
# second terminal
cd client && npm install && npm run dev
```

Open http://127.0.0.1:5173. Use `127.0.0.1` rather than `localhost` or the session cookie won't match the Spotify callback host.

The Go and Python services are optional locally. To run them: `cd ranker && go run .` and `cd trainer && .venv/bin/python server.py`, then set `RANKER_ADDR=127.0.0.1:50051 TRAINER_ADDR=127.0.0.1:50052` for the API. Without them the Node process does everything itself.

## Deploying

The root `Dockerfile` builds the client, the Go binary and the Python env into one image that runs all three processes. `render.yaml` sets up a free Render web service plus Redis: create a Blueprint from the repo, fill in `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` and `TICKETMASTER_API_KEY`, and add `https://<service>.onrender.com/auth/callback` to the Spotify app. On other hosts set `PUBLIC_URL`.

## API

Everything under `/api` needs the session cookie from `/auth/login`.

| route | |
|---|---|
| `GET /api/me` | current user, saved location, unread alerts |
| `GET /api/me/top-artists?time_range=` | top artists for a window |
| `GET /api/me/taste` | genre profile and top artists per window |
| `GET /api/recommendations?lat&lng&radius&from&to&weekend&maxPrice&genres&exclude` | ranked shows, "new to you" artists, score breakdowns |
| `GET /api/concerts?lat&lng` | shows anywhere for your top artists |
| `GET/PUT/DELETE /api/watchlist[/:artistId]` | saved artists |
| `GET /api/alerts`, `POST /api/alerts/read`, `POST /api/alerts/refresh` | alerts inbox |
| `GET/POST /api/feedback` | thumbs up/down |
| `POST /api/plans`, `GET /api/plans/:code`, `GET /api/plans/:code/recommendations` | group plans |
| `GET /api/events/:id/calendar.ics` | calendar file for a show |
| `GET /metrics` | Prometheus |

## Tests

```bash
cd server && npm test
cd ranker && go test ./...
cd trainer && .venv/bin/pytest
```
