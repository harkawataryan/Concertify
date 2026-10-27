import React from 'react';

export function EmptyState({ title, body, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <EmptyState
      title="Couldn't load this"
      body={error?.message || 'Something went wrong.'}
      action={onRetry && <button type="button" className="btn" onClick={onRetry}>Try again</button>}
    />
  );
}
