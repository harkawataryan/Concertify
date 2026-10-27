import { describe, it, expect } from 'vitest';
import { rankForGroup } from '../src/services/group.js';

const NOW = Date.parse('2026-11-01T00:00:00Z');
const artist = (id, genres) => ({ id, name: id, genres });
const event = (id, performer, genres) => ({
  id, name: `${performer} Live`, url: 'u', date: '2026-11-20', dateTime: '2026-11-20T20:00:00Z', genres,
  venue: { name: 'V', lat: 30.27, lng: -97.74 },
  attractions: [{ id: `att-${id}`, name: performer, genres, spotifyId: performer }]
});
const resolveArtist = async (a) => ({ id: a.spotifyId, name: a.name, genres: a.genres });

describe('rankForGroup', () => {
  const plan = {
    members: [
      { id: 'u1', displayName: 'Ana', topByRange: { short_term: [artist('mitski', ['indie rock']), artist('bigthief', ['indie folk'])] } },
      { id: 'u2', displayName: 'Ben', topByRange: { short_term: [artist('mitski', ['indie rock']), artist('luke', ['country'])] } }
    ]
  };
  const events = [
    event('shared', 'mitski', ['indie rock']),
    event('ana-only', 'bigthief', ['indie folk']),
    event('ben-only', 'luke', ['country'])
  ];

  it('ranks the show both members like above shows only one likes', async () => {
    const ranked = await rankForGroup({ plan, events, resolveArtist, now: NOW });
    expect(ranked[0].event.id).toBe('shared');
    expect(ranked[0].consensus).toBe('everyone');
    expect(ranked[0].perMember.map((m) => m.id).sort()).toEqual(['u1', 'u2']);
    expect(ranked[0].reasons[0]).toBe('A match for everyone');
  });

  it('penalizes least-misery: a show one member scores zero on ranks below the group score of its fan', async () => {
    const ranked = await rankForGroup({ plan, events, resolveArtist, now: NOW });
    const anaOnly = ranked.find((r) => r.event.id === 'ana-only');
    const [ana, ben] = anaOnly.perMember;
    expect(ana.id).toBe('u1');
    expect(ben.affinity).toBeLessThan(0.3);
    // mean alone would give (ana+ben)/2; the min term pulls it further down
    expect(anaOnly.groupScore).toBeLessThan((ana.affinity + ben.affinity) / 2);
    expect(anaOnly.groupScore).toBeLessThan(ranked[0].groupScore);
    expect(anaOnly.consensus).toBe('most');
    expect(anaOnly.reasons[0]).toBe('A match for Ana');
  });

  it('respects the limit', async () => {
    const ranked = await rankForGroup({ plan, events, resolveArtist, now: NOW, limit: 1 });
    expect(ranked).toHaveLength(1);
  });
});
