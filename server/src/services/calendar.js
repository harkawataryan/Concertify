/** Builds an iCalendar file for one event so it can be added to any calendar app. */

function escapeText(s = '') {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function stamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function eventToIcs(event, { now = new Date() } = {}) {
  const location = [event.venue?.name, event.venue?.city, event.venue?.state].filter(Boolean).join(', ');
  const title = event.attractions?.[0]?.name && !event.name.includes(event.attractions[0].name)
    ? `${event.attractions[0].name}: ${event.name}`
    : event.name;

  let when;
  if (event.dateTime) {
    const start = new Date(event.dateTime);
    const end = new Date(start.getTime() + 3 * 3600 * 1000);
    when = [`DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`];
  } else {
    const day = (event.date || now.toISOString().slice(0, 10)).replace(/-/g, '');
    when = [`DTSTART;VALUE=DATE:${day}`];
  }

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Concertify//EN',
    'BEGIN:VEVENT',
    `UID:${event.id}@concertify`,
    `DTSTAMP:${stamp(now)}`,
    ...when,
    `SUMMARY:${escapeText(title)}`,
    `LOCATION:${escapeText(location)}`,
    `URL:${event.url || ''}`,
    `DESCRIPTION:${escapeText(`Tickets: ${event.url || 'n/a'}`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].join('\r\n');
}
