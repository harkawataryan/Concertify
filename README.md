# Concertify

Concertify finds concerts near you and ranks them by how much you actually listen to the artists. You log in with Spotify, pick a city, and it scores every upcoming show in the area against your listening history. Each result says why it was picked, and a thumbs up or down changes what it recommends next.

It's live at https://concertify-cm6k.onrender.com. It runs on Render's free tier, so the first load after a quiet stretch can take about 30 seconds.

The front end is React and Vite, the API is Node and Express, the ranking math runs in a Go gRPC service, and a small Python and PyTorch service fits each user's ranking weights. Show data comes from the Spotify Web API and the Ticketmaster Discovery API. [docs/API.md](docs/API.md) documents the endpoints and [proto/concertify.proto](proto/concertify.proto) has the gRPC contract.

## What it does

The main page ranks shows within a radius of you, with filters for dates, weekends only, maximum ticket price and genre. You can also search anywhere, which looks up every upcoming show for your top 40 artists instead of searching an area, and distance stops counting toward the score.

Group plans let you make a plan, send the link, and merge everyone who joins into one ranking. It uses the group's average match with a penalty for shows that someone in the group would hate, so a show three people love and one would hate can lose to one everyone likes.

You can also save artists to a watchlist, and a background job checks every few hours for new shows near you. There's a map view, a page that shows how your genre profile has changed over different time windows, calendar export, and a Prometheus `/metrics` endpoint.

## How the ranking works

Everything starts from a taste profile. The server pulls your top artists for Spotify's three time windows (the last 4 weeks, 6 months and all time) and gives each artist a weight that drops with rank and favors the recent windows. Those weights roll up into a genre vector. Spotify stopped returning genres on artist objects in 2025, so missing genres are filled in from Ticketmaster's own classification of the artist (`genres.js`). That turned out to be a good fit, since it's the same vocabulary Ticketmaster tags events with.

Ranking then happens in two stages, both in `server/src/services/`. First, every music event in the radius (up to 800) gets a cheap score from Ticketmaster's genre tags plus a fuzzy name match against your top artists. The top 60, plus anything that matched one of your artists directly, move on to the second stage, where each one is scored on four signals.

| signal | weight | what it measures |
|---|---|---|
| direct | 0.55 | your listening weight for this exact artist |
| genre | 0.30 | cosine similarity between the show's genres and your profile |
| proximity | 0.08 | `exp(-miles / 40)` |
| soon | 0.07 | `exp(-days / 120)` |

Those are the default weights. Once you've rated five or more shows, a logistic regression over the four signals (`learning.js`), regularized toward the defaults, replaces them with weights fitted to you. Multiple dates for the same artist collapse into one card, and a final MMR pass mixes in some genre variety so the top of the list isn't all the same kind of show.

The ranking math runs in the Go service in `ranker/`. The Node server has the same logic in-process as a fallback, and that's what the unit tests exercise. The Python service in `trainer/` does the weight fitting.

## Making it fast

Ticketmaster allows 5 requests a second, so every call to it goes through a token bucket with a concurrency gate and a read-through cache that merges identical requests already in flight. The cache lives in memory by default, or in Redis if `REDIS_URL` is set. Retries back off exponentially with jitter and respect `Retry-After`.

The first recommendation after logging in used to take about 9 seconds. Now the taste profile starts building in the background as soon as you log in, genre lookups get 2.5 seconds per request and finish the rest afterward, and event pages are fetched in parallel. That brought it down to about 2.5 seconds.

Spotify login uses the authorization code flow, with refresh tokens rotated in middleware.

## Getting around Spotify's five-user limit

Since February 2026, a Spotify app in Development Mode can only have five listed users, so a stranger can't log in until the owner adds their email on the developer dashboard. That dashboard has no public API, but its own front end logs in with the owner's session cookie and calls an internal JSON API, so `server/src/lib/spotifyAllowlist.js` does the same thing.

Set `SPOTIFY_DASHBOARD_SP_DC` to the owner's `sp_dc` cookie (from DevTools, under Application and then Cookies on developer.spotify.com). The landing page will then ask visitors for the email on their Spotify account, add it before sending them to log in, and remove whoever has been listed longest when all five slots are taken. Without the variable, the landing page just shows the plain login button. The cookie lasts about a year, and once it expires the form falls back to asking people to email the owner.

## Running it

You need Node 20 or newer, a [Spotify app](https://developer.spotify.com/dashboard) with `http://127.0.0.1:8088/auth/callback` as a redirect URI (Spotify won't accept `localhost`), and a [Ticketmaster API key](https://developer.ticketmaster.com).

```bash
cp server/.env.sample server/.env   # add your keys
cd server && npm install && npm run dev
# second terminal
cd client && npm install && npm run dev
```

Then open http://127.0.0.1:5173. Use `127.0.0.1` and not `localhost`, or the session cookie won't match the Spotify callback host.

You don't need the Go and Python services locally, since the Node process does everything itself without them. To run them anyway, start `cd ranker && go run .` and `cd trainer && .venv/bin/python server.py`, then set `RANKER_ADDR=127.0.0.1:50051 TRAINER_ADDR=127.0.0.1:50052` for the API.

## Deploying

The root `Dockerfile` builds the client, the Go binary and the Python environment into one image that runs all three processes. `render.yaml` sets up a free Render web service with Redis. Create a Blueprint from the repo, fill in `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` and `TICKETMASTER_API_KEY`, and add `https://<service>.onrender.com/auth/callback` to the Spotify app. On any other host, set `PUBLIC_URL`.

## API

Everything under `/api` needs the session cookie from `/auth/login`, except the demo and visit routes.

| route | |
|---|---|
| `GET /api/me` | current user, saved location, unread alerts |
| `GET /api/me/top-artists?time_range=` | top artists for a window |
| `GET /api/me/taste` | genre profile and top artists per window |
| `GET /api/recommendations?lat&lng&radius&from&to&weekend&maxPrice&genres&exclude` | ranked shows, "new to you" artists and score breakdowns. `radius=any` ignores location |
| `GET /api/concerts?lat&lng` | shows anywhere for your top artists |
| `GET /api/demo/artists?q`, `GET /api/demo/recommendations?artists&lat&lng&radius` | the login-free demo on aryanh.dev. Uses the app's own Spotify token, is rate limited, and only accepts requests from `DEMO_ORIGINS` |
| `POST /api/visits/hit`, `GET /api/visits` | the live visit log behind aryanh.dev's private dashboard. Takes page beacons from `DEMO_ORIGINS` and is read with `Authorization: Bearer $VISITS_TOKEN`. Off unless `VISITS_TOKEN` is set. With `RESEND_API_KEY` and `NOTIFY_TO` it also emails a summary of each visit about 90 seconds after it ends |
| `GET/PUT/DELETE /api/watchlist[/:artistId]` | saved artists |
| `GET /api/alerts`, `POST /api/alerts/read`, `POST /api/alerts/refresh` | alerts inbox |
| `GET/POST /api/feedback` | thumbs up and down |
| `POST /api/plans`, `GET /api/plans/:code`, `GET /api/plans/:code/recommendations` | group plans |
| `GET /api/events/:id/calendar.ics` | calendar file for a show |
| `GET /metrics` | Prometheus |

## Tests

```bash
cd server && npm test
cd ranker && go test ./...
cd trainer && .venv/bin/pytest
```

The API has its tests in `vitest`, the ranker in `go test` and the trainer in `pytest`. CI runs all three and builds the client.
