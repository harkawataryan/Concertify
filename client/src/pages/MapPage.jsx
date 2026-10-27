import React, { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../hooks/useApp.js';
import { useFetch } from '../hooks/useFetch.js';
import { MapView } from '../components/MapView.jsx';
import { DetailDrawer } from '../components/DetailDrawer.jsx';
import { Skeleton } from '../components/Skeleton.jsx';
import { EmptyState, ErrorState } from '../components/EmptyState.jsx';

export function MapPage() {
  const { loc, savedIds, toggleSave, onAuthError } = useApp();
  const { location } = loc;
  const [open, setOpen] = useState(null);

  const { data, loading, error, reload } = useFetch(
    () => api.recommendations(location, location.radius, { limit: 50 }).catch((e) => { if (e.status === 401) onAuthError(); throw e; }),
    [location?.lat, location?.lng, location?.radius],
    { enabled: Boolean(location) }
  );
  const recs = useMemo(() => (data?.recommendations || []).map((r) => ({ ...r, saved: r.artist ? savedIds.has(r.artist.id) : false })), [data, savedIds]);
  const openRec = open ? recs.find((r) => r.event.id === open) : null;

  if (!location) return <main className="page"><EmptyState title="Where are you?" body="Pick a city or use your location from the top bar." /></main>;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Map</h1>
          <p>{recs.length ? `${recs.length} recommended shows within ${data.radiusMiles} mi. Larger, brighter markers are better matches.` : `Within ${location.radius} mi of ${location.name}.`}</p>
        </div>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} />
        : loading && !data ? <Skeleton height="70vh" style={{ borderRadius: 12, minHeight: 420 }} />
          : recs.length === 0 ? <EmptyState title="Nothing to plot" body="No shows in this area line up with your listening yet." />
            : <MapView items={recs} center={[location.lat, location.lng]} onOpen={(r) => setOpen(r.event.id)} />}
      {openRec && <DetailDrawer rec={openRec} onClose={() => setOpen(null)} onToggleSave={toggleSave} />}
    </main>
  );
}
