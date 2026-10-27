import React from 'react';
import { affinityColor, pct } from '../lib/format.js';

export function AffinityRing({ value, size = 44, inline = false, label }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <div className={`ring${inline ? ' ring-inline' : ''}`} style={{ width: size, height: size }} title={`${label || 'Affinity'} ${pct(v)}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill={inline ? 'none' : 'rgba(11,12,15,0.55)'} stroke="rgba(255,255,255,0.18)" strokeWidth="3" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={affinityColor(v)} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v)}
        />
      </svg>
      <div className="ring-label">{Math.round(v * 100)}</div>
    </div>
  );
}
