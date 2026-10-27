import React from 'react';

export function Skeleton({ width = '100%', height = 14, style }) {
  return <div className="skeleton" style={{ width, height, ...style }} aria-hidden="true" />;
}

export function SkeletonCard() {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <div className="skeleton skeleton-media" />
      <div className="skeleton-lines">
        <Skeleton width="60%" height={16} />
        <Skeleton width="40%" />
        <Skeleton width="80%" />
        <Skeleton width="30%" height={28} style={{ marginTop: 8 }} />
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 6 }) {
  return (
    <div className="grid" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}
