import React from 'react';
import { PRESET_CITIES } from '../hooks/useLocation.js';

const RADII = [25, 50, 100, 150];

export function LocationPicker({ location, status, setLocation, useDeviceLocation, radius, setRadius }) {
  const selected = PRESET_CITIES.find((c) => c.name === location?.name)?.name || '';
  return (
    <div className="location">
      <button type="button" className="ghost" onClick={useDeviceLocation} disabled={status === 'locating'}>
        {status === 'locating' ? 'Locating…' : 'Use my location'}
      </button>
      <select
        aria-label="City"
        value={selected}
        onChange={(e) => setLocation(PRESET_CITIES.find((c) => c.name === e.target.value))}
      >
        <option value="" disabled>{location?.name === 'Near me' ? 'Near me' : 'Pick a city'}</option>
        {PRESET_CITIES.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
      </select>
      <select aria-label="Radius" value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
        {RADII.map((r) => <option key={r} value={r}>within {r} mi</option>)}
      </select>
      {status === 'denied' && <span className="hint">Location blocked; pick a city instead.</span>}
    </div>
  );
}
