import { describe, it, expect } from 'vitest';
import { addEntry, applyAutoCheck, autoCheckDue, changeNotice, changeOver, parseFargo, EMPTY_FARGO, type FargoData, type FargoPlayer } from '../src/engine/fargo';
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

describe('daily FargoRate check', () => {
  const linked: FargoData = { id: 'ABC', name: 'Lela', entries: [{ date: '2026-10-20', rating: 520, source: 'lookup' }] };
  const p = (rating: number | null): FargoPlayer => ({ id: 'ABC', name: 'Lela', location: '', rating, provisional: false, robustness: 300 });
  const morning = new Date(2026, 9, 23, 9, 0), evening = new Date(2026, 9, 23, 21, 0), tomorrow = new Date(2026, 9, 24, 8, 0);
  it('is due once a day when linked and switched on', () => {
    expect(autoCheckDue(linked, morning)).toBe(true);
    const done = applyAutoCheck(linked, p(520), morning);
    expect(autoCheckDue(done, evening)).toBe(false);
    expect(autoCheckDue(done, tomorrow)).toBe(true);
    expect(autoCheckDue({ ...linked, auto: false }, morning)).toBe(false);
    expect(autoCheckDue(EMPTY_FARGO, morning)).toBe(false);
  });
  it('a failed check still counts as today’s try', () => {
    const f = applyAutoCheck(linked, null, morning);
    expect(f.lastCheck?.ok).toBe(false); expect(autoCheckDue(f, evening)).toBe(false); expect(f.entries).toHaveLength(1);
  });
  it('charts a rating only when it changes (or a month has passed), never over a hand entry', () => {
    expect(applyAutoCheck(linked, p(520), morning).entries).toHaveLength(1);
    expect(applyAutoCheck(linked, p(524), morning).entries.map(e => e.rating)).toEqual([520, 524]);
    expect(applyAutoCheck(linked, p(520), new Date(2026, 10, 25, 9)).entries).toHaveLength(2);
    const manual: FargoData = { ...linked, entries: [...linked.entries, { date: '2026-10-23', rating: 530, source: 'manual' }] };
    expect(applyAutoCheck(manual, p(524), morning).entries.map(e => e.rating)).toEqual([520, 530]);
  });
});

describe('FargoRate change notification', () => {
  const before: FargoData = { id: 'ABC', entries: [{ date: '2026-10-20', rating: 522, robustness: 400, source: 'lookup' }],
    lastCheck: { at: '2026-10-22T16:00:00Z', ok: true, rating: 522, robustness: 408 } };
  const after = (rating: number, robustness?: number): FargoData => ({ ...before, lastCheck: { at: '2026-10-23T16:00:00Z', ok: true, rating, robustness } });
  it('names the games added and the change', () => {
    expect(changeNotice(before, after(523, 412))).toEqual({ title: 'FargoRate: 523 (+1)', body: 'You added 4 games to FargoRate and your rating changed by +1 to 523.' });
    expect(changeNotice(before, after(520))?.body).toBe('Your FargoRate rating changed by −2 to 520.');
  });
  it('stays quiet when nothing changed or the check failed', () => {
    expect(changeNotice(before, after(522, 415))).toBeNull();
    expect(changeNotice(before, { ...before, lastCheck: { at: '2026-10-23T16:00:00Z', ok: false } })).toBeNull();
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
