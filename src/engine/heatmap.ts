import type { TableSize } from './schema';
import { fitModel, inputsOf, type ModelFit, type ModelRow } from './model';
import type { Shot } from './schema';
import type { Exclusions } from './rules';

// Table heat map (workbook v13+): for each object-ball position, your chance of
// potting it into its best pocket. Distance to the pocket and approach angle come
// from the position; cut angle, cue-ball distance and speed are averaged over your
// usual shots (or the cut is fixed, if chosen). Each table size gets a calibration
// offset so the map's average matches what you actually make on that table.

export type PocketName = 'top-left' | 'top-right' | 'left side' | 'right side' | 'bottom-left' | 'bottom-right';
export interface MapPocket { name: PocketName; at: [number, number]; normal: [number, number]; side: boolean }

export interface TableDims { size: TableSize; w: number; h: number; diamond: number }
export const TABLES: Record<'9ft' | '7ft', TableDims> = {
  '9ft': { size: '9ft', w: 50, h: 100, diamond: 12.5 },
  '7ft': { size: '7ft', w: 39, h: 78, diamond: 9.75 },
};

const S2 = Math.SQRT1_2;
export function pocketsOf(t: TableDims): MapPocket[] {
  // Head rail at the top (y = h), foot rail at the bottom (y = 0), as in the drill diagrams.
  return [
    { name: 'top-left', at: [0, t.h], normal: [S2, -S2], side: false },
    { name: 'top-right', at: [t.w, t.h], normal: [-S2, -S2], side: false },
    { name: 'left side', at: [0, t.h / 2], normal: [1, 0], side: true },
    { name: 'right side', at: [t.w, t.h / 2], normal: [-1, 0], side: true },
    { name: 'bottom-left', at: [0, 0], normal: [S2, S2], side: false },
    { name: 'bottom-right', at: [t.w, 0], normal: [-S2, S2], side: false },
  ];
}

/**
 * Railbird's pocket approach angle: 0° = straight into the pocket. Corner pockets
 * are measured from their 45° bisector (a ball running down the rail is 45°);
 * side pockets from the line square to the rail.
 */
export function approachAngle(ob: [number, number], p: MapPocket): number {
  const dx = ob[0] - p.at[0], dy = ob[1] - p.at[1], d = Math.hypot(dx, dy) || 1;
  const c = (dx * p.normal[0] + dy * p.normal[1]) / d;
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

const MAX_APPROACH = { corner: 50, side: 80 };

// ---------- position model ----------
// The step 2 model's shot terms plus a richer, smooth position part, so the map stays
// calibrated across distances and approach angles (see tests).
// Distance enters as a natural cubic spline (knots at 0.3, 0.9, 1.75, 2.75 and 4.5 ft),
// corner approach angle gets a squared term, and side pockets get their own intercept
// and approach slope. Every term is smooth, so contour lines only bend sharply where
// the best pocket changes.
// Columns: 0 intercept, 1 Dop (ft), 2 Dco (ft), 3 sec−1, 4 approach/10, 5 mph, 6 mph²,
//          7 corner×(approach/10)², 8–10 spline(Dop), 11 side, 12 side×approach/10.
const KNOTS = [0.3, 0.9, 1.75, 2.75, 4.5];
const cube = (x: number) => (x > 0 ? x * x * x : 0);
/** Restricted (natural) cubic spline basis, Harrell's parameterisation. */
export function splineBasis(x: number, k = KNOTS): number[] {
  const K = k.length, s = (k[K - 1] - k[0]) ** 2, a = k[K - 2], b = k[K - 1], out: number[] = [];
  for (let j = 0; j < K - 2; j++) out.push((cube(x - k[j]) - (cube(x - a) * (b - k[j])) / (b - a) + (cube(x - b) * (a - k[j])) / (b - a)) / s);
  return out;
}
function positionTerms(d: number, a: number, sd: number): number[] {
  return [(1 - sd) * a * a, ...splineBasis(d), sd, sd * a];
}
export function heatFeatures(s: Shot): number[] | null {
  const inp = inputsOf(s); if (!inp) return null;
  const cut = Math.min(Math.max(inp.cutDeg, 0), 89);
  const d = inp.objPktIn / 12, sd = s.pocketType === 'SIDE' ? 1 : 0, a = inp.approachDeg / 10;
  return [1, d, inp.cueObjIn / 12, 1 / Math.cos((cut * Math.PI) / 180) - 1, a, inp.mph, inp.mph * inp.mph, ...positionTerms(d, a, sd)];
}
export function heatRows(shots: Iterable<Shot>, ex: Exclusions): ModelRow[] {
  const out: ModelRow[] = [];
  for (const s of shots) { if (ex.has(s.shotId)) continue; const x = heatFeatures(s); if (x && s.make != null) out.push({ shot: s, x, y: s.make ? 1 : 0 }); }
  return out;
}
const positionLogit = (b: number[], distIn: number, appr: number, side: boolean) => {
  const d = distIn / 12, a = appr / 10, t = positionTerms(d, a, side ? 1 : 0);
  let z = b[0] + b[1] * d + b[4] * a;
  for (let k = 0; k < t.length; k++) z += b[7 + k] * t[k];
  return z;
};
export const fitHeatModel = (rows: ModelRow[]) => fitModel(rows);
const BALL_R = 1.125;

export type CutChoice = 'usual' | 10 | 30 | 45 | 60;

/** Logit contributions of cue-ball distance, cut and speed, compressed to quantiles. */
function shotMix(m: ModelFit, rows: ModelRow[], cut: CutChoice, q = 160): number[] {
  const b = m.beta;
  const fixedSec = cut === 'usual' ? null : 1 / Math.cos((cut * Math.PI) / 180) - 1;
  const vals = rows.map(r => b[2] * r.x[2] + b[3] * (fixedSec ?? r.x[3]) + b[5] * r.x[5] + b[6] * r.x[6]);
  vals.sort((x, y) => x - y);
  if (vals.length <= q) return vals;
  return Array.from({ length: q }, (_, i) => vals[Math.floor(((i + 0.5) * vals.length) / q)]);
}

const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

/** Intercept shift that makes the model's mean prediction equal the actual make rate on one table size. */
export function tableOffset(m: ModelFit, rows: ModelRow[], size: TableSize): { offset: number; n: number } {
  const sub = rows.filter(r => r.shot.tableSize === size);
  if (sub.length < 100) return { offset: 0, n: sub.length };
  const z = sub.map(r => r.x.reduce((s, v, i) => s + v * m.beta[i], 0));
  const y = sub.reduce((s, r) => s + r.y, 0);
  let d = 0;
  for (let it = 0; it < 30; it++) {
    let g = y, h = 0;
    for (const zi of z) { const p = sigmoid(zi + d); g -= p; h += p * (1 - p); }
    const step = g / h; d += step;
    if (Math.abs(step) < 1e-9) break;
  }
  return { offset: d, n: sub.length };
}

export interface PocketChance { pocket: PocketName; p: number; distIn: number; approach: number }

/** Chance into every reachable pocket from one object-ball position, best first. */
export function chancesAt(m: ModelFit, mix: number[], offset: number, t: TableDims, ob: [number, number]): PocketChance[] {
  const out: PocketChance[] = [];
  for (const pk of pocketsOf(t)) {
    const appr = approachAngle(ob, pk);
    if (appr > (pk.side ? MAX_APPROACH.side : MAX_APPROACH.corner)) continue;
    const dist = Math.hypot(ob[0] - pk.at[0], ob[1] - pk.at[1]);
    const a = positionLogit(m.beta, dist, appr, pk.side) + offset;
    let s = 0; for (const b of mix) s += sigmoid(a + b);
    out.push({ pocket: pk.name, p: s / mix.length, distIn: dist, approach: appr });
  }
  return out.sort((a, b) => b.p - a.p);
}

export interface HeatMap {
  table: TableDims;
  cell: number;               // inches per grid cell
  cols: number;
  rows: number;
  values: Float32Array;       // best-pocket chance, row 0 = foot rail
  best: Uint8Array;           // index into pocketsOf(table)
  mix: number[];
  offset: number;
  tableShots: number;
  modelShots: number;
  mean: number;               // actual make rate on this table (the color midpoint)
}

export function buildHeatMap(m: ModelFit, rows: ModelRow[], size: '9ft' | '7ft', cut: CutChoice = 'usual'): HeatMap {
  const t = TABLES[size];
  const cell = size === '9ft' ? 1.25 : 1;
  const cols = Math.round((t.w - 2 * BALL_R) / cell) + 1, nrows = Math.round((t.h - 2 * BALL_R) / cell) + 1;
  const mix = shotMix(m, rows, cut);
  const { offset, n } = tableOffset(m, rows, size);
  const pockets = pocketsOf(t);
  const values = new Float32Array(cols * nrows), best = new Uint8Array(cols * nrows);
  for (let j = 0; j < nrows; j++) for (let i = 0; i < cols; i++) {
    const ob: [number, number] = [BALL_R + i * ((t.w - 2 * BALL_R) / (cols - 1)), BALL_R + j * ((t.h - 2 * BALL_R) / (nrows - 1))];
    const ch = chancesAt(m, mix, offset, t, ob);
    values[j * cols + i] = ch.length ? ch[0].p : 0;
    best[j * cols + i] = ch.length ? pockets.findIndex(p => p.name === ch[0].pocket) : 255;
  }
  const sub = rows.filter(r => r.shot.tableSize === size);
  const mean = sub.length ? sub.reduce((s, r) => s + r.y, 0) / sub.length : rows.reduce((s, r) => s + r.y, 0) / Math.max(1, rows.length);
  return { table: t, cell, cols, rows: nrows, values, best, mix, offset, tableShots: n, modelShots: rows.length, mean };
}

/** Grid point → table coordinates (inches). */
export function gridXY(h: HeatMap, i: number, j: number): [number, number] {
  return [BALL_R + i * ((h.table.w - 2 * BALL_R) / (h.cols - 1)), BALL_R + j * ((h.table.h - 2 * BALL_R) / (h.rows - 1))];
}

/**
 * Contour lines (marching squares) at a probability level, as line segments in
 * table inches.
 */
export function contour(h: HeatMap, level: number): [number, number][][] {
  const segs: [number, number][][] = [];
  const v = (i: number, j: number) => h.values[j * h.cols + i];
  const lerp = (a: [number, number], b: [number, number], va: number, vb: number): [number, number] => {
    const t = (level - va) / (vb - va || 1e-9);
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  };
  for (let j = 0; j < h.rows - 1; j++) for (let i = 0; i < h.cols - 1; i++) {
    const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]] as const;
    const vals = c.map(([a, b]) => v(a, b));
    const xy = c.map(([a, b]) => gridXY(h, a, b));
    let idx = 0; vals.forEach((x, k) => { if (x >= level) idx |= 1 << k; });
    if (idx === 0 || idx === 15) continue;
    const e = (k: number): [number, number] => { const a = k, b = (k + 1) % 4; return lerp(xy[a], xy[b], vals[a], vals[b]); };
    const edges: number[] = [];
    for (let k = 0; k < 4; k++) { const a = vals[k] >= level, b = vals[(k + 1) % 4] >= level; if (a !== b) edges.push(k); }
    if (edges.length === 2) segs.push([e(edges[0]), e(edges[1])]);
    else if (edges.length === 4) { segs.push([e(edges[0]), e(edges[1])]); segs.push([e(edges[2]), e(edges[3])]); }
  }
  return segs;
}

/** Your record from positions like this one: same table size and pocket type, similar distance and approach. */
export function similarPositions(rows: ModelRow[], size: TableSize, side: boolean, distIn: number, approach: number, tol = { dist: 3, approach: 10 }) {
  let n = 0, makes = 0;
  for (const r of rows) {
    const s = r.shot;
    if (s.tableSize !== size) continue;
    if ((s.pocketType === 'SIDE') !== side) continue;
    if (Math.abs((s.objPktIn ?? 999) - distIn) > tol.dist) continue;
    if (Math.abs((s.approachDeg ?? 999) - approach) > tol.approach) continue;
    n++; makes += r.y;
  }
  return { n, makes, rate: n ? makes / n : null, tol };
}

/** Rows whose session started within [from, to). */
export function rowsInPeriod(rows: ModelRow[], from?: string, to?: string) {
  return rows.filter(r => (!from || r.shot.sessionStart >= from) && (!to || r.shot.sessionStart < to));
}

/** Map-style prediction for one recorded shot (its own pocket), used to check calibration. */
export function mapPredictionFor(m: ModelFit, mix: number[], offset: number, r: ModelRow): number {
  const z = positionLogit(m.beta, (r.shot.objPktIn ?? 0), (r.shot.approachDeg ?? 0), r.shot.pocketType === 'SIDE') + offset;
  let s = 0; for (const b of mix) s += sigmoid(z + b);
  return s / mix.length;
}
