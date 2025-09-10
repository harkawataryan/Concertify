import React, { useEffect, useState } from 'react';
import axios from 'axios';

const SERVER = import.meta.env.VITE_SERVER_URL || 'http://localhost:8088';

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [artists, setArtists] = useState([]);
  const [concerts, setConcerts] = useState([]);
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // scuffed: just call something and see if 401
    axios.get(SERVER + '/api/me/top-artists', { withCredentials: true })
      .then(r => { setAuthed(true); setArtists(r.data || []); })
      .catch(() => setAuthed(false));
  }, []);

  const login = () => {
    window.location.href = SERVER + '/auth/login';
  };

  const loadArtists = async () => {
    setLoading(true);
    try {
      const r = await axios.get(SERVER + '/api/me/top-artists', { withCredentials: true });
      setArtists(r.data);
    } finally { setLoading(false); }
  };

  const loadConcerts = async () => {
    setLoading(true);
    try {
      const r = await axios.get(SERVER + '/api/concerts', { withCredentials: true });
      setConcerts(r.data);
    } finally { setLoading(false); }
  };

  const loadRecs = async () => {
    setLoading(true);
    try {
      const r = await axios.get(SERVER + '/api/recommendations', { withCredentials: true });
      setRecs(r.data.recommendations || []);
      setConcerts(r.data.concerts || []);
    } finally { setLoading(false); }
  };

  return (
    <div className="wrap">
      <h1>Concert Finder (Spotify → Ticketmaster)</h1>
      {!authed ? (
        <button onClick={login}>Log in with Spotify</button>
      ) : (
        <div className="actions">
          <button onClick={loadArtists} disabled={loading}>Top 20 Artists</button>
          <button onClick={loadConcerts} disabled={loading}>Upcoming Concerts</button>
          <button onClick={loadRecs} disabled={loading}>Recommendations</button>
        </div>
      )}

      {artists?.length > 0 && (
        <section>
          <h2>Your Top Artists</h2>
          <div className="grid artists">
            {artists.map(a => (
              <div key={a.id} className="card">
                <img src={a.images?.[0]?.url} alt={a.name} />
                <div className="card-body">
                  <div className="title">{a.name}</div>
                  <div className="sub">{(a.genres || []).slice(0,3).join(', ')}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {recs?.length > 0 && (
        <section>
          <h2>Suggested Artists</h2>
          <div className="grid artists">
            {recs.map(a => (
              <div key={a.id} className="card">
                {a.image && <img src={a.image} alt={a.name} />}
                <div className="card-body">
                  <div className="title">{a.name}</div>
                  <div className="sub">{(a.genres || []).slice(0,3).join(', ')}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {concerts?.length > 0 && (
        <section>
          <h2>Upcoming Shows</h2>
          <div className="grid shows">
            {concerts.map((c, i) => (
              <a key={c.eventId + i} className="card show" href={c.url} target="_blank" rel="noreferrer">
                <div className="card-body">
                  <div className="title">{c.name}</div>
                  <div className="sub">{c.artist || '—'} • {c.date || 'TBA'}</div>
                  <div className="sub">{[c.venue, c.city, c.country].filter(Boolean).join(' • ')}</div>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      <footer>
        <small>Heads up: APIs sometimes throttle. If it looks empty, try again.</small>
      </footer>
    </div>
  );
}
