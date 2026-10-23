import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_DRILLS, matchDrill, sessionLabel, newTransitionsDrill } from '../src/engine/drills';
import { POCKETS, cutAngle, bendOffTangent, cueBallPath, TABLE } from '../src/engine/table';
import { completionSummary, captureCheck, mergeTallies, parseTallyFile, makeTallyFile, diagnosticCounts, type TallySession } from '../src/engine/tally';
import { parseExport } from '../src/engine/parse';
import { mergeImport } from '../src/engine/merge';
import { evaluate, DEFAULT_RULES } from '../src/engine/rules';

const FX = join(__dirname, 'fixtures');
const has = existsSync(join(FX, 'all-time.csv')) && existsSync(join(FX, '2026-10-20.csv'));
const read = (f: string) => readFileSync(join(FX, f), 'utf8');

describe('table geometry', () => {
  it('D0 set-up is about a 35° cut (spec: ≈ 35°)', () => {
    expect(cutAngle([16.67, 37.5], [16.67, 75], POCKETS.TL)).toBeCloseTo(35.7, 0);
  });
  it('natural-roll bend matches the spec ladder (26.3°, 15.9°, 11.3°, 7.6°, 4.4°)', () => {
    const ob: [number, number] = [12.5, 75];
    const cbs: [number, number][] = [[39.58, 55.77], [43.15, 63.11], [44.42, 68.40], [44.74, 73.84], [44.12, 79.25]];
    const want = [26.3, 15.9, 11.3, 7.6, 4.4];
    cbs.forEach((c, i) => expect(bendOffTangent(c, ob, POCKETS.TL, 1)).toBeCloseTo(want[i], 0));
  });
  it('cue-ball paths stay on the table and stun follows the tangent line', () => {
    const p = cueBallPath([16.67, 37.5], [16.67, 75], POCKETS.TL, { spin: 0, mph: 7 });
    for (const [x, y] of p) { expect(x).toBeGreaterThanOrEqual(TABLE.ballR - 1e-6); expect(x).toBeLessThanOrEqual(TABLE.w - TABLE.ballR + 1e-6); expect(y).toBeLessThanOrEqual(TABLE.h - TABLE.ballR + 1e-6); }
    const end = p[p.length - 1];
    expect(end[0]).toBeCloseTo(TABLE.w - TABLE.ballR, 1);   // reaches the right long rail
    expect(end[1]).toBeGreaterThan(88); expect(end[1]).toBeLessThan(98);   // ~6″ short of the corner
  });
});

describe('drill matching', () => {
  const m = (tags: string[], gt: string[] = []) => matchDrill(BUILTIN_DRILLS, tags, gt, 'Afternoon Session')?.id ?? null;
  it('new tags, legacy aliases and built-in modes', () => {
    expect(m(['ec-transitions-1'])).toBe('transitions-1');
    expect(m(['1', '9 ball practice', 'freeplay', 'pool kata bassai 9 ball'])).toBe('transitions-1');
    expect(m(['1', 'abc tangent line shots', 'diamond'])).toBe('d0-tangent');
    expect(m(['1', 'double box drill'])).toBe('double-box');
    expect(m([], ['drill', 'drillx-shot'])).toBe('xdrill');
    expect(m([], ['drillspot-shot', 'freeplay'])).toBe('spot');
    expect(m(['ec-d2-follow'])).toBe('d2-stun');
    expect(m(['1', 'freeplay', 'warm up'])).toBeNull();
    expect(sessionLabel(BUILTIN_DRILLS, ['backcuts', 'drill'], [], '')).toBe('Other drill');
  });
  it('a new Transitions drill takes the next number', () => {
    const d = newTransitionsDrill(BUILTIN_DRILLS);
    expect(d.id).toBe('transitions-2'); expect(d.tags[0].value).toBe('ec-transitions-2');
    expect(newTransitionsDrill([...BUILTIN_DRILLS, d]).id).toBe('transitions-3');
  });
});

const tally = (over: Partial<TallySession>): TallySession => ({
  id: 'x', drillId: 'd2-stun', drillName: 'D2', device: 'test', started: '2026-10-19T17:00:00-07:00', updated: '2026-10-19T18:00:00Z', events: [], ...over,
});

describe('tallies', () => {
  it('completion summary counts racks, makes and attempts', () => {
    const s = tally({ drillId: 'transitions-1', events: [
      { t: '1', key: 'complete' }, { t: '2', key: 'ended', ball: 4 }, { t: '3', key: 'complete' }, { t: '4', key: 'ended', ball: 9 },
    ] });
    expect(completionSummary(s, 9)).toMatchObject({ racks: 4, completed: 2, endedAt: [4, 9], shotsAttempted: 31, makes: 29 });
  });
  it('misses and out-of-line ends count makes and attempts differently', () => {
    const s = tally({ drillId: 'transitions-1', events: [
      { t: '1', key: 'complete' }, { t: '2', key: 'missed', ball: 4 }, { t: '3', key: 'outOfLine', ball: 4 }, { t: '4', key: 'outOfLine', ball: 7 },
    ] });
    const c = completionSummary(s, 9);
    expect(c).toMatchObject({ racks: 4, completed: 1, missedAt: [4], outOfLineAt: [4, 7] });
    expect(c.makes).toBe(9 + 3 + 3 + 6);
    expect(c.shotsAttempted).toBe(9 + 4 + 3 + 6);       // the abandoned ball is not attempted
    expect(c.ballsPerRack).toBeCloseTo(21 / 4, 10);
    expect(c.ends[3]).toEqual({ ball: 4, missed: 1, outOfLine: 1, unknown: 0 });
    expect(completionSummary([s, s], 9).racks).toBe(8);
  });
  it('learning racks (ball in hand) stay out of the stats unless asked for', () => {
    const s = tally({ drillId: 'double-box', events: [
      { t: '1', key: 'missed', ball: 3, learning: true }, { t: '2', key: 'complete', learning: true }, { t: '3', key: 'missed', ball: 6 },
    ] });
    expect(completionSummary(s, 14)).toMatchObject({ racks: 1, completed: 0, missedAt: [6], learning: 2 });
    expect(completionSummary(s, 14, 'include')).toMatchObject({ racks: 3, completed: 1 });
    expect(completionSummary(s, 14, 'only')).toMatchObject({ racks: 2, completed: 1, missedAt: [3] });
  });
  it('diagnostic counts by block and side', () => {
    const c = diagnosticCounts(tally({ events: [
      { t: '1', key: 'make', block: 'A', side: 'L' }, { t: '2', key: 'thick', block: 'A', side: 'R' }, { t: '3', key: 'make', block: 'A', side: 'R' }, { t: '4', key: 'rail', block: 'A', side: 'R' },
    ] }));
    expect(c.A.L.make).toBe(1); expect(c.A.R).toEqual({ make: 1, thick: 1, thin: 0, rail: 1, pocket: 0 });
  });
  it('merging keeps the newest copy of a session and round-trips through a file', () => {
    const a = tally({ id: 's1', updated: '2026-10-19T18:00:00Z' });
    const b = tally({ id: 's1', updated: '2026-10-19T19:00:00Z', note: 'newer' });
    const r = mergeTallies([a], [b, tally({ id: 's2' })]);
    expect(r).toMatchObject({ added: 1, updated: 1, unchanged: 0 });
    expect(r.sessions.find(s => s.id === 's1')!.note).toBe('newer');
    const f = parseTallyFile(JSON.stringify(makeTallyFile(r.sessions, 'laptop')));
    expect(f.sessions).toHaveLength(2);
    expect(() => parseTallyFile('{"app":"other"}')).toThrow();
  });
});

describe.skipIf(!has)('20 Oct export: workbook v17 and the capture check', () => {
  const all = has ? parseExport(read('all-time.csv'), 'all-time.csv') : null;
  const recent = has ? parseExport(read('2026-10-20.csv'), '2026-10-20.csv') : null;

  it('reproduces v17: 7,030 kept', () => {
    const a = mergeImport(new Map(), all!, DEFAULT_RULES);
    const b = mergeImport(a.shots, recent!, DEFAULT_RULES);
    expect(b.report.newShots).toBe(75);
    expect(b.report.validAfter).toBe(7030);
    const t = Object.fromEntries(tally2(b.exclusions).map(r => [r.id, r.flagged]));
    expect(t.cut).toBe(305); expect(t.approach).toBe(7); expect(t.duplicate).toBe(17); expect(t.fp).toBe(0);
    // v17 counts 42 breaks and 7,371 raw: its five exports lack one break shot that the
    // all-time export includes. The break is excluded either way, so kept shots agree.
    expect(t.break).toBe(43); expect(b.report.totalAfter).toBe(7372);
    expect(b.report.rulesNew.find(r => r.id === 'cut')!.flagged).toBe(2);
  });

  it('labels the 19 Oct sessions by drill', () => {
    const label = (sid: number) => recent!.shots.find(s => s.sessionId === sid)!.sessionType;
    expect(label(42220)).toBe('Tangent-line set-up');
    expect(label(42224)).toBe('Double box');
    expect(label(42225)).toBe('Transitions-1');
  });

  it('capture check compares tapped makes with Railbird by side and date', () => {
    const shots = recent!.shots;
    const ex = evaluate(shots, DEFAULT_RULES);
    const drills = BUILTIN_DRILLS.map(d => d.id === 'd2-stun' ? { ...d, aliases: [...d.aliases, 'tangent line'] } : d)
      .filter(d => d.id !== 'd0-tangent');
    const t = tally({ started: '2026-10-19T17:05:00-07:00', events: [
      ...Array.from({ length: 10 }, (_, i) => ({ t: String(i), key: 'make' as const, block: 'A', side: 'L' as const })),
      ...Array.from({ length: 10 }, (_, i) => ({ t: String(i), key: 'make' as const, block: 'A', side: 'R' as const })),
    ] });
    const [row] = captureCheck([t], shots, ex, drills);
    expect(row.railbirdSessions).toEqual([42220]);
    expect(row.tapped.makes).toBe(20);
    expect(row.bySide!.L).toMatchObject({ tapped: 10, recorded: 10 });
    expect(row.bySide!.R).toMatchObject({ tapped: 10, recorded: 5 });
    // transitions-1 on the same evening: 2 racks tapped vs the 42225 session
    const tr = tally({ id: 't', drillId: 'transitions-1', started: '2026-10-19T17:41:00-07:00', events: [{ t: '1', key: 'complete' }, { t: '2', key: 'ended', ball: 6 }] });
    const [r2] = captureCheck([tr], shots, ex, BUILTIN_DRILLS);
    expect(r2.railbirdSessions).toEqual([42225]);
    expect(r2.tapped).toEqual({ makes: 14, attempts: 15 });
    expect(r2.recorded.makes).toBe(19);
  });
});

function tally2(ex: ReturnType<typeof evaluate>) { return tally_(ex); }
import { tally as tally_ } from '../src/engine/rules';

describe('shipped layouts', () => {
  it('a copied layout snippet pastes into layouts.json as valid JSON', async () => {
    const { layoutSnippet } = await import('../src/engine/drills');
    const snip = layoutSnippet('transitions-1', { balls: [{ kind: 'cb', x: 10.123, y: 20 }, { kind: 'ob', x: 30, y: 40, num: 1 }], paths: [] });
    const parsed = JSON.parse(`{ "layouts": { ${snip} } }`);
    expect(parsed.layouts['transitions-1'].balls[0]).toEqual({ kind: 'cb', x: 10.12, y: 20 });
  });
});

describe('layout snapping', () => {
  it('snaps near-misses to spots and to one-ball-off-rail diamond positions', async () => {
    const { snapTo } = await import('../src/engine/table');
    expect(snapTo(24.2, 50.9)!.at).toEqual([25, 50]);                 // center spot
    expect(snapTo(3.9, 74.1)!.at).toEqual([3.375, 75]);               // one ball off left rail, 2nd diamond from head
    expect(snapTo(25.6, 96.2)!.at).toEqual([25, 96.625]);             // one ball off head rail, center diamond
    expect(snapTo(1.4, 25.3)!.at).toEqual([1.125, 25]);               // frozen
    expect(snapTo(18, 40)).toBeNull();                                 // open table: no snap
  });
});

describe('Transitions-1 shipped layout', () => {
  it('ships with the agreed positions', () => {
    const d = BUILTIN_DRILLS.find(x => x.id === 'transitions-1')!;
    const at = (n: number) => d.diagram!.balls.find(b => b.num === n)!;
    expect([at(1).x, at(1).y]).toEqual([46.625, 75]);
    expect([at(2).x, at(5).x, at(7).x]).toEqual([3.375, 46.625, 3.375]);
    expect([at(3).x, at(3).y]).toEqual([25, 96.625]);
    expect([at(6).x, at(6).y]).toEqual([25, 3.375]);
    expect([at(9).x, at(9).y]).toEqual([25, 50]);
    expect(d.diagram!.balls.find(b => b.kind === 'cb')).toMatchObject({ x: 25, y: 55.625 });
  });
});

describe('spot shot', () => {
  it('cue ball just behind the head string, 2½ balls off the rail; rolling path ends near the middle diamond', () => {
    const d = BUILTIN_DRILLS.find(x => x.id === 'spot')!;
    const cb = d.diagram!.balls.find(b => b.kind === 'cb')!, ob = d.diagram!.balls.find(b => b.kind === 'ob')!;
    expect([ob.x, ob.y]).toEqual([25, 25]);
    expect(cb.y).toBeGreaterThan(75); expect(cb.y).toBeLessThan(78);
    expect(cb.x).toBeCloseTo(5.625, 3);
    expect(cutAngle([cb.x, cb.y], [ob.x, ob.y], POCKETS.BR)).toBeCloseTo(25.4, 0);
    const roll = d.diagram!.paths.find(p => p.kind === 'cb')!.points;
    const end = roll[roll.length - 1];
    expect(end[1]).toBeCloseTo(100 - TABLE.ballR, 1);          // reaches the head rail
    expect(Math.abs(end[0] - 25)).toBeLessThan(4);              // near the middle diamond
  });
});
