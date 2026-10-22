import type { Shot, SessionType, TableSize, Direction, PocketType } from './schema';
import type { Exclusions } from './rules';

export interface VariableSpec {
  id: string;
  label: string;
  unit: string;
  get: (s: Shot) => number | null;
  edges: number[];          // bin edges; values ≥ last edge go to an overflow bin
  integer?: boolean;
}

const range = (lo: number, hi: number, step: number) => {
  const out: number[] = [];
  for (let x = lo; x <= hi + 1e-9; x += step) out.push(Math.round(x * 1000) / 1000);
  return out;
};

export const VARIABLES: VariableSpec[] = [
  { id: 'cut', label: 'Cut angle', unit: '°', get: s => s.cutDeg, edges: range(0, 90, 5) },
  { id: 'objPkt', label: 'Object ball → pocket', unit: 'in', get: s => s.objPktIn, edges: range(0, 108, 6) },
  { id: 'cueObj', label: 'Cue ball → object ball', unit: 'in', get: s => s.cueObjIn, edges: range(0, 108, 6) },
  { id: 'mph', label: 'Cue ball speed', unit: 'mph', get: s => s.mph, edges: range(0, 24, 1) },
  { id: 'approach', label: 'Pocket approach angle', unit: '°', get: s => s.approachDeg, edges: range(0, 90, 5) },
  { id: 'difficulty', label: 'Railbird difficulty', unit: '', get: s => s.difficulty, edges: range(0.5, 10.5, 1), integer: true },
  { id: 'margin', label: 'Margin of error', unit: '°', get: s => s.marginDeg, edges: range(0, 10, 0.5) },
];

export interface Filter {
  from?: string;            // ISO date (inclusive)
  to?: string;              // ISO date (inclusive, end of day)
  tableSize?: TableSize | 'all';
  direction?: Direction | 'all';
  pocketType?: PocketType | 'all';
  sessionType?: SessionType | 'all';
}

export function applyFilter(shots: Iterable<Shot>, f: Filter): Shot[] {
  const out: Shot[] = [];
  const toEnd = f.to ? f.to.slice(0, 10) + 'T23:59:59.999Z' : undefined;
  for (const s of shots) {
    if (f.from && s.sessionStart < f.from) continue;
    if (toEnd && s.sessionStart > toEnd) continue;
    if (f.tableSize && f.tableSize !== 'all' && s.tableSize !== f.tableSize) continue;
    if (f.direction && f.direction !== 'all' && s.direction !== f.direction) continue;
    if (f.pocketType && f.pocketType !== 'all' && s.pocketType !== f.pocketType) continue;
    if (f.sessionType && f.sessionType !== 'all' && s.sessionType !== f.sessionType) continue;
    out.push(s);
  }
  return out;
}

export interface Bin {
  lo: number;
  hi: number | null;        // null = overflow bin
  label: string;
  all: number;              // every stored shot in the bin
  valid: number;            // shots that pass the rules
  makes: number;            // makes among valid
  retained: number | null;  // valid / all
  makeRate: number | null;  // makes / valid
}

export interface Histogram {
  variable: VariableSpec;
  bins: Bin[];
  missing: { all: number; valid: number };   // shots with no value for this variable
  totals: { all: number; valid: number; makes: number };
  quantiles: { p10: number; p50: number; p90: number } | null;   // of valid shots
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q, b = Math.floor(pos), r = pos - b;
  return sorted[b + 1] !== undefined ? sorted[b] + r * (sorted[b + 1] - sorted[b]) : sorted[b];
}

export function histogram(shots: Shot[], ex: Exclusions, v: VariableSpec): Histogram {
  const e = v.edges;
  const fmt = (x: number) => (v.integer ? String(Math.round(x + 0.5)) : String(x));
  const bins: Bin[] = [];
  for (let i = 0; i < e.length - 1; i++)
    bins.push({ lo: e[i], hi: e[i + 1], label: v.integer ? fmt(e[i]) : `${e[i]}–${e[i + 1]}`, all: 0, valid: 0, makes: 0, retained: null, makeRate: null });
  bins.push({ lo: e[e.length - 1], hi: null, label: `≥${e[e.length - 1]}`, all: 0, valid: 0, makes: 0, retained: null, makeRate: null });

  const missing = { all: 0, valid: 0 };
  const totals = { all: 0, valid: 0, makes: 0 };
  const vals: number[] = [];
  for (const s of shots) {
    const x = v.get(s);
    const ok = !ex.has(s.shotId);
    totals.all++; if (ok) { totals.valid++; if (s.make) totals.makes++; }
    if (x == null) { missing.all++; if (ok) missing.valid++; continue; }
    let i = e.findIndex((edge, k) => k < e.length - 1 && x >= edge && x < e[k + 1]);
    if (i < 0) i = x < e[0] ? 0 : bins.length - 1;
    const b = bins[i];
    b.all++;
    if (ok) { b.valid++; if (s.make) b.makes++; vals.push(x); }
  }
  for (const b of bins) {
    b.retained = b.all ? b.valid / b.all : null;
    b.makeRate = b.valid ? b.makes / b.valid : null;
  }
  // Drop an empty overflow bin so charts don't carry a useless bar.
  if (bins[bins.length - 1].all === 0) bins.pop();
  vals.sort((a, b) => a - b);
  const quantiles = vals.length ? { p10: quantile(vals, 0.1), p50: quantile(vals, 0.5), p90: quantile(vals, 0.9) } : null;
  return { variable: v, bins, missing, totals, quantiles };
}

/** Wilson 95% interval for a proportion — used wherever a make rate is shown. */
export function wilson(k: number, n: number, z = 1.96): [number, number] | null {
  if (!n) return null;
  const p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
