/**
 * One email per finished visit to aryanh.dev, sent through Resend.
 *
 * recordHit() schedules each visit for when it looks finished. A sweep runs
 * every 30 seconds and at startup, so visits that came due while the free
 * Render instance was asleep go out when it wakes. Each visit is marked
 * `emailed` so it never goes out twice.
 */

const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'Washington DC', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
};
let regionNames = null;
try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* small-icu builds */ }

export function place(code) {
  if (!code) return 'Unknown location';
  const [country, region] = code.split('-');
  if (country === 'US' && US_STATES[region]) return `${US_STATES[region]}, US`;
  let name = country;
  try { name = regionNames?.of(country) || country; } catch { /* unknown code */ }
  return region ? `${region}, ${name}` : name;
}

function device(v) {
  const kind = v.kind || (!v.width ? 'unknown device' : v.width < 700 ? 'phone' : v.width < 1100 ? 'tablet' : 'desktop');
  return v.width ? `${kind}, ${v.width}px wide` : kind;
}

/** "45s", "3m 10s". */
export function duration(sec) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), r = sec % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

const when = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// Heartbeats give the exact visible time and deepest section. Older pages
// only send the closing summary, which has a time bucket.
function reached(v, section) {
  const where = v.deepest || section?.name;
  // Without heartbeats, the exact stay is the time from the first page view
  // to the closing summary, which is sent the moment the visitor leaves.
  const first = v.hits.find((h) => !h.e);
  const left = [...v.hits].reverse().find((h) => h.e && h.p.startsWith('visit/'));
  // A check-in time is the whole visit only when it was the final one or the
  // summary also arrived; otherwise it's a minimum.
  const whole = v.final || !!left;
  const exact = v.active || (first && left ? Math.max(0, Math.round((Date.parse(left.t) - Date.parse(first.t)) / 1000)) : null);
  const stay = exact != null ? (v.active && !whole ? `at least ${duration(exact)}` : duration(exact)) : section?.stay;
  if (!where && !stay) {
    // Newer pages check in at 3 seconds (the first version, which set a visitor id, at 10),
    // so no check-in at all means they left before it.
    if (v.cv >= 2) return 'left within about 3 seconds';
    if (v.visitor) return 'left within about 10 seconds';
    return 'no scroll data (left before it was sent, or blocked)';
  }
  return [where && `scrolled to ${where}`, stay && `stayed ${stay}`].filter(Boolean).join(', ');
}

/** Subject and plain-text body, in the same format the hourly emailer used. */
export function summarize(v) {
  const pages = [], clicks = [];
  let section = null;
  for (const h of v.hits) {
    if (!h.e) { if (!pages.includes(h.p)) pages.push(h.p); continue; }
    const m = /^visit\/([^/]+)\/(.+)$/.exec(h.p);
    if (m) section = { name: m[1], stay: m[2] };
    else clicks.push(h.p.replace(/^click\//, '').replace(/\/$/, ''));
  }
  const where = place(v.loc);
  let refHost = '';
  try { refHost = v.ref ? new URL(v.ref).hostname.replace(/^www\./, '') : ''; } catch { refHost = v.ref.split('/')[0]; }
  const lines = [
    `When:      ${when.format(new Date(v.start))} Central`,
    `Where:     ${where}`,
    `From:      ${v.ref || 'direct (typed or bookmarked)'}`,
    `Device:    ${v.browser || '?'} on ${v.system || '?'}, ${device(v)}`,
    `Visitor:   ${v.first ? 'first visit' : 'returning'}`,
    `Pages:     ${pages.join(', ') || '(events only)'}`,
    `Reached:   ${reached(v, section)}`,
    `Clicked:   ${clicks.length ? clicks.join(', ') : 'nothing'}`
  ];
  return {
    subject: `aryanh.dev visit · ${where} · ${refHost || 'direct'}`,
    text: lines.join('\n') + '\n\nStats: https://aryanh.dev/stats/\n'
  };
}

export async function sendResend({ apiKey, to, subject, text, fetchImpl = fetch }) {
  // Without a verified domain, Resend only delivers from its onboarding
  // address to the email the Resend account was created with.
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'aryanh.dev <onboarding@resend.dev>', to: [to], subject, text }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export function createNotifier({ store, apiKey, to, now = Date.now, fetchImpl = fetch, log = console }) {
  let running = false;
  async function sweep() {
    if (running) return 0;
    running = true;
    let sent = 0;
    try {
      for (const id of await store.dueBy(now())) {
        const v = await store.getVisit(id);
        if (!v || v.emailed || (v.dc && !v.human)) { await store.unschedule(id); continue; }
        try {
          const { subject, text } = summarize(v);
          await sendResend({ apiKey, to, subject, text, fetchImpl });
          v.emailed = true;
          await store.putVisit(v);
          await store.unschedule(id);
          sent++;
        } catch (err) {
          // Leave it scheduled; the next sweep retries.
          log.warn?.('visit email failed', { err: err.message });
          break;
        }
      }
    } finally {
      running = false;
    }
    return sent;
  }
  return {
    sweep,
    start(intervalMs = 30_000) {
      sweep().catch(() => {});
      const t = setInterval(() => sweep().catch(() => {}), intervalMs);
      t.unref?.();
      return () => clearInterval(t);
    }
  };
}
