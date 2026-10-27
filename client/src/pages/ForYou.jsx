import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../hooks/useApp.js';
import { useFetch } from '../hooks/useFetch.js';
import { Filters, EMPTY_FILTERS } from '../components/Filters.jsx';
import { ShowCard } from '../components/ShowCard.jsx';
import { DetailDrawer } from '../components/DetailDrawer.jsx';
import { MapView } from '../components/MapView.jsx';
import { SkeletonGrid } from '../components/Skeleton.jsx';
import { EmptyState, ErrorState } from '../components/EmptyState.jsx';
import { Icon } from '../components/Icon.jsx';
import { formatDate } from '../lib/format.js';

export function ForYou() {
  const { loc, feedback, sendFeedback, savedIds, toggleSave, onAuthError } = useApp();
  const { location, setRadius } = loc;
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [view, setView] = useState('list');
  const [open, setOpen] = useState(null);

  const key = [location?.lat, location?.lng, location?.radius, JSON.stringify(filters)];
  const { data, loading, error, reload } = useFetch(
    () => api.recommendations(location, location.radius, filters).catch((e) => { if (e.status === 401) onAuthError(); throw e; }),
    key,
    { enabled: Boolean(location) }
  );

  // Right after login the server may still be looking up genres; it says so
  // via profile.pending, and one or two refetches pick up the fuller ranking.
  const retries = useRef(0);
  useEffect(() => {
    if (!data?.profile?.pending || retries.current >= 2) return undefined;
    retries.current += 1;
    const t = setTimeout(reload, 3000);
    return () => clearTimeout(t);
  }, [data, reload]);

  // Watchlist membership is session state so cards stay in sync across pages.
  const recs = useMemo(() => (data?.recommendations || []).map((r) => ({ ...r, saved: r.artist ? savedIds.has(r.artist.id) : false })), [data, savedIds]);
  const openRec = open ? recs.find((r) => r.event.id === open) || open : null;

  const onFeedback = async (type, id, signal) => { await sendFeedback(type, id, signal); reload(); };

  if (!location) {
    return (
      <main className="page">
        <EmptyState title="Where are you?" body="Pick a city or use your location from the top bar to get ranked shows." />
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>For you</h1>
          <p>
            {data ? <>Scanned {data.meta.scanned} shows within {data.radiusMiles} mi against {data.profile.artistCount} artists you listen to.{data.profile.pending > 0 && ' Still learning your taste; this list will fill in.'}</> : <>Shows within {location.radius} mi of {location.name}.</>}
          </p>
        </div>
        <div className="segmented" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'is-active' : ''} onClick={() => setView('list')}><Icon name="list" size={14} /> List</button>
          <button type="button" role="tab" aria-selected={view === 'map'} className={view === 'map' ? 'is-active' : ''} onClick={() => setView('map')}><Icon name="map" size={14} /> Map</button>
        </div>
      </div>

      <Filters filters={filters} onChange={setFilters} radius={location.radius} onRadius={setRadius} available={data?.availableGenres || []} disabled={loading && !data} />

      {error ? <ErrorState error={error} onRetry={reload} />
        : loading && !data ? <SkeletonGrid />
          : recs.length === 0 ? (
            <EmptyState
              title="Nothing matched"
              body={data?.meta.filteredOut ? `${data.meta.filteredOut} shows were hidden by your filters.` : 'No shows in this area line up with your listening yet. Try a bigger radius.'}
              action={data?.meta.filteredOut ? <button type="button" className="btn" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button> : <button type="button" className="btn" onClick={() => setRadius(Math.min(150, location.radius * 2))}>Widen radius</button>}
            />
          ) : view === 'map' ? (
            <MapView items={recs} onOpen={(r) => setOpen(r.event.id)} />
          ) : (
            <div className="grid" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 120ms' }}>
              {recs.map((rec) => (
                <ShowCard key={rec.event.id} rec={rec} feedback={feedback} onFeedback={onFeedback} onToggleSave={toggleSave} onOpen={(r) => setOpen(r.event.id)} />
              ))}
            </div>
          )}

      {data?.discover?.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>New to you</h2>
            <span className="muted small">Artists you don't play yet, close to your taste, playing nearby</span>
          </div>
          <div className="grid-sm">
            {data.discover.map((d) => (
              <div key={d.artist.id} className="card artist-card">
                {d.artist.image || d.event.image ? <img src={d.artist.image || d.event.image} alt="" loading="lazy" /> : <div className="artist-fallback">{d.artist.name[0]}</div>}
                <div className="artist-info">
                  <b>{d.artist.name}</b>
                  <div className="muted small">{d.reasons.find((r) => r.startsWith('Matches')) || d.reasons[0]}</div>
                  <a className="small" href={d.event.url} target="_blank" rel="noreferrer">{formatDate(d.event.date)} · {d.event.venue.name}</a>
                </div>
                <button type="button" className={`btn btn-ghost btn-icon${savedIds.has(d.artist.id) ? ' is-active' : ''}`} onClick={() => toggleSave(d.artist, !savedIds.has(d.artist.id))} aria-label="Save to watchlist">
                  <Icon name={savedIds.has(d.artist.id) ? 'bookmarkFilled' : 'bookmark'} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {openRec && <DetailDrawer rec={openRec} onClose={() => setOpen(null)} onToggleSave={toggleSave} />}
    </main>
  );
}
