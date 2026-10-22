import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseExport } from '../src/engine/parse';
import { mergeImport } from '../src/engine/merge';
import { DEFAULT_RULES } from '../src/engine/rules';
import { approachAngle, pocketsOf, TABLES, heatRows, fitHeatModel, buildHeatMap, chancesAt, mapPredictionFor, contour, similarPositions } from '../src/engine/heatmap';

const FX = join(__dirname, 'fixtures');
const has = existsSync(join(FX, 'all-time.csv')) && existsSync(join(FX, '2026-10-20.csv'));
const read = (f: string) => readFileSync(join(FX, f), 'utf8');

describe('approach angle (Railbird definition)', () => {
  const P = pocketsOf(TABLES['9ft']);
  const tl = P.find(p => p.name === 'top-left')!, rs = P.find(p => p.name === 'right side')!;
  it('corner: 0° along the bisector, 45° along the rail', () => {
    expect(approachAngle([20, 80], tl)).toBeCloseTo(0, 6);
    expect(approachAngle([0.0001, 60], tl)).toBeCloseTo(45, 2);
  });
  it('side: 0° square to the rail', () => {
    expect(approachAngle([30, 50], rs)).toBeCloseTo(0, 6);
    expect(approachAngle([40, 60], rs)).toBeCloseTo(45, 6);
  });
  it('X-drill diagonal sits about 18° off a corner bisector (Railbird reads ~20°)', () => {
    expect(approachAngle([10.73, 78.53], tl)).toBeCloseTo(18.4, 0);
  });
});

describe.skipIf(!has)('heat map on your data', () => {
  const a = has ? mergeImport(new Map(), parseExport(read('all-time.csv')), DEFAULT_RULES) : null;
  const b = has ? mergeImport(a!.shots, parseExport(read('2026-10-20.csv')), DEFAULT_RULES) : null;
  const rows = has ? heatRows(b!.shots.values(), b!.exclusions) : [];
  const m = has ? fitHeatModel(rows) : null;
  const h9 = has ? buildHeatMap(m!, rows, '9ft') : null;

  it('is calibrated by distance band on 9-ft tables (mean error under 2.5 points)', () => {
    const nine = rows.filter(r => r.shot.tableSize === '9ft');
    let err = 0, w = 0;
    for (const [lo, hi] of [[0, 6], [6, 12], [12, 18], [18, 24], [24, 36], [36, 48], [48, 72]]) for (const side of [false, true]) {
      const s = nine.filter(r => (r.shot.objPktIn ?? 0) >= lo && (r.shot.objPktIn ?? 0) < hi && (r.shot.pocketType === 'SIDE') === side);
      if (s.length < 40) continue;
      const act = s.reduce((x, r) => x + r.y, 0) / s.length;
      const pr = s.reduce((x, r) => x + mapPredictionFor(m!, h9!.mix, h9!.offset, r), 0) / s.length;
      err += s.length * Math.abs(act - pr); w += s.length;
    }
    expect(100 * err / w).toBeLessThan(2.5);
  });

  it('reads sensibly: 9 on the foot spot ≈ workbook (57–59%), easier near pockets', () => {
    const t = TABLES['9ft'];
    const spot = chancesAt(m!, h9!.mix, h9!.offset, t, [25, 25])[0];
    expect(spot.p).toBeGreaterThan(0.48); expect(spot.p).toBeLessThan(0.62);
    expect(['bottom-left', 'bottom-right']).toContain(spot.pocket);
    const near = chancesAt(m!, h9!.mix, h9!.offset, t, [5, 5])[0].p;
    expect(near).toBeGreaterThan(spot.p + 0.15);
    expect(h9!.values.length).toBe(h9!.cols * h9!.rows);
  });

  it('contours and similar-position counts work', () => {
    expect(contour(h9!, 0.6).length).toBeGreaterThan(10);
    const sim = similarPositions(rows, '9ft', false, 36, 20);
    expect(sim.n).toBeGreaterThan(50);
  });

  it('builds a 7-ft map with its own calibration offset', () => {
    const h7 = buildHeatMap(m!, rows, '7ft');
    expect(h7.tableShots).toBe(419);
    expect(h7.table.w).toBe(39);
    const sub = rows.filter(r => r.shot.tableSize === '7ft');
    const act = sub.reduce((x, r) => x + r.y, 0) / sub.length;
    const pr = sub.reduce((x, r) => x + mapPredictionFor(m!, h7.mix, h7.offset, r), 0) / sub.length;
    expect(Math.abs(act - pr)).toBeLessThan(0.03);
  });
});
