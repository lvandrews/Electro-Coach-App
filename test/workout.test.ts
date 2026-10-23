import { describe, expect, it } from 'vitest';
import { BUILTIN_DRILLS } from '../src/engine/drills';
import { makeEvent } from '../src/engine/progressive';
import type { PracticeSession } from '../src/engine/session';
import type { TallySession } from '../src/engine/tally';
import { composeSession, estimateMinutes, filmedThisWeek, strokePicks, weekStart, type ComposeArgs } from '../src/engine/workout';

const d = (id: string) => BUILTIN_DRILLS.find(x => x.id === id)!;
const L1 = () => 1;

function xSetTally(start: string, minutes: number): TallySession {
  const spec = d('xdrill').prog!;
  const events = spec.phases.flatMap(ph => Array.from({ length: ph.makes }, () => ({ ...makeEvent(ph.outcomes[0], ph), t: start })));
  const end = new Date(Date.parse(start) + minutes * 60000).toISOString();
  return { id: start, drillId: 'xdrill', drillName: 'X-drill', device: 't', started: start, updated: end, ended: end, events, level: 1 };
}

describe('time estimates', () => {
  it('starts from the drill estimate, then uses the median of your last four sets', () => {
    expect(estimateMinutes(d('xdrill'), [], [])).toEqual({ minutes: 12, n: 0 });
    const ts = [10, 14, 16, 30, 18].map((m, i) => xSetTally(`2026-10-0${i + 1}T10:00:00.000Z`, m));
    expect(estimateMinutes(d('xdrill'), [], ts)).toEqual({ minutes: 17, n: 4 });   // last four: 18, 30, 16, 14 → 17
  });
});

describe('stroke warm-up', () => {
  it('gives new players basic stop shots at three speeds', () => {
    const p = strokePicks('new', L1, { deep: false, basicStopsThisWeek: false });
    expect(p.map(x => x.variant)).toEqual(['low', 'medium', 'high']); expect(p.every(x => x.drillId === 'basic-stops')).toBe(true);
  });
  it('orders the stroke drills and holds Center table draw until the X-drill reaches Level 2', () => {
    const ids = strokePicks('developing', L1, { deep: false, basicStopsThisWeek: true }).map(x => x.drillId);
    expect(ids).toEqual(['midtable-stops', 'midtable-stops', 'xdrill', 'center-follow']);
    const lv = (id: string) => (id === 'xdrill' ? 3 : id === 'center-draw' ? 1 : 2);
    const adv = strokePicks('advanced', lv, { deep: false, basicStopsThisWeek: true }).map(x => x.drillId);
    expect(adv).toEqual(['basic-stops', 'midtable-stops', 'xdrill', 'center-follow', 'center-draw', 'center-draw']);
  });
});

describe('composing a session', () => {
  const base: ComposeArgs = {
    kind: 'planned', minutes: 60, drills: BUILTIN_DRILLS, games: [], tallies: [], stage: 'developing', level: L1,
    timing: 'finish', film: false, filmMinutes: 30, now: new Date('2026-10-23T12:00:00'),
    planBlocks: [
      { title: 'Warm up', minutes: 5, why: '', drills: ['xdrill'] },
      { title: 'Steep cuts', minutes: 20, why: '', drills: ['d1-roll', 'thin-cuts-1'] },
      { title: 'Side pocket', minutes: 15, why: '', drills: ['side-ladder'] },
      { title: 'Run-out pattern', minutes: 20, why: '', drills: ['transitions-1', 'bowling-10'] },
    ],
  };
  it('opens with stroke drills, keeps the X-drill, and finishes tapped drills by count', () => {
    const c = composeSession(base);
    expect(c.run[0].stroke).toBe(true);
    expect(c.run.some(b => b.drillId === 'xdrill')).toBe(true);
    expect(c.run.filter(b => b.stroke).every(b => b.end === 'count' && b.mode === 'tap')).toBe(true);
    expect(c.strokeMinutes).toBeLessThanOrEqual(24);
  });
  it('is tap-only when not filming: Railbird-only drills become tapped or free practice', () => {
    const c = composeSession(base);
    expect(c.run.some(b => b.mode === 'record')).toBe(false);
    expect(c.run.find(b => b.title === 'Steep cuts')!.drillId).toBe('thin-cuts-1');
    expect(c.run.find(b => b.title === 'Side pocket')!.mode).toBe('free');
  });
  it('films only up to the filming limit, in one stretch', () => {
    const c = composeSession({ ...base, film: true, filmMinutes: 20 });
    const rec = c.run.filter(b => b.mode === 'record');
    expect(rec.length).toBeGreaterThan(0);
    expect(rec.reduce((s, b) => s + b.minutes, 0)).toBeLessThanOrEqual(20);
    const idx = c.run.map((b, i) => (b.mode === 'record' ? i : -1)).filter(i => i >= 0);
    expect(idx[idx.length - 1] - idx[0]).toBe(idx.length - 1);
  });
  it('builds the tournament warm-up and the stroke workout', () => {
    expect(composeSession({ ...base, kind: 'tournament' }).run.map(b => [b.drillId, b.variant, b.count])).toEqual([['basic-stops', 'medium', 5]]);
    const sw = composeSession({ ...base, kind: 'stroke' }).run;
    expect(sw).toHaveLength(12); expect(sw.map(b => b.level)).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3]);
  });
});

describe('filming this week', () => {
  it('counts days with filmed blocks or Railbird imports since Monday', () => {
    const now = new Date('2026-10-23T12:00:00');            // a Friday
    expect(weekStart(now).getDay()).toBe(1);
    const g = (date: string, mode: 'record' | 'tap') => ({ id: date, kind: 'practice', date, updated: date, minutes: 60, current: 1, device: 't',
      blocks: [{ title: 'x', why: '', drills: [], drillId: null, minutes: 10, mode, end: 'time', startedAt: date }] } as PracticeSession);
    expect(filmedThisWeek([g('2026-10-20T18:00:00', 'record'), g('2026-10-21T18:00:00', 'tap'), g('2026-10-16T18:00:00', 'record')], ['2026-10-22T19:00:00', '2026-10-20T19:30:00'], now)).toBe(2);
  });
});
