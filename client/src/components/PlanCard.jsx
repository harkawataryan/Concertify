import React from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon.jsx';
import { initials } from '../lib/format.js';

export function planShareUrl(code) {
  return `${window.location.origin}/plan/${code}`;
}

export function PlanCard({ plan, onCopy }) {
  return (
    <div className="card" style={{ padding: 'var(--space-4)', gap: 'var(--space-3)' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Link to={`/plan/${plan.code}`} style={{ textDecoration: 'none' }}><h3>{plan.name}</h3></Link>
        <span className="tag">{plan.members.length} {plan.members.length === 1 ? 'member' : 'members'}</span>
      </div>
      <div className="row">
        {plan.members.slice(0, 6).map((m) => (
          <span key={m.id} className="avatar avatar-sm" title={m.displayName}>{initials(m.displayName)}</span>
        ))}
        {plan.members.length > 6 && <span className="faint small">+{plan.members.length - 6}</span>}
      </div>
      <div className="row">
        <Link to={`/plan/${plan.code}`} className="btn">Open</Link>
        <button type="button" className="btn btn-ghost" onClick={() => onCopy(plan)}><Icon name="copy" size={14} /> Copy link</button>
      </div>
    </div>
  );
}
