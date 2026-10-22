import { describe, it, expect } from 'vitest';
import { addEntry, changeOver, parseFargo, EMPTY_FARGO } from '../src/engine/fargo';
import { normalizeUrl, STARTER_RESOURCES } from '../src/engine/resources';

describe('FargoRate', () => {
  const player = { firstName: 'Jasmin', lastName: 'Ouschan', readableId: '360838', rating: '761', effectiveRating: '761', provisionalRating: '675', robustness: '7963', location: 'Klagenfurt' };
  it('reads the search response whatever wraps it', () => {
    for (const j of [[player], { value: [player] }, { results: [player] }, player]) {
      expect(parseFargo(j)).toEqual([{ id: '360838', name: 'Jasmin Ouschan', location: 'Klagenfurt', rating: 761, provisional: false, robustness: 7963 }]);
    }
    expect(parseFargo({ value: [{ ...player, rating: 0, effectiveRating: 0 }] })[0]).toMatchObject({ rating: 675, provisional: true });
    expect(parseFargo('nonsense')).toEqual([]);
  });
  it('keeps one entry per day and measures change', () => {
    let f = addEntry(EMPTY_FARGO, { date: '2026-06-01', rating: 480, source: 'manual' });
    f = addEntry(f, { date: '2026-10-01', rating: 495, source: 'lookup' });
    f = addEntry(f, { date: '2026-10-01', rating: 497, source: 'lookup' });
    expect(f.entries.map(e => e.rating)).toEqual([480, 497]);
    expect(changeOver(f, 90)).toMatchObject({ diff: 17 });
  });
});

describe('resources', () => {
  it('normalizes web addresses and rejects others', () => {
    expect(normalizeUrl('salotto.app')).toBe('https://salotto.app/');
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('localhost')).toBeNull();
  });
  it('ships the starter list', () => {
    expect(STARTER_RESOURCES.map(g => g.title)).toEqual(['Training tools', 'Instructional channels', 'Rating system', 'Play matches']);
    expect(STARTER_RESOURCES.flatMap(g => g.links).every(l => normalizeUrl(l.url) === l.url)).toBe(true);
  });
});
