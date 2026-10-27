import React from 'react';

/**
 * Logomark: a point with three arcs radiating from it, the same motif the
 * affinity ring and the landing backdrop use. Draws in currentColor.
 */
export function Logo({ size = 22 }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="18" r="2.4" fill="currentColor" />
      <path d="M6 11.5a6.5 6.5 0 0 1 6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M6 6.5A11.5 11.5 0 0 1 17.5 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      <path d="M6 1.5A16.5 16.5 0 0 1 22.5 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}

/** Large decorative version for the landing hero; sits behind the text. */
export function RingsBackdrop() {
  const rings = [90, 170, 250, 330, 410];
  return (
    <svg className="hero-art" viewBox="0 0 900 900" aria-hidden="true">
      {rings.map((r, i) => (
        <circle key={r} cx="820" cy="80" r={r} fill="none" stroke="currentColor" strokeWidth="1.5" opacity={0.22 - i * 0.035} />
      ))}
      <circle cx="820" cy="80" r="7" fill="currentColor" opacity="0.9" />
    </svg>
  );
}
