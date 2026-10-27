import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../hooks/useApp.js';
import { useFetch } from '../hooks/useFetch.js';
import { Skeleton } from '../components/Skeleton.jsx';
import { EmptyState, ErrorState } from '../components/EmptyState.jsx';
import { Icon } from '../components/Icon.jsx';
import { pct } from '../lib/format.js';

const WINDOWS = [
  { id: 'short_term', label: 'Last month' },
  { id: 'medium_term', label: 'Six months' },
  { id: 'long_term', label: 'All time' }
];

export function Taste() {
  const { onAuthError, savedIds, toggleSave } = useApp();
  const [win, setWin] = useState('short_term');
  const taste = useFetch(() => api.taste().catch((e) => { if (e.status === 401) onAuthError(); throw e; }), []);

  // Genre lookups may still be running right after login; refetch while the server says so.
  const retries = useRef(0);
  useEffect(() => {
    if (!taste.data?.pending || retries.current >= 2) return undefined;
    retries.current += 1;
    const t = setTimeout(taste.reload, 3000);
    return () => clearTimeout(t);
  }, [taste.data, taste.reload]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Your taste</h1>
          <p>What the ranker thinks you like. Recent listening counts more than old favorites.</p>
        </div>
      </div>

      {taste.error ? <ErrorState error={taste.error} onRetry={taste.reload} />
        : taste.loading ? <div className="stack"><Skeleton height={20} /><Skeleton height={20} width="80%" /><Skeleton height={20} width="60%" /></div>
          : (
            <>
              <section>
                <div className="section-head"><h2>Genres</h2><span className="muted small">from {taste.data.artistCount} artists</span></div>
                {taste.data.topGenres.length === 0 ? <EmptyState title={taste.data.pending ? 'Working out your genres' : 'No genre data yet'} body={taste.data.pending ? 'Looking up your artists; this fills in within a few seconds.' : 'Listen a bit more and check back.'} /> : (
                  <div className="stack" style={{ gap: 10 }}>
                    {taste.data.topGenres.map((g) => (
                      <div key={g.genre} className="bar-row">
                        <span className="bar-name" style={{ textTransform: 'capitalize' }}>{g.genre}</span>
                        <div className="bar"><div style={{ width: pct(g.weight) }} /></div>
                        <span className="bar-value">{pct(g.weight)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="section">
                <div className="section-head">
                  <h2>Top artists</h2>
                  <div className="segmented">
                    {WINDOWS.map((w) => <button key={w.id} type="button" className={win === w.id ? 'is-active' : ''} onClick={() => setWin(w.id)}>{w.label}</button>)}
                  </div>
                </div>
                {taste.data.windows[win]?.length === 0 ? <EmptyState title="Nothing in this window" body="Spotify has no listening history for this period yet." /> : (
                  <div className="grid-sm">
                    {(taste.data.windows[win] || []).map((a, i) => (
                      <div key={a.id} className="card artist-card">
                        <span className="rank">{i + 1}</span>
                        {a.image ? <img src={a.image} alt="" loading="lazy" /> : <div className="artist-fallback">{a.name[0]}</div>}
                        <div className="artist-info">
                          <b>{a.name}</b>
                          <div className="muted small">{(a.genres || []).slice(0, 2).join(', ') || 'no genre data'}</div>
                        </div>
                        <button type="button" className={`btn btn-ghost btn-icon${savedIds.has(a.id) ? ' is-active' : ''}`} onClick={() => toggleSave(a, !savedIds.has(a.id))} aria-label="Save to watchlist">
                          <Icon name={savedIds.has(a.id) ? 'bookmarkFilled' : 'bookmark'} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
    </main>
  );
}
