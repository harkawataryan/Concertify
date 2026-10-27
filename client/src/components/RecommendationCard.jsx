import React from 'react';
import { formatDate, venueLine } from './ShowCard.jsx';

/**
 * One ranked show: affinity bar, the reasons it was picked, thumbs up/down
 * on the artist, and any additional dates collapsed under the card.
 */
export function RecommendationCard({ rec, feedback, onFeedback }) {
  const { event, artist, affinity, reasons, moreDates = [], distanceMi } = rec;
  const current = artist ? feedback.artists?.[artist.id] || 0 : 0;
  const vote = (signal) => artist && onFeedback('artist', artist.id, current === signal ? 0 : signal);

  return (
    <div className="card rec">
      {(event.image || artist?.image) && <img src={event.image || artist.image} alt="" loading="lazy" />}
      <div className="card-body">
        <div className="title-row">
          <div className="title">{artist?.name || event.name}</div>
          <div className="affinity" title={`Affinity ${Math.round(affinity * 100)}%`}>
            <div className="affinity-bar" style={{ width: `${Math.round(affinity * 100)}%` }} />
          </div>
        </div>
        <div className="sub">{formatDate(event.date)}{distanceMi != null && ` · ${distanceMi} mi`}</div>
        <div className="sub">{venueLine(event.venue)}</div>
        <ul className="reasons">
          {reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
        {moreDates.length > 0 && (
          <details className="more-dates">
            <summary>{moreDates.length} more {moreDates.length === 1 ? 'date' : 'dates'}</summary>
            <ul>
              {moreDates.map((d) => (
                <li key={d.id}><a href={d.url} target="_blank" rel="noreferrer">{formatDate(d.date)} · {d.venue}</a></li>
              ))}
            </ul>
          </details>
        )}
        <div className="card-actions">
          <a className="button" href={event.url} target="_blank" rel="noreferrer">Tickets</a>
          {artist && (
            <>
              <button type="button" className={`ghost ${current === 1 ? 'active' : ''}`} onClick={() => vote(1)} aria-label="More like this">👍</button>
              <button type="button" className={`ghost ${current === -1 ? 'active' : ''}`} onClick={() => vote(-1)} aria-label="Less like this">👎</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
