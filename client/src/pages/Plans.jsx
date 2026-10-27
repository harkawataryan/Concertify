import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../hooks/useApp.js';
import { useFetch } from '../hooks/useFetch.js';
import { PlanCard, planShareUrl } from '../components/PlanCard.jsx';
import { Skeleton } from '../components/Skeleton.jsx';
import { EmptyState, ErrorState } from '../components/EmptyState.jsx';
import { Icon } from '../components/Icon.jsx';

export function Plans() {
  const { onAuthError, toast } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const plans = useFetch(() => api.plans().catch((e) => { if (e.status === 401) onAuthError(); throw e; }), []);

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const plan = await api.createPlan(name.trim());
      navigate(`/plan/${plan.code}`);
    } catch (err) {
      toast({ message: err.message, error: true });
    } finally {
      setCreating(false);
    }
  };

  const copy = async (plan) => {
    try {
      await navigator.clipboard.writeText(planShareUrl(plan.code));
      toast({ message: 'Link copied. Anyone who opens it joins the plan.', ttl: 3000 });
    } catch {
      toast({ message: planShareUrl(plan.code), ttl: 8000 });
    }
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Go together</span>
          <h1>Plans</h1>
          <p>Rank shows for a group. Share a link; everyone who opens it joins with their own taste.</p>
        </div>
      </div>

      <form className="row" onSubmit={create} style={{ marginBottom: 'var(--space-8)' }}>
        <input className="input" placeholder="Name a plan, e.g. Fall shows with the roommates" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 240 }} maxLength={60} />
        <button type="submit" className="btn btn-primary" disabled={creating || !name.trim()}><Icon name="plus" size={14} /> Create</button>
      </form>

      {plans.error ? <ErrorState error={plans.error} onRetry={plans.reload} />
        : plans.loading ? <div className="grid"><Skeleton height={140} /><Skeleton height={140} /></div>
          : plans.data.plans.length === 0 ? <EmptyState title="No plans yet" body="Create one above, then send the link to whoever you're going with." />
            : <div className="grid">{plans.data.plans.map((p) => <PlanCard key={p.code} plan={p} onCopy={copy} />)}</div>}
    </main>
  );
}
