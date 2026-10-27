import React, { useEffect } from 'react';
import { Icon } from './Icon.jsx';
import { AffinityRing } from './AffinityRing.jsx';
import { MapView } from './MapView.jsx';
import { api } from '../api.js';
import { formatDate, formatDateLong, formatPrice, formatTime, pct, venueLine } from '../lib/format.js';

const COMPONENTS = [
  ['direct', 'You listen to them', 0.55],
  ['genre', 'Genre match', 0.30],
  ['proximity', 'Distance', 0.08],
  ['soon', 'Timing', 0.07]
];

export function DetailDrawer({ rec, onClose, onToggleSave, group = false }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  if (!rec) return null;
  const { event, artist, affinity, components, reasons, moreDates = [], distanceMi, saved } = rec;
  const title = artist?.name || event.name;
  const price = formatPrice(event.priceRange);
  const hasCoords = event.venue.lat != null && event.venue.lng != null;

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-media">
          {(event.image || artist?.image) && <img src={event.image || artist.image} alt="" />}
          <button type="button" className="btn btn-icon drawer-close" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="drawer-body">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div className="stack" style={{ gap: 4 }}>
              <h2>{title}</h2>
              {artist && artist.name !== event.name && <div className="muted">{event.name}</div>}
              <div className="muted">{formatDateLong(event.date)}{formatTime(event) && ` · ${formatTime(event)}`}</div>
              <div className="muted">{venueLine(event.venue)}{distanceMi != null && ` · ${distanceMi} mi away`}</div>
              {price && <div className="muted">Tickets from {price}</div>}
            </div>
            <AffinityRing value={group ? rec.groupScore : affinity} size={56} inline label={group ? 'Group score' : 'Affinity'} />
          </div>

          <div className="row">
            <a className="btn btn-primary" href={event.url} target="_blank" rel="noreferrer">Get tickets <Icon name="external" size={14} /></a>
            <a className="btn" href={api.calendarUrl(event.id)}><Icon name="calendar" size={16} /> Add to calendar</a>
            {onToggleSave && artist && (
              <button type="button" className={`btn${saved ? ' btn-icon is-active' : ''}`} onClick={() => onToggleSave(artist, !saved)}>
                <Icon name={saved ? 'bookmarkFilled' : 'bookmark'} size={16} /> {saved ? 'Saved' : 'Save artist'}
              </button>
            )}
          </div>

          {group && rec.perMember && (
            <section>
              <h4>Who'd go</h4>
              <div className="stack" style={{ gap: 8 }}>
                {rec.perMember.map((m) => (
                  <div key={m.id} className="bar-row">
                    <span className="bar-name">{m.displayName}</span>
                    <div className="bar"><div style={{ width: pct(m.affinity) }} /></div>
                    <span className="bar-value">{pct(m.affinity)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {components && (
            <section>
              <h4>Why this score</h4>
              <div className="stack" style={{ gap: 8 }}>
                {COMPONENTS.map(([key, label, weight]) => (
                  <div key={key} className="bar-row" title={`weight ${weight}`}>
                    <span className="bar-name">{label}</span>
                    <div className="bar"><div style={{ width: pct(components[key]) }} /></div>
                    <span className="bar-value">{pct(components[key])}</span>
                  </div>
                ))}
              </div>
              {reasons?.length > 0 && (
                <ul className="reasons" style={{ marginTop: 12 }}>
                  {reasons.map((r) => <li key={r}>{r}</li>)}
                </ul>
              )}
            </section>
          )}

          {hasCoords && (
            <section>
              <h4>Venue</h4>
              <MapView items={[rec]} center={[event.venue.lat, event.venue.lng]} zoom={13} small group={group} />
            </section>
          )}

          <section>
            <h4>Dates</h4>
            <ul className="dates-list">
              <li><span>{formatDate(event.date)}</span><a href={event.url} target="_blank" rel="noreferrer">{event.venue.name}</a></li>
              {moreDates.map((d) => (
                <li key={d.id}><span>{formatDate(d.date)}</span><a href={d.url} target="_blank" rel="noreferrer">{d.venue}</a></li>
              ))}
            </ul>
          </section>

          {artist?.url && (
            <section>
              <a className="btn btn-ghost" href={artist.url} target="_blank" rel="noreferrer">Open {artist.name} on Spotify <Icon name="external" size={14} /></a>
            </section>
          )}
        </div>
      </aside>
    </>
  );
}
