import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseExport } from '../src/engine/parse';
import { mergeImport } from '../src/engine/merge';
import { DEFAULT_RULES } from '../src/engine/rules';
import { modelRows } from '../src/engine/model';
import { BUILTIN_DRILLS } from '../src/engine/drills';
import { TRACKABLE, fitBaseline, latestStart } from '../src/engine/progress';
import { buildPlan, drillsFor, sessionBlocks } from '../src/engine/plan';

const FX = join(__dirname, 'fixtures');
const has = existsSync(join(FX, 'all-time.csv')) && existsSync(join(FX, '2026-10-20.csv'));
const read = (f: string) => readFileSync(join(FX, f), 'utf8');

describe('plan drill links', () => {
  it('only point at drills that exist', () => {
    const ids = new Set(BUILTIN_DRILLS.map(d => d.id));
    for (const s of TRACKABLE) for (const d of drillsFor(s.label)) expect(ids.has(d), `${s.label} → ${d}`).toBe(true);
  });
});

describe.skipIf(!has)('plan on your data', () => {
  const a = has ? mergeImport(new Map(), parseExport(read('all-time.csv')), DEFAULT_RULES) : null;
  const b = has ? mergeImport(a!.shots, parseExport(read('2026-10-20.csv')), DEFAULT_RULES) : null;
  const rows = has ? modelRows(b!.shots.values(), b!.exclusions) : [];
  const base = has ? fitBaseline(rows, latestStart(rows)) : null;

  it('ranks the tangent-line weakness at or near the top (all time)', () => {
    const p = buildPlan(base!, rows, 'all');
    for (const t of p.targets) console.log('T', t.label, t.tier, t.perHundred.toFixed(2), (100 * t.stat.oe).toFixed(1), t.n);
    for (const t of p.strengths) console.log('S', t.label, t.tier, t.perHundred.toFixed(2), (100 * t.stat.oe).toFixed(1), t.n);
    expect(p.targets.slice(0, 2).map(t => t.label)).toContain('Center (tangent line), 20–45°');
    expect(p.targets.every((t, i, xs) => i === 0 || xs[i - 1].perHundred >= t.perHundred)).toBe(true);
    const p12 = buildPlan(base!, rows, '365');
    console.log('12m', p12.targets.map(t => `${t.label} ${t.perHundred.toFixed(2)}`).join(' | '));
  });

  it('builds a session that adds up', () => {
    const p = buildPlan(base!, rows, 'all');
    for (const m of [30, 45, 60, 90, 120]) {
      const bl = sessionBlocks(p, [], m);
      expect(bl.reduce((s, x) => s + x.minutes, 0)).toBe(m);
      expect(bl.every(x => x.minutes >= 5)).toBe(true);
      if (m === 60) {
        console.log(bl.map(x => `${x.minutes}m ${x.title}`).join(' | '));
        const titles = bl.map(x => x.title);
        expect(titles).toContain('Center (tangent line), 20–45°');
        expect(titles).not.toContain('Right cuts, moderate 20–45°');   // mostly the same shots
        expect(titles).not.toContain('9-ball sessions');               // a session type, covered by the run-out block
      }
    }
  });
});
