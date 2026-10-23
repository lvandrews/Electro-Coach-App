import { describe, it, expect } from 'vitest';
import { BUILTIN_DRILLS } from '../src/engine/drills';
import { buildRun, plannedTotal, changeover, blockDue, defaultsFor, type RunBlock } from '../src/engine/session';
import type { Block } from '../src/engine/plan';

const blocks: Block[] = [
  { title: 'Warm up: left cuts', minutes: 5, why: '', drills: ['mirror', 'xdrill'] },
  { title: 'Tangent line', minutes: 25, why: '', drills: ['d0-tangent', 'd2-stun'], label: 'Center (tangent line), 20–45°' },
  { title: 'Side pocket', minutes: 10, why: '', drills: ['side-ladder'] },
  { title: 'Mirror', minutes: 10, why: '', drills: ['mirror'] },
  { title: 'Run-out pattern', minutes: 10, why: '', drills: ['transitions-1', 'bowling-10'] },
];
const byId = (id: string) => BUILTIN_DRILLS.find(d => d.id === id);

describe('practice session runs', () => {
  it('picks modes from the drills', () => {
    expect(defaultsFor(byId('transitions-1'))).toMatchObject({ mode: 'tap', end: 'either', unit: 'racks' });
    expect(defaultsFor(byId('mirror'))).toMatchObject({ mode: 'tap', unit: 'shots' });
    expect(defaultsFor(byId('spot'))).toMatchObject({ mode: 'tap', unit: 'makes', count: 10 });
    expect(defaultsFor(byId('side-ladder'))).toMatchObject({ mode: 'record', end: 'time' });
    expect(defaultsFor(byId('bowling-10'))).toMatchObject({ unit: 'games', count: 1 });
  });
  it('fits blocks plus changeovers into the session length, filmed blocks together', () => {
    for (const m of [30, 45, 60, 90, 120]) {
      const run = buildRun(blocks, BUILTIN_DRILLS, m);
      expect(plannedTotal(run)).toBe(m);
      expect(run.every(b => b.minutes >= 3)).toBe(true);
    }
    const run = buildRun(blocks, BUILTIN_DRILLS, 60);
    const modes = run.map(b => b.mode);
    expect(modes[0]).toBe('record');                      // warm-up stays first, filmed (mirror set has a Railbird tag), not tapped
    expect(run[run.length - 1].title).toBe('Run-out pattern');   // finisher stays last
    // the middle has its filmed blocks before the tap blocks: one trip to the stand
    expect(modes.slice(1, -1)).toEqual(['record', 'record', 'tap']);
    expect(changeover(run[0], run[1])).toBe(1);
    expect(changeover(run[2], run[3])).toBe(2);
  });
  it('ends blocks by time, count or whichever first', () => {
    const b = (end: RunBlock['end']): RunBlock => ({ title: '', why: '', drills: [], drillId: null, minutes: 10, mode: 'tap', end, count: 5, unit: 'racks' });
    expect(blockDue(b('time'), 1000, 9)).toBe(false);
    expect(blockDue(b('time'), -1, 0)).toBe(true);
    expect(blockDue(b('count'), -1, 4)).toBe(false);
    expect(blockDue(b('count'), 5000, 5)).toBe(true);
    expect(blockDue(b('either'), 5000, 5)).toBe(true);
    expect(blockDue(b('either'), -1, 0)).toBe(true);
  });
});

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseExport } from '../src/engine/parse';
import { mergeImport } from '../src/engine/merge';
import { DEFAULT_RULES } from '../src/engine/rules';
import { modelRows } from '../src/engine/model';
import { fitBaseline, latestStart } from '../src/engine/progress';
import { buildCoachSummary, DEFAULT_COACH } from '../src/engine/coach';
const FX = join(__dirname, 'fixtures');
const has = existsSync(join(FX, 'all-time.csv'));
describe.skipIf(!has)('coach summary', () => {
  it('explains the yardstick and carries targets, journal entries with numbers around them', () => {
    const a = mergeImport(new Map(), parseExport(readFileSync(join(FX, 'all-time.csv'), 'utf8')), DEFAULT_RULES);
    const rows = modelRows(a.shots.values(), a.exclusions);
    const baseline = fitBaseline(rows, latestStart(rows));
    const txt = buildCoachSummary({ ...DEFAULT_COACH, days: 365 }, { baseline, rows, notes: [{ id: 'n', date: '2026-09-05', kind: 'technique', text: 'Shorter backswing on stun' }], tallies: [], games: [], drills: BUILTIN_DRILLS, now: new Date('2026-10-21T12:00:00Z') });
    expect(txt).toMatch(/frozen/);
    expect(txt).toMatch(/Center \(tangent line\), 20–45°: \d\.\d makes lost per 100/);
    expect(txt).toMatch(/2026-09-05 \(technique\): Shorter backswing on stun \[30 days before: [+−]\d/);
    expect(txt).not.toMatch(/last 1 sessions/);
  });
});
