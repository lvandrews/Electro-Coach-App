import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseExport } from '../src/engine/parse';
import { evaluate, DEFAULT_RULES } from '../src/engine/rules';
import { fitModel, modelRows } from '../src/engine/model';
import { speedProfile, SPEED_GLITCH_MPH, mphRange } from '../src/engine/speed';
import { routineFacts } from '../src/engine/facts';

const FX = join(__dirname, 'fixtures');
const has = existsSync(join(FX, 'all-time.csv'));

describe('mph ranges', () => {
  it('round to the half mph', () => { expect(mphRange([4.6, 7.1])).toBe('4.5–7'); expect(mphRange([5, 5.1])).toBe('5'); });
});

describe.skipIf(!has)('speed profile and routine facts on the all-time export', () => {
  const r = has ? parseExport(readFileSync(join(FX, 'all-time.csv'), 'utf8')) : null;
  const rows = r ? modelRows(r.shots, evaluate(r.shots, DEFAULT_RULES)) : [];
  it('finds a faster best speed for longer shots, inside the speeds actually played', () => {
    const p = speedProfile(rows);
    expect(p.glitches).toBe(rows.filter(x => x.shot.mph! < SPEED_GLITCH_MPH).length);
    expect(p.bands.map(b => b.id)).toEqual(['short', 'medium', 'long']);
    const [s, m, l] = p.bands;
    expect(s.best!).toBeLessThan(m.best!); expect(m.best!).toBeLessThan(l.best!);
    for (const b of p.bands) { expect(b.sweet![0]).toBeGreaterThanOrEqual(b.observed[0]); expect(b.sweet![1]).toBeLessThanOrEqual(b.observed[1]); }
    expect(s.coverage.firm.enough).toBe(false);          // few firm shots at short range: not judged
    expect(s.atRef.firm).toBeNull();
  });
  it('routine facts: distance and cut lower the make chance', () => {
    const f = routineFacts(fitModel(rows), rows);
    expect(f.objDist[0].p).toBeGreaterThan(f.objDist[f.objDist.length - 1].p);
    expect(f.cut[0].p).toBeGreaterThan(f.cut[f.cut.length - 1].p);
    expect(f.side.reduce((s, b) => s + b.n, 0)).toBe(rows.filter(x => x.shot.pocketType === 'SIDE').length);
    expect(f.tables.map(t => t.size).sort()).toEqual(['7ft', '9ft']);
  });
});

import { bestShots, wilsonLo } from '../src/engine/best';
describe('best shots', () => {
  it('Wilson lower bound favors a long record over a short streak', () => {
    expect(wilsonLo(9, 10)).toBeLessThan(wilsonLo(85, 100));
  });
  it.skipIf(!has)('finds reliable non-hanger shots with enough sessions', () => {
    const r = parseExport(readFileSync(join(FX, 'all-time.csv'), 'utf8'));
    const best = bestShots(modelRows(r.shots, evaluate(r.shots, DEFAULT_RULES)), 3);
    expect(best.length).toBe(3);
    for (const b of best) { expect(b.n).toBeGreaterThanOrEqual(30); expect(b.sessions).toBeGreaterThanOrEqual(5); expect(b.objDist.lo).toBeGreaterThanOrEqual(1); }
    expect(best[0].lo).toBeGreaterThanOrEqual(best[1].lo);
  });
});
