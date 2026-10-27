import { describe, it, expect } from 'vitest';
import { parseFilters, applyFilters, availableGenres } from '../src/services/filters.js';

const ev = (id, { date = '2026-11-14', price = null, genres = [], attractionGenres = [] } = {}) => ({
  id, date, priceRange: price ? { min: price, max: price * 2, currency: 'USD' } : null,
  genres, attractions: [{ id: `a${id}`, name: id, genres: attractionGenres }]
});

describe('parseFilters', () => {
  it('validates and normalizes query values', () => {
    expect(parseFilters({ from: '2026-11-01', to: 'nope', weekend: '1', maxPrice: '45', genres: 'Rock, Pop', exclude: '' }))
      .toEqual({ from: '2026-11-01', to: null, weekend: true, maxPrice: 45, genres: ['rock', 'pop'], exclude: [] });
    expect(parseFilters({})).toEqual({ from: null, to: null, weekend: false, maxPrice: null, genres: [], exclude: [] });
  });
});

describe('applyFilters', () => {
  const events = [
    ev('fri', { date: '2026-11-13', price: 30, genres: ['rock'] }), // Friday
    ev('tue', { date: '2026-11-17', price: 120, attractionGenres: ['country'] }), // Tuesday
    ev('sat-noprice', { date: '2026-11-21', genres: ['pop'] })
  ];

  it('filters by date range', () => {
    const { events: out, filteredOut } = applyFilters(events, parseFilters({ from: '2026-11-15' }));
    expect(out.map((e) => e.id)).toEqual(['tue', 'sat-noprice']);
    expect(filteredOut).toBe(1);
  });

  it('keeps only Fri/Sat/Sun when weekend is set', () => {
    expect(applyFilters(events, parseFilters({ weekend: '1' })).events.map((e) => e.id)).toEqual(['fri', 'sat-noprice']);
  });

  it('applies max price but keeps shows with no listed price', () => {
    expect(applyFilters(events, parseFilters({ maxPrice: '50' })).events.map((e) => e.id)).toEqual(['fri', 'sat-noprice']);
  });

  it('includes and excludes by genre across event and performer labels', () => {
    expect(applyFilters(events, parseFilters({ genres: 'country' })).events.map((e) => e.id)).toEqual(['tue']);
    expect(applyFilters(events, parseFilters({ exclude: 'rock,pop' })).events.map((e) => e.id)).toEqual(['tue']);
  });
});

describe('availableGenres', () => {
  it('counts labels most common first', () => {
    const out = availableGenres([ev('1', { genres: ['rock'] }), ev('2', { genres: ['rock'], attractionGenres: ['pop'] })]);
    expect(out).toEqual([{ genre: 'rock', count: 2 }, { genre: 'pop', count: 1 }]);
  });
});
