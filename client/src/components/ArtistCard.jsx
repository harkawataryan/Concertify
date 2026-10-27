import React from 'react';

export function ArtistCard({ artist, rank, children }) {
  return (
    <div className="card">
      {artist.image
        ? <img src={artist.image} alt="" loading="lazy" />
        : <div className="img-placeholder" aria-hidden="true" />}
      <div className="card-body">
        <div className="title">
          {rank != null && <span className="rank">#{rank}</span>}
          {artist.url ? <a href={artist.url} target="_blank" rel="noreferrer">{artist.name}</a> : artist.name}
        </div>
        <div className="sub">{(artist.genres || []).slice(0, 3).join(', ') || 'no genre data'}</div>
        {children}
      </div>
    </div>
  );
}
