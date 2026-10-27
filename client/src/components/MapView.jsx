import React, { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { affinityColor, formatDate, venueLine } from '../lib/format.js';

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(points, { padding: [32, 32], maxZoom: 12 });
    else if (points.length === 1) map.setView(points[0], 12);
  }, [map, points.map((p) => p.join(',')).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * Recommendations as markers tinted by affinity. Circle markers avoid
 * Leaflet's default icon assets, which don't survive bundling well.
 */
export function MapView({ items, center, zoom = 11, small = false, onOpen, group = false }) {
  const withCoords = items.filter((r) => r.event.venue.lat != null && r.event.venue.lng != null);
  const points = withCoords.map((r) => [r.event.venue.lat, r.event.venue.lng]);
  const fallback = center || points[0] || [39.5, -98.35];

  return (
    <div className={`map-wrap${small ? ' map-sm' : ''}`}>
      <MapContainer center={fallback} zoom={zoom} scrollWheelZoom={!small} style={{ height: '100%', width: '100%' }} attributionControl>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        {!small && <FitBounds points={points} />}
        {withCoords.map((r) => {
          const score = group ? r.groupScore : r.affinity;
          return (
            <CircleMarker
              key={r.event.id}
              center={[r.event.venue.lat, r.event.venue.lng]}
              radius={small ? 8 : 6 + score * 8}
              pathOptions={{ color: affinityColor(score), fillColor: affinityColor(score), fillOpacity: 0.85, weight: 1.5 }}
            >
              {!small && (
                <Popup>
                  <b>{r.artist?.name || r.event.name}</b>
                  {formatDate(r.event.date)} · {Math.round(score * 100)}% match<br />
                  <span>{venueLine(r.event.venue)}</span><br />
                  {onOpen ? <a href="#" onClick={(e) => { e.preventDefault(); onOpen(r); }}>Details</a> : <a href={r.event.url} target="_blank" rel="noreferrer">Tickets</a>}
                </Popup>
              )}
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
