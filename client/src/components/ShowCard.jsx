import React from 'react';
import { Icon } from './Icon.jsx';
import { AffinityRing } from './AffinityRing.jsx';
import { api } from '../api.js';
import { formatDate, venueLine } from '../lib/format.js';

const CONSENSUS = { everyone: ['Everyone', 'tag-positive'], most: ['Most of you', 'tag-accent'], some: ['Some of you', ''] };

/**
 * One ranked show. `group` (groupScore, perMember, consensus) switches it
 * into plan mode. Action handlers are optional; buttons hide without them.
 */
export function ShowCard({ rec, feedback, onFeedback, onToggleSave, onOpen, group = false }) {
  const { event, artist, affinity, reasons, moreDates = [], distanceMi, saved } = rec;
  const title = artist?.name || event.name;
  const vote = feedback && artist ? feedback.artists?.[artist.id] || 0 : 0;
  const score = group ? rec.groupScore : affinity;
  const [consensusLabel, consensusClass] = group && rec.consensus ? CONSENSUS[rec.consensus] : [];

  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };

  return (
    <article
      className="card card-click"
      onClick={() => onOpen?.(rec)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen?.(rec); }}
      tabIndex={0}
      aria-label={`${title}, ${formatDate(event.date)}`}
    >
      <div className="card-media">
        {(event.image || artist?.image) && <img src={event.image || artist.image} alt="" loading="lazy" />}
        <div className="card-media-top">
          <span className="date-chip">{formatDate(event.date)}</span>
          <AffinityRing value={score} label={group ? 'Group score' : 'Affinity'} />
        </div>
        <div className="card-media-bottom">
          <h3>{title}</h3>
          {artist && artist.name !== event.name && <div className="small" style={{ opacity: 0.85 }}>{event.name}</div>}
        </div>
      </div>
      <div className="card-body">
        <div className="card-meta">
          {venueLine(event.venue)}
          {distanceMi != null && <> · {distanceMi} mi</>}
          {moreDates.length > 0 && <> · +{moreDates.length} more {moreDates.length === 1 ? 'date' : 'dates'}</>}
        </div>
        {group ? (
          <>
            {consensusLabel && <div><span className={`tag ${consensusClass}`}>{consensusLabel}</span></div>}
            <div className="member-chips">
              {rec.perMember.map((m) => (
                <span key={m.id} className="member-chip">
                  <span className="avatar avatar-sm">{(m.displayName || '?')[0].toUpperCase()}</span>
                  <b>{m.displayName}</b> {Math.round(m.affinity * 100)}
                </span>
              ))}
            </div>
          </>
        ) : (
          <ul className="reasons">
            {reasons.filter((r) => !/ mi away$/.test(r)).slice(0, 3).map((r) => <li key={r}>{r}</li>)}
          </ul>
        )}
        <div className="card-actions">
          <a className="btn" href={event.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            Tickets <Icon name="external" size={14} />
          </a>
          <a className="btn btn-ghost btn-icon" href={api.calendarUrl(event.id)} aria-label="Add to calendar" title="Add to calendar" onClick={(e) => e.stopPropagation()}>
            <Icon name="calendar" />
          </a>
          <span className="spacer" />
          {onToggleSave && artist && (
            <button type="button" className={`btn btn-ghost btn-icon${saved ? ' is-active' : ''}`} onClick={stop(() => onToggleSave(artist, !saved))} aria-pressed={saved} aria-label={saved ? 'Remove from watchlist' : 'Save to watchlist'} title={saved ? 'On your watchlist' : 'Save to watchlist'}>
              <Icon name={saved ? 'bookmarkFilled' : 'bookmark'} />
            </button>
          )}
          {onFeedback && artist && (
            <>
              <button type="button" className={`btn btn-ghost btn-icon${vote === 1 ? ' is-active' : ''}`} onClick={stop(() => onFeedback('artist', artist.id, vote === 1 ? 0 : 1))} aria-pressed={vote === 1} aria-label="More like this" title="More like this">
                <Icon name="thumbsUp" />
              </button>
              <button type="button" className={`btn btn-ghost btn-icon${vote === -1 ? ' is-negative' : ''}`} onClick={stop(() => onFeedback('artist', artist.id, vote === -1 ? 0 : -1))} aria-pressed={vote === -1} aria-label="Less like this" title="Less like this">
                <Icon name="thumbsDown" />
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
