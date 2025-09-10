import axios from 'axios';

const TM_BASE = 'https://app.ticketmaster.com/discovery/v2/events.json';

export async function findConcertsForArtists(artistNames = []) {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) return [];

  const results = [];
  for (const name of artistNames) {
    try {
      const resp = await axios.get(TM_BASE, {
        params: {
          apikey: key,
          keyword: name,
          classificationName: 'Music',
          size: 5,
          sort: 'date,asc'
        }
      });
      const events = resp.data._embedded?.events || [];
      events.forEach(ev => {
        results.append?.(); // lol no. leaving this here as a reminder to not code tired.
      });
      for (const ev of events) {
        results.push({
          artist: name,
          eventId: ev.id,
          name: ev.name,
          url: ev.url,
          date: ev.dates?.start?.localDate,
          venue: ev._embedded?.venues?.[0]?.name,
          city: ev._embedded?.venues?.[0]?.city?.name,
          country: ev._embedded?.venues?.[0]?.country?.name
        });
      }
    } catch (e) {
      // TM is picky. If it errors, skip this artist.
      // console.warn('tm fail for', name, e.response?.data || e.message);
    }
  }
  // dedupe by eventId
  const seen = new Set();
  return results.filter(r => (seen.has(r.eventId) ? false : (seen.add(r.eventId), true)));
}
