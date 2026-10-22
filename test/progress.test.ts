import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseExport } from '../src/engine/parse';
import { mergeImport } from '../src/engine/merge';
import { DEFAULT_RULES } from '../src/engine/rules';
import { modelRows } from '../src/engine/model';
import { BUILTIN_DRILLS } from '../src/engine/drills';
import type { TallySession } from '../src/engine/tally';
import {
  windowStat, fitBaseline, latestStart, sessionPoints, periodSummary, progressNow, suggestedPins, segmentMeter, segmentByLabel,
  drillMeters, drillShotSessions, timelineNotes, rollingSeries, type SessionPoint,
} from '../src/engine/progress';

const FX = join(__dirname, 'fixtures');
const has = existsSync(join(FX, 'all-time.csv')) && existsSync(join(FX, '2026-10-20.csv'));
const read = (f: string) => readFileSync(join(FX, f), 'utf8');

describe('window statistics', () => {
  it('pools sessions and clusters the standard error by session', () => {
    const pts: SessionPoint[] = [
      { sessionId: 1, start: '2026-01-01', name: '', sessionType: '', n: 10, made: 8, expected: 6 },
      { sessionId: 2, start: '2026-01-02', name: '', sessionType: '', n: 30, made: 18, expected: 18 },
    ];
    const w = windowStat(pts)!;
    expect(w.oe).toBeCloseTo(2 / 40, 12);
    // residuals per session minus n·oe: 2 − 0.5 = 1.5, 0 − 1.5 = −1.5 → ss = 4.5; G/(G−1) = 2
    expect(w.se).toBeCloseTo(Math.sqrt(2 * 4.5) / 40, 12);
    expect(windowStat([pts[0]])!.se).toBeNaN();
    expect(windowStat([])).toBeNull();
  });
});

describe('timeline notes', () => {
  it('merges tally notes and numbers everything by date', () => {
    const t = { id: 'x', drillId: 'transitions-1', drillName: 'Transitions-1', device: 'd', started: '2026-10-05T18:00:00Z', updated: '', events: [], note: 'less follow on 3→4' } as TallySession;
    const n = timelineNotes([{ id: 'a', date: '2026-10-10', text: 'new tip', kind: 'equipment' }, { id: 'b', date: '2026-09-01', text: 'bridge', kind: 'technique' }], [t]);
    expect(n.map(x => x.n)).toEqual([1, 2, 3]);
    expect(n.map(x => x.text)).toEqual(['bridge', 'less follow on 3→4', 'new tip']);
    expect(n[1].fromTally).toBe('Transitions-1');
  });
});

describe.skipIf(!has)('progress on your data', () => {
  const a = has ? mergeImport(new Map(), parseExport(read('all-time.csv')), DEFAULT_RULES) : null;
  const b = has ? mergeImport(a!.shots, parseExport(read('2026-10-20.csv')), DEFAULT_RULES) : null;
  const rows = has ? modelRows(b!.shots.values(), b!.exclusions) : [];

  it('a baseline on everything so far averages zero, and stays frozen when new shots arrive', () => {
    const base = fitBaseline(rows, latestStart(rows));
    expect(base.n).toBe(rows.length);
    const pts = sessionPoints(base, rows);
    expect(Math.abs(periodSummary(pts, base).allTime!.oe)).toBeLessThan(1e-9);
    // a baseline frozen at the end of 2025 is unchanged by 2026 shots, and 2026 is measured out of sample
    const b25 = fitBaseline(rows, '2025-12-31T23:59:59Z');
    const b25again = fitBaseline(rows.concat(rows.filter(r => r.shot.sessionStart > '2026')), '2025-12-31T23:59:59Z');
    expect(b25again.beta).toEqual(b25.beta);
    const s25 = periodSummary(sessionPoints(b25, rows), b25);
    expect(s25.sinceFrozen!.n).toBe(rows.filter(r => r.shot.sessionStart > b25.cutoff).length);
    console.log('frozen end-2025: 2026 O−E', (100 * s25.sinceFrozen!.oe).toFixed(1), 'pts ±', (196 * s25.sinceFrozen!.se).toFixed(1));
  });

  it('summarizes recent windows against the yardstick', () => {
    const base = fitBaseline(rows, latestStart(rows));
    const pts = sessionPoints(base, rows);
    const s = periodSummary(pts, base, progressNow(pts));
    expect(s.last30!.n).toBeGreaterThan(200);
    expect(s.change).not.toBeNull();
    const roll = rollingSeries(pts, 30);
    expect(roll.length).toBe(pts.length);
    const f = (w: typeof s.last30) => w ? `${(100 * w.oe).toFixed(1)} [${(100 * w.lo).toFixed(1)}, ${(100 * w.hi).toFixed(1)}] n=${w.n}/${w.sessions}` : '—';
    console.log('last30', f(s.last30), 'last90', f(s.last90), 'prev90', f(s.prev90), 'change', (100 * s.change!.diff).toFixed(1), '±', (196 * s.change!.se).toFixed(1));
  });

  it('suggests the tangent-line weakness as a pinned segment', () => {
    const base = fitBaseline(rows, latestStart(rows));
    const pins = suggestedPins(base, rows);
    console.log('pins', JSON.stringify(pins));
    expect(pins).toContain('Center (tangent line), 20–45°');
    const m = segmentMeter(base, rows, segmentByLabel('Center (tangent line), 20–45°')!);
    expect(m.allTime!.oe).toBeLessThan(-0.05);
    expect(m.allTime!.n).toBe(973);
  });

  it('builds drill meters from Railbird sessions and tallies', () => {
    const t: TallySession = {
      id: 't1', drillId: 'transitions-1', drillName: 'Transitions-1', device: 'd', started: '2026-10-21T18:00:00Z', updated: '2026-10-21T19:00:00Z',
      events: [{ t: '', key: 'complete' }, { t: '', key: 'missed', ball: 4 }, { t: '', key: 'outOfLine', ball: 4 }, { t: '', key: 'complete' }],
    };
    const meters = drillMeters(BUILTIN_DRILLS, drillShotSessions(rows), [t]);
    const x = meters.find(m => m.drill.id === 'xdrill')!;
    expect(x.points.length).toBe(13);
    expect(x.recent!.sessions).toBe(5);
    const tr = meters.find(m => m.drill.id === 'transitions-1')!;
    expect(tr.kind).toBe('completion');
    expect(tr.points[0].value).toBe(0.5);
    expect(tr.railbird.length).toBe(4);
    expect(tr.extra.join(' ')).toMatch(/4 ball/);
    // 2 run-outs (18 of 18), a miss on the 4 (3 of 4), out of line on the 4 (3 of 3): 24 of 25
    expect(tr.extra.join(' ')).toMatch(/Tapped make rate 96%: 24 of 25 shots/);
  });
});
