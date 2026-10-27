import React from 'react';

export function formatDate(iso) {
  if (!iso) return 'Date TBA';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function venueLine(venue) {
  return [venue?.name, venue?.city, venue?.state].filter(Boolean).join(' · ');
}

export function ShowCard({ event, artist, distanceMi }) {
  return (
    <a className="card show" href={event.url} target="_blank" rel="noreferrer">
      {event.image && <img src={event.image} alt="" loading="lazy" />}
      <div className="card-body">
        <div className="title">{artist?.name || event.name}</div>
        <div className="sub">{formatDate(event.date)}{distanceMi != null && ` · ${distanceMi} mi`}</div>
        <div className="sub">{venueLine(event.venue)}</div>
        {event.priceRange && (
          <div className="sub">from {event.priceRange.currency} {Math.round(event.priceRange.min)}</div>
        )}
      </div>
    </a>
  );
}
