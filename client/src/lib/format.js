export function formatDate(iso, { weekday = true } = {}) {
  if (!iso) return 'Date TBA';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString(undefined, { ...(weekday && { weekday: 'short' }), month: 'short', day: 'numeric' });
}

export function formatDateLong(iso) {
  if (!iso) return 'Date TBA';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Show time as the venue sees it. `time` is Ticketmaster's venue-local wall
 * clock; converting `dateTime` (UTC) would show the viewer's zone instead,
 * which is wrong for anyone browsing shows in another city.
 */
export function formatTime(event) {
  const local = event?.time;
  if (local) {
    const [h, m] = local.split(':').map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return null;
}

export function venueLine(venue) {
  return [venue?.name, venue?.city, venue?.state].filter(Boolean).join(' · ');
}

export function formatPrice(range) {
  if (!range) return null;
  const sym = range.currency === 'USD' ? '$' : `${range.currency} `;
  const min = Math.round(range.min);
  const max = Math.round(range.max);
  return min === max ? `${sym}${min}` : `${sym}${min}–${max}`;
}

export function pct(x) {
  return `${Math.round((x || 0) * 100)}%`;
}

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

export function timeAgo(iso) {
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/** Affinity 0..1 to a marker/ring color: muted grey through amber. */
export function affinityColor(a) {
  if (a >= 0.6) return '#f2b544';
  if (a >= 0.35) return '#d9a24a';
  return '#8a8f9a';
}
