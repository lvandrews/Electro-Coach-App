import type { Shot } from './schema';
import { predict, type ModelFit, type ModelRow } from './model';

// Strength ledger (workbook "Strengths & current form"): for each segment,
// O−E = mean(make − expected) over its kept shots, where "expected" comes from
// the geometry model. 95% CIs come from a session-clustered bootstrap. Segments
// defined by the model's own inputs (distance, cut, speed bands) are left out,
// because their O−E would measure model fit rather than skill.

export type Tier = 'Established strength' | 'Emerging strength' | 'Neutral' | 'Watch' | 'Established weakness';

export interface SegmentDef { group: string; label: string; test: (s: Shot) => boolean; condition?: boolean }

const cut = (s: Shot) => s.cutDeg ?? -1;
const inBand = (lo: number, hi: number) => (s: Shot) => cut(s) >= lo && cut(s) < hi;
const drillish = (s: Shot) => s.sessionType !== 'Free play';
const nineBall = (s: Shot) => [...s.tags, ...s.gameTypes].some(t => /9 ?ball/i.test(t));

export const SEGMENTS: SegmentDef[] = [
  ...(['LEFT', 'RIGHT'] as const).flatMap(dir => ([
    [0, 20, 'near-straight 0–20°'], [20, 45, 'moderate 20–45°'], [45, 86, 'steep 45–85°'],
  ] as const).map(([lo, hi, l]) => ({
    group: 'Cut direction × angle', label: `${dir === 'LEFT' ? 'Left' : 'Right'} cuts, ${l}`,
    test: (s: Shot) => s.direction === dir && inBand(lo, hi)(s),
  }))),
  ...(['CORNER', 'SIDE'] as const).flatMap(pk => ([
    [0, 40, 'open approach <40°'], [40, 91, 'sharp approach ≥40°'],
  ] as const).map(([lo, hi, l]) => ({
    group: 'Pocket × approach', label: `${pk === 'CORNER' ? 'Corner' : 'Side'} pocket, ${l}`,
    test: (s: Shot) => s.pocketType === pk && (s.approachDeg ?? -1) >= lo && (s.approachDeg ?? -1) < hi,
  }))),
  ...([[0, 18, 'short <18″'], [18, 30, '18–30″'], [30, 48, '30–48″'], [48, 999, 'long 48″+']] as const).map(([lo, hi, l]) => ({
    group: 'Backcuts by distance', label: `Backcuts, object→pocket ${l}`,
    test: (s: Shot) => s.backcut === true && (s.objPktIn ?? -1) >= lo && (s.objPktIn ?? -1) < hi,
  })),
  // Railbird's spin label depends on cut angle (v17): compare spin types only within cut bands.
  ...([[0, 10, '0–10°'], [10, 20, '10–20°'], [20, 45, '20–45°']] as const).flatMap(([lo, hi, l]) =>
    ([['FOLLOW', 'Follow'], ['CENTER', 'Center (tangent line)'], ['DRAW', 'Draw']] as const).map(([sp, name]) => ({
      group: 'Spin within cut bands', label: `${name}, ${l}`,
      test: (s: Shot) => s.spin === sp && inBand(lo, hi)(s),
    }))),
  { group: 'Session type', label: 'Drill sessions', test: drillish },
  { group: 'Session type', label: '9-ball sessions', test: s => !drillish(s) && nineBall(s) },
  { group: 'Session type', label: 'Other free play', test: s => !drillish(s) && !nineBall(s) },
  { group: 'Equipment', label: '9-ft tables', test: s => s.tableSize === '9ft', condition: true },
  { group: 'Equipment', label: '7-ft tables', test: s => s.tableSize === '7ft', condition: true },
  { group: 'Equipment', label: '4.125″ pockets', test: s => s.pocketSizeIn === 4.125, condition: true },
  { group: 'Equipment', label: '4.25″ pockets', test: s => s.pocketSizeIn === 4.25, condition: true },
  { group: 'Equipment', label: '4.5″ pockets', test: s => s.pocketSizeIn === 4.5, condition: true },
];

// Radar: the workbook's 10 collapsed axes.
export const RADAR_AXES: SegmentDef[] = [
  { group: 'radar', label: 'Left cuts 0–20°', test: s => s.direction === 'LEFT' && cut(s) < 20 },
  { group: 'radar', label: 'Right cuts 0–20°', test: s => s.direction === 'RIGHT' && cut(s) < 20 },
  { group: 'radar', label: 'Left cuts 20°+', test: s => s.direction === 'LEFT' && cut(s) >= 20 },
  { group: 'radar', label: 'Right cuts 20°+', test: s => s.direction === 'RIGHT' && cut(s) >= 20 },
  { group: 'radar', label: 'Backcuts <30″', test: s => s.backcut === true && (s.objPktIn ?? 0) < 30 },
  { group: 'radar', label: 'Backcuts 30″+', test: s => s.backcut === true && (s.objPktIn ?? 0) >= 30 },
  { group: 'radar', label: 'Side, open approach', test: s => s.pocketType === 'SIDE' && (s.approachDeg ?? 0) < 40 },
  { group: 'radar', label: 'Side, sharp approach', test: s => s.pocketType === 'SIDE' && (s.approachDeg ?? 0) >= 40 },
  { group: 'radar', label: 'Follow / draw', test: s => s.spin === 'FOLLOW' || s.spin === 'DRAW' },
  { group: 'radar', label: 'Center ball', test: s => s.spin === 'CENTER' },
];

export interface SegmentStat {
  group: string;
  label: string;
  condition: boolean;
  n: number;
  sessions: number;
  make: number;            // observed make rate
  expected: number;        // mean model probability
  oe: number;              // make − expected (proportion; ×100 for points)
  lo: number;
  hi: number;
  tier: Tier;
  cur: number | null;      // recency-weighted O−E (90-day half-life)
  ess: number;             // effective sample size of the recency weights
}

export const ESS_MIN = 80;
export const HALF_LIFE_DAYS = 90;

export function tierOf(oe: number, lo: number, hi: number): Tier {
  if (lo > 0) return 'Established strength';
  if (hi < 0) return 'Established weakness';
  if (oe >= 0.02) return 'Emerging strength';
  if (oe <= -0.02) return 'Watch';
  return 'Neutral';
}

/** Deterministic PRNG so CIs don't jitter between renders. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LedgerResult { segments: SegmentStat[]; radar: SegmentStat[]; overall: SegmentStat; reps: number; asOf: string }

export function buildLedger(m: ModelFit, rows: ModelRow[], opts: { reps?: number; now?: Date; seed?: number } = {}): LedgerResult {
  const reps = opts.reps ?? 2000;
  const now = (opts.now ?? new Date()).getTime();
  const defs = [...SEGMENTS, ...RADAR_AXES, { group: 'overall', label: 'All kept shots', test: () => true }];
  const S = defs.length;

  // Per-shot residual and recency weight; per-session sums for each segment.
  const sessIdx = new Map<number, number>();
  const sess: { r: Float64Array; n: Float64Array }[] = [];
  const agg = defs.map(() => ({ n: 0, y: 0, e: 0, wr: 0, w: 0, w2: 0, sessions: new Set<number>() }));
  for (const row of rows) {
    const p = predict(m, row.x), resid = row.y - p;
    const ageDays = Math.max(0, (now - Date.parse(row.shot.sessionStart)) / 86400000);
    const w = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    let si = sessIdx.get(row.shot.sessionId);
    if (si == null) { si = sess.length; sessIdx.set(row.shot.sessionId, si); sess.push({ r: new Float64Array(S), n: new Float64Array(S) }); }
    for (let d = 0; d < S; d++) {
      if (!defs[d].test(row.shot)) continue;
      const a = agg[d];
      a.n++; a.y += row.y; a.e += p; a.wr += w * resid; a.w += w; a.w2 += w * w; a.sessions.add(row.shot.sessionId);
      sess[si].r[d] += resid; sess[si].n[d] += 1;
    }
  }

  // Session-clustered bootstrap of O−E for every segment at once.
  const G = sess.length;
  const rnd = mulberry32(opts.seed ?? 42);
  const draws = defs.map(() => new Float64Array(reps));
  const sr = new Float64Array(S), sn = new Float64Array(S);
  for (let b = 0; b < reps; b++) {
    sr.fill(0); sn.fill(0);
    for (let g = 0; g < G; g++) {
      const s = sess[Math.floor(rnd() * G)];
      for (let d = 0; d < S; d++) if (s.n[d]) { sr[d] += s.r[d]; sn[d] += s.n[d]; }
    }
    for (let d = 0; d < S; d++) draws[d][b] = sn[d] ? sr[d] / sn[d] : NaN;
  }
  const pctl = (arr: Float64Array, q: number) => {
    const v = Array.from(arr).filter(Number.isFinite).sort((a, b) => a - b);
    if (!v.length) return NaN;
    const pos = (v.length - 1) * q, i = Math.floor(pos);
    return v[i] + (pos - i) * ((v[i + 1] ?? v[i]) - v[i]);
  };

  const stats: SegmentStat[] = defs.map((def, d) => {
    const a = agg[d];
    const oe = a.n ? (a.y - a.e) / a.n : 0;
    const lo = pctl(draws[d], 0.025), hi = pctl(draws[d], 0.975);
    const ess = a.w2 ? (a.w * a.w) / a.w2 : 0;
    return {
      group: def.group, label: def.label, condition: !!(def as SegmentDef).condition, n: a.n, sessions: a.sessions.size,
      make: a.n ? a.y / a.n : 0, expected: a.n ? a.e / a.n : 0, oe, lo, hi, tier: tierOf(oe, lo, hi),
      cur: a.w ? a.wr / a.w : null, ess,
    };
  });
  return {
    segments: stats.slice(0, SEGMENTS.length).filter(s => s.n >= 30),
    radar: stats.slice(SEGMENTS.length, SEGMENTS.length + RADAR_AXES.length),
    overall: stats[S - 1],
    reps, asOf: new Date(now).toISOString(),
  };
}
