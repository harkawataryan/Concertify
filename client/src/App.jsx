import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { useLocation } from './hooks/useLocation.js';
import { LocationPicker } from './components/LocationPicker.jsx';
import { ArtistCard } from './components/ArtistCard.jsx';
import { ShowCard } from './components/ShowCard.jsx';
import { RecommendationCard } from './components/RecommendationCard.jsx';

const TABS = [
  { id: 'foryou', label: 'For you' },
  { id: 'touring', label: 'Your artists on tour' },
  { id: 'artists', label: 'Top artists' }
];

const RANGES = [
  { id: 'short_term', label: 'Last month' },
  { id: 'medium_term', label: 'Last 6 months' },
  { id: 'long_term', label: 'All time' }
];

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = logged out
  const [tab, setTab] = useState('foryou');
  const loc = useLocation();
  const [radius, setRadius] = useState(50);

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null));
  }, []);

  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  if (user === undefined) return <div className="wrap"><p className="hint">Loading…</p></div>;

  return (
    <div className="wrap">
      <header>
        <div>
          <h1>Concertify</h1>
          <p className="tagline">Shows near you, ranked by what you actually listen to.</p>
        </div>
        {user && (
          <div className="user">
            <span>{user.displayName || user.id}</span>
            <button type="button" className="ghost" onClick={logout}>Log out</button>
          </div>
        )}
      </header>

      {!user ? (
        <div className="login">
          <a className="button primary" href={api.loginUrl}>Log in with Spotify</a>
          <p className="hint">Concertify reads your top artists to rank upcoming shows. Nothing is written to your account.</p>
        </div>
      ) : (
        <>
          <LocationPicker {...loc} radius={radius} setRadius={setRadius} />
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t.id} type="button" className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          {tab === 'foryou' && <ForYou location={loc.location} radius={radius} onAuthError={() => setUser(null)} />}
          {tab === 'touring' && <Touring location={loc.location} onAuthError={() => setUser(null)} />}
          {tab === 'artists' && <TopArtists onAuthError={() => setUser(null)} />}
        </>
      )}
    </div>
  );
}

/** Shared fetch state: loading / error / data, re-run when deps change. */
function useFetch(fn, deps, { onAuthError, enabled = true }) {
  const [state, setState] = useState({ loading: enabled, error: null, data: null });
  const reload = useCallback(() => {
    if (!enabled) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => setState({ loading: false, error: null, data }))
      .catch((err) => {
        if (err.status === 401) onAuthError();
        setState({ loading: false, error: err.message, data: null });
      });
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

function Status({ loading, error, reload, empty, children }) {
  if (loading) return <p className="hint">Loading…</p>;
  if (error) return <p className="error">{error} <button type="button" className="ghost" onClick={reload}>Retry</button></p>;
  if (empty) return <p className="hint">{empty}</p>;
  return children;
}

function ForYou({ location, radius, onAuthError }) {
  const enabled = Boolean(location);
  const { loading, error, data, reload } = useFetch(
    () => api.recommendations({ lat: location.lat, lng: location.lng }, radius),
    [location?.lat, location?.lng, radius],
    { onAuthError, enabled }
  );
  const [feedback, setFeedback] = useState({ artists: {}, genres: {} });
  useEffect(() => { api.feedback().then(setFeedback).catch(() => {}); }, []);

  const onFeedback = async (type, id, signal) => {
    setFeedback(await api.sendFeedback(type, id, signal));
    reload();
  };

  if (!enabled) return <p className="hint">Choose a location to get recommendations.</p>;

  return (
    <Status loading={loading} error={error} reload={reload} empty={data && !data.recommendations.length && 'No matching shows found in this area. Try a bigger radius.'}>
      {data && (
        <>
          <p className="hint">
            Scanned {data.meta.scanned} shows within {data.radiusMiles} mi against {data.profile.artistCount} artists you listen to.
            {data.profile.topGenres.length > 0 && <> Your top genres: {data.profile.topGenres.slice(0, 5).join(', ')}.</>}
          </p>
          <section>
            <h2>Recommended shows</h2>
            <div className="grid">
              {data.recommendations.map((rec) => (
                <RecommendationCard key={rec.event.id} rec={rec} feedback={feedback} onFeedback={onFeedback} />
              ))}
            </div>
          </section>
          {data.discover.length > 0 && (
            <section>
              <h2>New to you, playing nearby</h2>
              <div className="grid">
                {data.discover.map((d) => (
                  <ArtistCard key={d.artist.id} artist={d.artist}>
                    <div className="sub">{d.reasons.find((r) => r.startsWith('Matches')) || d.reasons[0]}</div>
                    <a className="sub link" href={d.event.url} target="_blank" rel="noreferrer">{d.event.venue.name} · {d.event.date}</a>
                  </ArtistCard>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </Status>
  );
}

function Touring({ location, onAuthError }) {
  const { loading, error, data, reload } = useFetch(
    () => api.concerts(location ? { lat: location.lat, lng: location.lng } : null),
    [location?.lat, location?.lng],
    { onAuthError }
  );
  return (
    <Status loading={loading} error={error} reload={reload} empty={data && !data.events.length && 'None of your top artists have upcoming shows listed.'}>
      {data && (
        <section>
          <h2>Upcoming shows for your top artists{location ? ', nearest first' : ''}</h2>
          <div className="grid">
            {data.events.map((e) => <ShowCard key={e.id} event={e} artist={e.artist} distanceMi={e.distanceMi} />)}
          </div>
        </section>
      )}
    </Status>
  );
}

function TopArtists({ onAuthError }) {
  const [range, setRange] = useState('medium_term');
  const { loading, error, data, reload } = useFetch(() => api.topArtists(range), [range], { onAuthError });
  return (
    <section>
      <div className="section-head">
        <h2>Your top artists</h2>
        <select aria-label="Time range" value={range} onChange={(e) => setRange(e.target.value)}>
          {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </div>
      <Status loading={loading} error={error} reload={reload} empty={data && !data.length && 'Spotify has no listening history for this window yet.'}>
        <div className="grid">
          {(data || []).map((a, i) => <ArtistCard key={a.id} artist={a} rank={i + 1} />)}
        </div>
      </Status>
    </section>
  );
}
