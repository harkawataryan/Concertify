import { describe, it, expect } from 'vitest';
import { eventToIcs } from '../src/services/calendar.js';

describe('eventToIcs', () => {
  it('produces a timed VEVENT with escaped text', () => {
    const ics = eventToIcs({
      id: 'e1', name: 'Jubilee Tour', url: 'https://tm/e1', dateTime: '2026-11-14T02:00:00Z', date: '2026-11-13',
      venue: { name: "Stubb's, Waller Creek", city: 'Austin', state: 'TX' },
      attractions: [{ name: 'Japanese Breakfast' }]
    }, { now: new Date('2026-11-01T00:00:00Z') });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('DTSTART:20261114T020000Z');
    expect(ics).toContain('DTEND:20261114T050000Z');
    expect(ics).toContain('SUMMARY:Japanese Breakfast: Jubilee Tour');
    expect(ics).toContain("LOCATION:Stubb's\\, Waller Creek\\, Austin\\, TX");
    expect(ics.split('\r\n')).toContain('END:VCALENDAR');
  });

  it('falls back to an all-day event without a start time', () => {
    const ics = eventToIcs({ id: 'e2', name: 'Show', date: '2026-12-31', venue: {}, attractions: [] });
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231');
    expect(ics).not.toContain('DTEND');
  });
});
