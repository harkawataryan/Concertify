import React, { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../hooks/useApp.js';
import { useFetch } from '../hooks/useFetch.js';
import { Icon } from '../components/Icon.jsx';
import { Skeleton } from '../components/Skeleton.jsx';
import { EmptyState, ErrorState } from '../components/EmptyState.jsx';
import { formatDate, timeAgo, venueLine } from '../lib/format.js';

export function Watchlist() {
  const { toggleSave, setUnreadAlerts, onAuthError, toast, loc } = useApp();
  const guard = (p) => p.catch((e) => { if (e.status === 401) onAuthError(); throw e; });
  const alerts = useFetch(() => guard(api.alerts()), []);
  const list = useFetch(() => guard(api.watchlist()), []);
  const [checking, setChecking] = useState(false);

  const applyAlerts = (res) => { alerts.setData(res); setUnreadAlerts(res.unread); };

  const markAllRead = async () => {
    try { applyAlerts(await api.markAlertsRead({ all: true })); } catch (err) { toast({ message: err.message, error: true }); }
  };
  const checkNow = async () => {
    setChecking(true);
    try {
      const res = await api.refreshAlerts();
      applyAlerts(res);
      toast({ message: res.created ? `${res.created} new ${res.created === 1 ? 'show' : 'shows'} found` : 'Nothing new since last check', ttl: 3000 });
    } catch (err) {
      toast({ message: err.message, error: true });
    } finally {
      setChecking(false);
    }
  };
  const remove = async (artist) => {
    await toggleSave(artist, false);
    list.reload();
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Saved artists and alerts</span>
          <h1>Watchlist</h1>
          <p>{loc.location ? `Alerts check for new shows within ${loc.location.radius} mi of ${loc.location.name} every 6 hours.` : 'Set a location to receive alerts.'}</p>
        </div>
        <div className="row">
          {alerts.data?.unread > 0 && <button type="button" className="btn btn-ghost" onClick={markAllRead}>Mark all read</button>}
          <button type="button" className="btn" onClick={checkNow} disabled={checking || !loc.location}><Icon name="refresh" size={14} /> {checking ? 'Checking…' : 'Check now'}</button>
        </div>
      </div>

      <section>
        <div className="section-head"><h2>Alerts</h2>{alerts.data && <span className="muted small">{alerts.data.unread} unread</span>}</div>
        {alerts.error ? <ErrorState error={alerts.error} onRetry={alerts.reload} />
          : alerts.loading ? <div className="stack"><Skeleton height={64} /><Skeleton height={64} /></div>
            : alerts.data.alerts.length === 0 ? <EmptyState title="No alerts yet" body="When an artist on your watchlist announces a show in your area, it shows up here." />
              : (
                <div className="stack">
                  {alerts.data.alerts.map((a) => (
                    <div key={a.id} className="card artist-card" style={{ borderColor: a.read ? undefined : 'var(--accent)' }}>
                      {a.event.image || a.artist.image ? <img src={a.event.image || a.artist.image} alt="" loading="lazy" /> : <div className="artist-fallback">{a.artist.name[0]}</div>}
                      <div className="artist-info">
                        <b>{a.artist.name} · {formatDate(a.event.date)}</b>
                        <div className="muted small">{venueLine(a.event.venue)}{a.distanceMi != null && ` · ${a.distanceMi} mi`}</div>
                        <div className="faint small">{timeAgo(a.createdAt)}{!a.read && ' · new'}</div>
                      </div>
                      <a className="btn" href={a.event.url} target="_blank" rel="noreferrer">Tickets <Icon name="external" size={14} /></a>
                    </div>
                  ))}
                </div>
              )}
      </section>

      <section className="section">
        <div className="section-head"><h2>Saved artists</h2>{list.data && <span className="muted small">{list.data.artists.length}</span>}</div>
        {list.error ? <ErrorState error={list.error} onRetry={list.reload} />
          : list.loading ? <div className="grid-sm"><Skeleton height={80} /><Skeleton height={80} /><Skeleton height={80} /></div>
            : list.data.artists.length === 0 ? <EmptyState title="Nothing saved" body="Save an artist from any show card and you'll be alerted when they play nearby." />
              : (
                <div className="grid-sm">
                  {list.data.artists.map((a) => (
                    <div key={a.id} className="card artist-card">
                      {a.image || a.nextShow?.image ? <img src={a.image || a.nextShow.image} alt="" loading="lazy" /> : <div className="artist-fallback">{a.name[0]}</div>}
                      <div className="artist-info">
                        <b>{a.name}</b>
                        <div className="muted small">{(a.genres || []).slice(0, 2).join(', ') || 'no genre data'}</div>
                        {a.nextShow
                          ? <a className="small" href={a.nextShow.url} target="_blank" rel="noreferrer">Next: {formatDate(a.nextShow.date)} · {a.nextShow.venue.city}</a>
                          : <div className="faint small">No upcoming shows listed</div>}
                      </div>
                      <button type="button" className="btn btn-ghost btn-icon is-active" onClick={() => remove(a)} aria-label={`Remove ${a.name}`} title="Remove"><Icon name="bookmarkFilled" /></button>
                    </div>
                  ))}
                </div>
              )}
      </section>
    </main>
  );
}
