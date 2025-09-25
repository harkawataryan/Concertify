Front-end in React (Vite) and back-end in Node/Express. Log in with Spotify, fetch your top 20 artists, show upcoming concerts (Ticketmaster), and recommend a few new artists based on your listening + who’s touring.

## Requirements
- Node 18+
- Spotify Developer app (Client ID/Secret)
- Ticketmaster API key

## Env
Create `.env` in `/server` from `.env.sample`:
```
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://localhost:5173/callback
SESSION_SECRET=super-secret-but-not-really
TICKETMASTER_API_KEY=
PORT=8088
FRONTEND_URL=http://localhost:5173
```

## Run (dev)
```bash
# in one shell
cd server
npm i
npm run dev

# in another shell
cd client
npm i
npm run dev
```

Open http://localhost:5173, click “Log in with Spotify”.

## Notes
- Uses Authorization Code flow with a tiny cookie session.
- Recommender is simple: grab related artists from Spotify, score by shared genre/popularity, then keep ones with upcoming Ticketmaster events.
- If Ticketmaster rate-limits, you’ll see fewer concerts/recs (sorry).
