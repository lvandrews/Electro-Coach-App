import { features, predict, type ModelFit, type ModelRow, type ShotInputs } from './model';

// Your own numbers next to the rules of thumb in the pre-shot routine. Rates by band
// are what you actually made; curves come from the expected-make model with the
// rest of the shot held at your typical shot, so one factor moves at a time.

export interface BandRate { label: string; lo: number; hi: number; n: number; made: number; rate: number | null; reference: string }
export interface CurvePoint { at: number; p: number; n: number }
export interface TableDiff { size: '7ft' | '9ft'; n: number; sessions: number; oe: number; lo: number; hi: number }

export interface RoutineFacts {
  typical: ShotInputs;
  typicalP: number;           // make chance for the typical shot itself
  side: BandRate[];
  cut: CurvePoint[];          // make chance by cut angle (degrees)
  objDist: CurvePoint[];      // by object ball → pocket distance (feet)
  cueDist: CurvePoint[];      // by cue ball → object ball distance (feet)
  tables: TableDiff[];
}

const MIN_RATE_N = 30;
export const enoughForRate = (b: { n: number }) => b.n >= MIN_RATE_N;

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

/** The side-pocket approach rule's bands (0° = straight in). */
export const SIDE_BANDS: Omit<BandRate, 'n' | 'made' | 'rate'>[] = [
  { label: 'Up to 45°', lo: 0, hi: 45, reference: 'fine' },
  { label: '45–55°', lo: 45, hi: 55, reference: 'available, lower percentage' },
  { label: '55–65°', lo: 55, hi: 65, reference: 'makeable but tough' },
  { label: 'Past 65°', lo: 65, hi: 181, reference: 'play elsewhere' },
];

function oeBy(fit: ModelFit, rows: ModelRow[]) {
  // Made − expected per shot, with a session-clustered standard error.
  const bySession = new Map<number, number>();
  let resid = 0;
  for (const r of rows) {
    const e = r.y - predict(fit, r.x);
    resid += e;
    bySession.set(r.shot.sessionId, (bySession.get(r.shot.sessionId) ?? 0) + e);
  }
  const N = rows.length, G = bySession.size, oe = resid / N;
  let v = 0;
  const per = new Map<number, number>();
  for (const r of rows) per.set(r.shot.sessionId, (per.get(r.shot.sessionId) ?? 0) + 1);
  for (const [s, R] of bySession) v += (R - per.get(s)! * oe) ** 2;
  const se = G > 1 ? Math.sqrt((G / (G - 1)) * v) / N : Infinity;
  return { n: N, sessions: G, oe, lo: oe - 1.96 * se, hi: oe + 1.96 * se };
}

export function routineFacts(fit: ModelFit, rows: ModelRow[]): RoutineFacts {
  const typical: ShotInputs = {
    objPktIn: median(rows.map(r => r.shot.objPktIn!)), cueObjIn: median(rows.map(r => r.shot.cueObjIn!)),
    cutDeg: median(rows.map(r => r.shot.cutDeg!)), approachDeg: median(rows.map(r => r.shot.approachDeg!)), mph: median(rows.map(r => r.shot.mph!)),
  };
  const sideRows = rows.filter(r => r.shot.pocketType === 'SIDE');
  const side = SIDE_BANDS.map(b => {
    const inB = sideRows.filter(r => (r.shot.approachDeg ?? -1) >= b.lo && (r.shot.approachDeg ?? -1) < b.hi);
    const made = inB.reduce((s, r) => s + r.y, 0);
    return { ...b, n: inB.length, made, rate: inB.length ? made / inB.length : null };
  });
  const p = (patch: Partial<ShotInputs>) => predict(fit, features({ ...typical, ...patch }));
  const count = (f: (r: ModelRow) => number, at: number, half: number) => rows.filter(r => Math.abs(f(r) - at) <= half).length;
  const cut = [0, 15, 30, 45, 60, 70, 80].map(a => ({ at: a, p: p({ cutDeg: a }), n: count(r => r.shot.cutDeg!, a, 5) }));
  const objDist = [0.5, 1, 2, 3, 4, 6].map(f => ({ at: f, p: p({ objPktIn: f * 12 }), n: count(r => r.shot.objPktIn! / 12, f, 0.25) }));
  const cueDist = [0.5, 1, 2, 3, 4, 6].map(f => ({ at: f, p: p({ cueObjIn: f * 12 }), n: count(r => r.shot.cueObjIn! / 12, f, 0.25) }));
  const tables: TableDiff[] = (['9ft', '7ft'] as const).map(size => {
    const t = rows.filter(r => r.shot.tableSize === size);
    return t.length ? { size, ...oeBy(fit, t) } : null;
  }).filter((x): x is TableDiff => !!x);
  return { typical, typicalP: p({}), side, cut, objDist, cueDist, tables };
}
