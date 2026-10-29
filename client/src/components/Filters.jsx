import React from 'react';
import { RADII, radiusLabel } from '../hooks/useLocation.js';

export const EMPTY_FILTERS = { from: '', to: '', weekend: false, maxPrice: '', genres: [], exclude: [] };

/**
 * Genre chips cycle: neutral -> include -> exclude -> neutral. `available`
 * comes from the last response so the chips reflect what's actually on.
 */
export function Filters({ filters, onChange, radius, onRadius, available = [], disabled }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  const cycle = (genre) => {
    if (filters.genres.includes(genre)) set({ genres: filters.genres.filter((g) => g !== genre), exclude: [...filters.exclude, genre] });
    else if (filters.exclude.includes(genre)) set({ exclude: filters.exclude.filter((g) => g !== genre) });
    else set({ genres: [...filters.genres, genre] });
  };
  const active = filters.from || filters.to || filters.weekend || filters.maxPrice || filters.genres.length || filters.exclude.length;

  return (
    <div className="filters" aria-label="Filters">
      <label className="field">From
        <input className="input" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} disabled={disabled} />
      </label>
      <label className="field">To
        <input className="input" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} disabled={disabled} />
      </label>
      <label className="field">Max ticket price
        <input className="input" type="number" min="0" step="5" placeholder="Any" value={filters.maxPrice} onChange={(e) => set({ maxPrice: e.target.value })} disabled={disabled} style={{ width: 110 }} />
      </label>
      <label className="field">Radius
        <div className="segmented">
          {RADII.map((r) => <button key={r} type="button" className={radius === r ? 'is-active' : ''} onClick={() => onRadius(r)} disabled={disabled}>{radiusLabel(r)}</button>)}
        </div>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={filters.weekend} onChange={(e) => set({ weekend: e.target.checked })} disabled={disabled} /> Weekends only
      </label>
      {active ? <button type="button" className="btn btn-ghost" onClick={() => onChange(EMPTY_FILTERS)} disabled={disabled}>Clear</button> : null}
      {available.length > 0 && (
        <div className="genre-chips">
          <span className="label">Genres · click once to include, twice to exclude</span>
          {available.slice(0, 18).map(({ genre, count }) => {
            const state = filters.genres.includes(genre) ? 'is-on' : filters.exclude.includes(genre) ? 'is-off' : '';
            return (
              <button key={genre} type="button" className={`chip ${state}`} onClick={() => cycle(genre)} disabled={disabled} aria-pressed={state === 'is-on'}>
                {genre} <span className="faint">{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
