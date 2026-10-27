import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../hooks/useApp.js';
import { useFetch } from '../hooks/useFetch.js';
import { ShowCard } from '../components/ShowCard.jsx';
import { DetailDrawer } from '../components/DetailDrawer.jsx';
import { SkeletonGrid, Skeleton } from '../components/Skeleton.jsx';
import { EmptyState, ErrorState } from '../components/EmptyState.jsx';
import { Icon } from '../components/Icon.jsx';
import { planShareUrl } from '../components/PlanCard.jsx';
import { initials } from '../lib/format.js';

export function PlanDetail() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user, loc, savedIds, toggleSave, onAuthError, toast } = useApp();
  const { location } = loc;
  const [open, setOpen] = useState(null);
  const guard = (p) => p.catch((e) => { if (e.status === 401) onAuthError(); throw e; });

  // Opening the plan joins the caller, so this runs before recommendations.
  const plan = useFetch(() => guard(api.plan(code)), [code]);
  const recs = useFetch(
    () => guard(api.planRecommendations(code, location, location.radius)),
    [code, location?.lat, location?.lng, location?.radius, plan.data?.members.length],
    { enabled: Boolean(location && plan.data) }
  );
  const items = useMemo(() => (recs.data?.recommendations || []).map((r) => ({ ...r, saved: r.artist ? savedIds.has(r.artist.id) : false })), [recs.data, savedIds]);
  const openRec = open ? items.find((r) => r.event.id === open) : null;

  const copy = async () => {
    try { await navigator.clipboard.writeText(planShareUrl(code)); toast({ message: 'Link copied', ttl: 2500 }); } catch { toast({ message: planShareUrl(code), ttl: 8000 }); }
  };
  const leave = async () => {
    try { await api.leavePlan(code); navigate('/plans'); } catch (err) { toast({ message: err.message, error: true }); }
  };

  if (plan.error) return <main className="page"><ErrorState error={plan.error} onRetry={plan.reload} /></main>;
  if (plan.loading) return <main className="page"><Skeleton width="40%" height={32} /><div style={{ height: 24 }} /><SkeletonGrid count={3} /></main>;
  const p = plan.data;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{p.name}</h1>
          <p>{p.members.length === 1 ? 'Only you so far. Share the link to add people.' : `Ranked for ${p.members.length} people: average match, with a penalty when someone would hate it.`}</p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={copy}><Icon name="copy" size={14} /> Copy invite link</button>
          {p.ownerId !== user.id && <button type="button" className="btn btn-ghost" onClick={leave}>Leave</button>}
        </div>
      </div>

      <div className="members" style={{ marginBottom: 'var(--space-8)' }}>
        {p.members.map((m) => (
          <span key={m.id} className="member">
            <span className="avatar avatar-sm">{initials(m.displayName)}</span>
            {m.displayName}{m.id === user.id && ' (you)'}
            {m.topGenres?.length > 0 && <small>{m.topGenres.slice(0, 2).join(', ')}</small>}
          </span>
        ))}
      </div>

      {!location ? <EmptyState title="Where are you going?" body="Set a location in the top bar to rank shows for this plan." />
        : recs.error ? <ErrorState error={recs.error} onRetry={recs.reload} />
          : recs.loading && !recs.data ? <SkeletonGrid />
            : items.length === 0 ? <EmptyState title="Nothing matched" body="No shows nearby line up with the group's listening yet. Try a bigger radius." />
              : (
                <div className="grid">
                  {items.map((rec) => <ShowCard key={rec.event.id} rec={rec} group onToggleSave={toggleSave} onOpen={(r) => setOpen(r.event.id)} />)}
                </div>
              )}

      {openRec && <DetailDrawer rec={openRec} group onClose={() => setOpen(null)} onToggleSave={toggleSave} />}
    </main>
  );
}
