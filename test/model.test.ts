import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseExport } from '../src/engine/parse';
import { mergeImport } from '../src/engine/merge';
import { DEFAULT_RULES } from '../src/engine/rules';
import { modelRows, fitModel, predictCI, speedCurve, calibration, features, type ModelRow } from '../src/engine/model';
import { buildLedger, tierOf } from '../src/engine/ledger';
import type { Shot } from '../src/engine/schema';

const FX = join(__dirname, 'fixtures');
const has = existsSync(join(FX, 'all-time.csv')) && existsSync(join(FX, '2026-10-20.csv'));
const read = (f: string) => readFileSync(join(FX, f), 'utf8');

describe('logistic fit on synthetic data', () => {
  it('recovers known coefficients', () => {
    // y ~ Bernoulli(sigmoid(1.0 − 0.3·Dop)), deterministic pseudo-random draws
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const rows: ModelRow[] = [];
    for (let i = 0; i < 20000; i++) {
      const inp = { objPktIn: 12 + rnd() * 48, cueObjIn: 6 + rnd() * 60, cutDeg: rnd() * 60, approachDeg: rnd() * 60, mph: 2 + rnd() * 10 };
      const x = features(inp);
      const p = 1 / (1 + Math.exp(-(1.0 - 0.3 * x[1])));
      rows.push({ shot: { sessionId: i % 200, sessionStart: '2026-01-01T00:00:00Z' } as Shot, x, y: rnd() < p ? 1 : 0 });
    }
    const m = fitModel(rows);
    expect(m.beta[1]).toBeCloseTo(-0.3, 1);
    expect(Math.abs(m.beta[2])).toBeLessThan(0.05);
  });
  it('tiers follow the workbook rule', () => {
    expect(tierOf(0.05, 0.01, 0.09)).toBe('Established strength');
    expect(tierOf(-0.05, -0.09, -0.01)).toBe('Established weakness');
    expect(tierOf(0.03, -0.01, 0.07)).toBe('Emerging strength');
    expect(tierOf(-0.03, -0.07, 0.01)).toBe('Watch');
    expect(tierOf(0.01, -0.03, 0.05)).toBe('Neutral');
  });
});

describe.skipIf(!has)('model and ledger on your data (cross-checked with statsmodels and the workbook)', () => {
  const a = has ? mergeImport(new Map(), parseExport(read('all-time.csv')), DEFAULT_RULES) : null;
  const b = has ? mergeImport(a!.shots, parseExport(read('2026-10-20.csv')), DEFAULT_RULES) : null;
  const rows = has ? modelRows(b!.shots.values(), b!.exclusions) : [];
  const m = has ? fitModel(rows) : null;

  it('matches statsmodels Logit with session-clustered SEs', () => {
    // statsmodels 0.15: y ~ Dop+Dco+sec+inc+spd+I(spd**2), cov_type="cluster"
    const want = [1.482939, -0.332356, -0.185135, -0.524897, -0.011966, 0.171797, -0.010385];
    const se = [0.184445, 0.037238, 0.024723, 0.111636, 0.023240, 0.035107, 0.002173];
    expect(m!.n).toBe(7030); expect(m!.sessions).toBe(146);
    want.forEach((w, i) => expect(m!.beta[i]).toBeCloseTo(w, 5));
    se.forEach((w, i) => expect(m!.se[i]).toBeCloseTo(w, 5));
    expect(m!.pseudoR2).toBeCloseTo(0.04967, 4);
  });

  it('reproduces the v17 tangent-line finding: center ball at 20–45° ≈ −8.4 pts on 973 shots', () => {
    const L = buildLedger(m!, rows, { now: new Date('2026-10-21T12:00:00Z'), reps: 500 });
    const c = L.segments.find(s => s.label === 'Center (tangent line), 20–45°')!;
    expect(c.n).toBe(973);
    expect(100 * c.oe).toBeCloseTo(-8.36, 1);
    expect(c.tier).toBe('Established weakness');
    const ln = L.segments.find(s => s.label === 'Left cuts, near-straight 0–20°')!;
    expect(100 * ln.oe).toBeCloseTo(6.38, 1);
    expect(Math.abs(L.overall.oe)).toBeLessThan(1e-9);   // logistic fit: residuals sum to zero
  });

  it('predictor, speed curve and calibration behave', () => {
    const p = predictCI(m!, { objPktIn: 24, cueObjIn: 36, cutDeg: 30, approachDeg: 20, mph: 6 });
    expect(p.lo).toBeLessThan(p.p); expect(p.hi).toBeGreaterThan(p.p);
    const sc = speedCurve(m!, { objPktIn: 24, cueObjIn: 36, cutDeg: 30, approachDeg: 20, mph: 6 });
    expect(sc.best.mph).toBeCloseTo(0.171797 / (2 * 0.010385), 0);   // vertex of the quadratic
    const cal = calibration(m!, rows);
    expect(cal).toHaveLength(10);
    for (const c of cal) expect(Math.abs(c.obs - c.pred)).toBeLessThan(0.08);
  });
});
