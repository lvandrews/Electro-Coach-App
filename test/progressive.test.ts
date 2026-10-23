import { describe, expect, it } from 'vitest';
import { BUILTIN_DRILLS } from '../src/engine/drills';
import { currentPhase, levelState, makeEvent, missEvent, requiredMakes, sideNow, summarize, verdictOf, type ProgSpec } from '../src/engine/progressive';
import type { TallyEvent, TallySession } from '../src/engine/tally';

const X = BUILTIN_DRILLS.find(d => d.id === 'xdrill')!;
const spec = X.prog!;
const ev = (e: Omit<TallyEvent, 't'>): TallyEvent => ({ ...e, t: '2026-10-23T10:00:00Z' });

/** A full X-drill set: `q` of each 10 are quality, `m` misses per phase. */
function xSet(q: number, m: number, level = 1, ended = '2026-10-23T10:00:00Z'): TallySession {
  const events: TallyEvent[] = [];
  for (const ph of spec.phases) {
    const good = ph.outcomes.find(o => o.quality)!, plain = ph.outcomes.find(o => !o.quality)!;
    for (let i = 0; i < m; i++) events.push(ev(missEvent(i % 2 ? 'R' : 'L', ph)));
    for (let i = 0; i < 10; i++) events.push(ev(makeEvent(i < q ? good : plain, ph)));
  }
  return { id: ended, drillId: 'xdrill', drillName: 'X-drill', device: 't', started: ended, updated: ended, ended, events, level };
}

describe('progressive drills', () => {
  it('defines the four stroke drills', () => {
    for (const id of ['midtable-stops', 'xdrill', 'center-follow', 'center-draw']) {
      const d = BUILTIN_DRILLS.find(x => x.id === id)!;
      expect(d.category).toBe('stroke'); expect(d.prog?.levels).toHaveLength(3);
    }
    expect(requiredMakes(spec)).toBe(30);
    expect(requiredMakes(BUILTIN_DRILLS.find(x => x.id === 'midtable-stops')!.prog!)).toBe(15);
    expect(requiredMakes(BUILTIN_DRILLS.find(x => x.id === 'center-draw')!.prog!)).toBe(10);
  });

  it('walks the X-drill phases: follow, stop, draw', () => {
    const s = xSet(7, 2);
    expect(currentPhase(spec, s.events.slice(0, 5)).phase.id).toBe('follow');
    expect(currentPhase(spec, s.events.slice(0, 13)).phase.id).toBe('stop');
    expect(currentPhase(spec, s.events).done).toBe(true);
  });

  it('scores make % and quality %', () => {
    const sum = summarize(spec, xSet(8, 2));
    expect(sum.makes).toBe(30); expect(sum.attempts).toBe(36);
    expect(sum.makePct).toBeCloseTo(30 / 36); expect(sum.qualityPct).toBeCloseTo(24 / 30);
    expect(sum.misses.L + sum.misses.R).toBe(6); expect(sum.complete).toBe(true);
    expect(verdictOf(sum)).toBe('good');                         // 83% made, 80% quality
    expect(verdictOf(summarize(spec, xSet(8, 5)))).toBe('poor'); // 67% made
    expect(verdictOf(summarize(spec, xSet(4, 0)))).toBe('poor'); // 40% quality
    expect(verdictOf(summarize(spec, xSet(6, 1)))).toBe('neither'); // 91% made, 60% quality
  });

  it('moves up after two good sets in a row, and down after two poor ones', () => {
    const at = (h: number) => `2026-10-${String(h).padStart(2, '0')}T10:00:00Z`;
    expect(levelState(spec, [xSet(8, 2, 1, at(1))]).level).toBe(1);
    const up = levelState(spec, [xSet(8, 2, 1, at(1)), xSet(8, 2, 1, at(2))]);
    expect(up.level).toBe(2); expect(up.changed).toMatchObject({ from: 1, to: 2 });
    // a good, then an in-between set: no move
    expect(levelState(spec, [xSet(8, 2, 1, at(1)), xSet(6, 1, 1, at(2)), xSet(8, 2, 1, at(3))]).level).toBe(1);
    // one poor set never demotes; two in a row do
    const l2 = [xSet(8, 2, 1, at(1)), xSet(8, 2, 1, at(2))];
    expect(levelState(spec, [...l2, xSet(4, 0, 2, at(3))]).level).toBe(2);
    expect(levelState(spec, [...l2, xSet(4, 0, 2, at(3)), xSet(4, 0, 2, at(4))]).level).toBe(1);
  });

  it('ignores sets at other levels and unfinished sets, and starts from a manual switch', () => {
    const at = (h: number) => `2026-10-${String(h).padStart(2, '0')}T10:00:00Z`;
    expect(levelState(spec, [xSet(8, 2, 3, at(1)), xSet(8, 2, 3, at(2))]).level).toBe(1);
    const half = { ...xSet(8, 2, 1, at(1)), events: xSet(8, 2, 1, at(1)).events.slice(0, 10) };
    expect(levelState(spec, [half, xSet(8, 2, 1, at(2))]).good).toBe(1);
    const st = levelState(spec, [xSet(8, 2, 1, at(1)), xSet(8, 2, 1, at(2))], undefined, { level: 3, at: at(1) + 'x' });
    expect(st.level).toBe(3);
  });

  it('marks the top level mastered', () => {
    const at = (h: number) => `2026-10-${String(h).padStart(2, '0')}T10:00:00Z`;
    const st = levelState(spec, [xSet(9, 0, 3, at(2)), xSet(9, 0, 3, at(3))], undefined, { level: 3, at: at(1) });
    expect(st.level).toBe(3); expect(st.mastered).toBe(true);
  });

  it('non-progressive specs stay at level 1', () => {
    const flat: ProgSpec = { ...spec, progressive: false };
    expect(levelState(flat, [xSet(9, 0, 1), xSet(9, 0, 1)]).level).toBe(1);
  });
});

describe('basic and thin-cut drills', () => {
  const find = (id: string) => BUILTIN_DRILLS.find(d => d.id === id)!;
  it('uses the chosen set size for basic stop shots, with spin and drift', () => {
    const sp = find('basic-stops').prog!;
    const ph = sp.phases[0];
    const o = (id: string) => ph.outcomes.find(x => x.id === id)!;
    const events = [o('b-stop'), o('b-stop-sR'), o('b-dl'), o('b-dl-sR'), o('b-stop')].map(x => ev(makeEvent(x, ph)));
    const s = summarize(sp, { events, target: 5 });
    expect(requiredMakes(sp, 5)).toBe(5); expect(requiredMakes(sp, 7)).toBe(7);
    expect(s.complete).toBe(true);
    expect(s.quality).toBe(3); expect(s.best).toBe(2);           // within a radius: 3; stopped dead: 2
    expect(s.spin).toEqual({ L: 0, R: 2 }); expect(s.drift).toEqual({ L: 2, R: 0 });
    expect(summarize(sp, { events, target: 7 }).complete).toBe(false);
    expect(ph.outcomes.filter(x => !x.hidden)).toHaveLength(5);
  });
  it('records basic draw shots reaching the rail left or right', () => {
    const sp = find('basic-draws').prog!; const ph = sp.phases[0];
    const s = summarize(sp, { events: ['bd-in', 'bd-rl', 'bd-rr', 'bd-rl', 'bd-short'].map(id => ev(makeEvent(ph.outcomes.find(x => x.id === id)!, ph))) });
    expect(s.rail).toEqual({ L: 2, R: 1 }); expect(s.quality).toBe(4); expect(s.best).toBe(1); expect(requiredMakes(sp)).toBe(7);
  });
  it('alternates thin cuts after every make and scores make % only', () => {
    const sp = find('thin-cuts-1').prog!; const ph = sp.phases[0]; const made = ph.outcomes[0];
    const events: TallyEvent[] = [];
    const tap = (e: Omit<TallyEvent, 't'>) => events.push(ev(e));
    expect(sideNow(sp, events)).toBe('L');
    tap(missEvent('thin', ph, sideNow(sp, events))); expect(sideNow(sp, events)).toBe('L');
    tap(makeEvent(made, ph, sideNow(sp, events))); expect(sideNow(sp, events)).toBe('R');
    tap(missEvent('thick', ph, sideNow(sp, events))); tap(makeEvent(made, ph, sideNow(sp, events)));
    const s = summarize(sp, { events });
    expect(s.bySide.L).toEqual({ makes: 1, attempts: 2 }); expect(s.bySide.R).toEqual({ makes: 1, attempts: 2 });
    expect(s.misses.thick).toBe(1); expect(s.misses.thin).toBe(1); expect(s.qualityPct).toBeNull(); expect(requiredMakes(sp)).toBe(10);
  });
});

import { widgetRows } from '../src/widget';
describe('routine widget rows', () => {
  it('starts with the quick card, then the notes', () => {
    const rows = widgetRows(null);
    expect(rows[0]).toEqual({ k: 'h', t: 'Quick card' });
    expect(rows[1].k).toBe('q'); expect(rows[1].t.startsWith('1. ')).toBe(true);
    expect(rows.some(r => r.k === 'p' && r.t.startsWith('• '))).toBe(true);
    const edited = widgetRows({ quick: [{ title: 'Breathe', cue: 'one slow breath' }] });
    expect(edited[1]).toEqual({ k: 'q', t: '1. Breathe: one slow breath' });
  });
});
