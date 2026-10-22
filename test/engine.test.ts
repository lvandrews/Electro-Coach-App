import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseExport, toNumber, toBool, toIsoDate } from '../src/engine/parse';
import { evaluate, tally, DEFAULT_RULES } from '../src/engine/rules';
import { mergeImport } from '../src/engine/merge';
import { histogram, VARIABLES, wilson } from '../src/engine/distributions';
import { summarizeSessions } from '../src/engine/sessions';
import type { Shot } from '../src/engine/schema';

// Fixtures are personal data and are git-ignored; these tests skip if absent.
const FX = join(__dirname, 'fixtures');
const has = existsSync(join(FX, 'all-time.csv'));
const read = (f: string) => readFileSync(join(FX, f), 'utf8');

describe('value coercion', () => {
  it('numbers tolerate units, separators and blanks', () => {
    expect(toNumber('12.5')).toBe(12.5);
    expect(toNumber(' 1,234.5 ')).toBe(1234.5);
    expect(toNumber('42 mph')).toBe(42);
    expect(toNumber('30°')).toBe(30);
    expect(toNumber('18"')).toBe(18);
    expect(toNumber('')).toBeNull();
    expect(toNumber('NaN')).toBeNull();
    expect(toNumber('—')).toBeNull();
    expect(toNumber('abc')).toBe('bad');
  });
  it('booleans accept common spellings', () => {
    expect(toBool('true')).toBe(true);
    expect(toBool('FALSE')).toBe(false);
    expect(toBool('1')).toBe(true);
    expect(toBool('maybe')).toBe('bad');
  });
  it('naive timestamps are treated as UTC; microseconds trimmed', () => {
    expect(toIsoDate('2026-10-16T21:53:25.432153')).toBe('2026-10-16T21:53:25.432Z');
    expect(toIsoDate('2026-10-16T21:47:23.670717+00:00')).toBe('2026-10-16T21:47:23.670Z');
  });
});

describe('speed units', () => {
  const hdr = 'session_id,shot_id,make,cue_object_angle_degrees,cue_object_distance_inches,target_pocket_distance_inches';
  it('inches/second converts at 17.6 per mph', () => {
    const r = parseExport(`${hdr},cue_ball_speed_inches_per_second\n1,1,true,10,20,30,176`);
    expect(r.shots[0].mph).toBeCloseTo(10, 9);
    expect(r.speedSource).toMatch(/inches\/second/);
  });
  it('an mph column is used directly and stored as inches/second', () => {
    const r = parseExport(`${hdr},cue_ball_speed_mph\n1,1,true,10,20,30,7.5`);
    expect(r.shots[0].mph).toBeCloseTo(7.5, 9);
    expect(r.shots[0].speedIps).toBeCloseTo(132, 9);
  });
  it('no speed column: shots import, speed is null, nothing crashes', () => {
    const r = parseExport(`${hdr}\n1,1,true,10,20,30`);
    expect(r.shots[0].mph).toBeNull();
    expect(r.speedSource).toBeNull();
  });
  it('missing a required column refuses the import', () => {
    const r = parseExport('session_id,shot_id\n1,1');
    expect(r.missingRequired).toContain('make');
    expect(r.shots).toHaveLength(0);
  });
  it('bad numeric values are reported with examples', () => {
    const r = parseExport(`${hdr}\n1,1,true,ten,20,30\n1,2,true,12,20,30`);
    expect(r.issues[0]).toMatchObject({ column: 'cue_object_angle_degrees', count: 1, examples: ['ten'] });
    expect(r.incomplete).toBe(1);
  });
});

describe.skipIf(!has)('real exports reproduce the workbook (v15) cleaning', () => {
  const ref = has ? JSON.parse(read('reference.json')) : null;
  const all = has ? parseExport(read('all-time.csv'), 'all-time.csv') : null;

  it('parses every row with no coercion problems', () => {
    expect(all!.rowsRead).toBe(ref.raw);
    expect(all!.shots).toHaveLength(ref.raw);
    expect(all!.issues).toEqual([]);
    expect(all!.missingRequired).toEqual([]);
    expect(all!.unknownColumns).toEqual([]);
  });

  it('flags match the reference rule by rule', () => {
    const ex = evaluate(all!.shots, DEFAULT_RULES);
    const t = Object.fromEntries(tally(ex).map(r => [r.id, r.flagged]));
    expect(t.cut).toBe(ref.flags.cut85);
    expect(t.approach).toBe(ref.flags.pkt);
    expect(t.fp).toBe(ref.flags.fp);
    expect(t.break).toBe(ref.flags.brk);
    expect(t.duplicate).toBe(ref.flags.dup);
    expect(all!.shots.length - ex.size).toBe(ref.valid);
    const dupIds = [...ex].filter(([, r]) => r.includes('duplicate')).map(([id]) => id).sort((a, b) => a - b);
    expect(dupIds).toEqual([...ref.dup_ids].sort((a: number, b: number) => a - b));
    const valid = all!.shots.filter(s => !ex.has(s.shotId));
    expect(valid.filter(s => s.make).length / valid.length).toBeCloseTo(ref.make_clean, 10);
  });

  it('merging is order-independent and idempotent', () => {
    const recent = parseExport(read('2026-10-18.csv'), '2026-10-18.csv');
    const a = mergeImport(new Map(), recent, DEFAULT_RULES);
    expect(a.report.newShots).toBe(115);
    expect(a.report.rulesNew.find(r => r.id === 'duplicate')!.flagged).toBe(17);
    const b = mergeImport(a.shots, all!, DEFAULT_RULES);
    expect(b.report.newShots).toBe(ref.raw - 115);
    expect(b.report.unchangedShots).toBe(115);
    expect(b.report.validAfter).toBe(ref.valid);
    const c = mergeImport(b.shots, all!, DEFAULT_RULES);
    expect(c.report.newShots).toBe(0);
    expect(c.report.updatedShots).toBe(0);
    expect(c.report.validAfter).toBe(ref.valid);
  });

  it('histograms conserve shot counts', () => {
    const ex = evaluate(all!.shots, DEFAULT_RULES);
    for (const v of VARIABLES) {
      const h = histogram(all!.shots, ex, v);
      const sumAll = h.bins.reduce((s, b) => s + b.all, 0) + h.missing.all;
      const sumValid = h.bins.reduce((s, b) => s + b.valid, 0) + h.missing.valid;
      expect(sumAll).toBe(ref.raw);
      expect(sumValid).toBe(ref.valid);
    }
  });

  it('session summaries cover every shot', () => {
    const ex = evaluate(all!.shots, DEFAULT_RULES);
    const ss = summarizeSessions(all!.shots, ex);
    expect(ss.reduce((s, r) => s + r.shots, 0)).toBe(ref.raw);
    expect(ss.reduce((s, r) => s + r.valid, 0)).toBe(ref.valid);
    const kata = all!.shots.filter((s: Shot) => s.sessionType === 'Transitions-1');
    expect(kata.length).toBeGreaterThan(0); // kata sessions now map to Transitions-1
  });
});

describe('wilson interval', () => {
  it('brackets the proportion', () => {
    const [lo, hi] = wilson(65, 100)!;
    expect(lo).toBeLessThan(0.65); expect(hi).toBeGreaterThan(0.65);
    expect(lo).toBeCloseTo(0.5525, 3);
  });
});
