import type { Shot } from './schema';
import type { Exclusions } from './rules';

// Expected-make model (workbook v10+): logistic regression of make on
//   object→pocket distance (ft), cue→object distance (ft), sec(cut) − 1,
//   pocket approach angle (per 10°), speed (mph) and speed².
// Fitted on every kept shot that has all inputs. Standard errors are clustered
// by session (shots within a session are not independent).

export const TERMS = ['Intercept', 'Object→pocket (per ft)', 'Cue→object (per ft)', 'sec(cut) − 1', 'Approach angle (per 10°)', 'Speed (per mph)', 'Speed² (per mph²)'] as const;

export interface ShotInputs { objPktIn: number; cueObjIn: number; cutDeg: number; approachDeg: number; mph: number }

export function features(x: ShotInputs): number[] {
  const cut = Math.min(Math.max(x.cutDeg, 0), 89);
  return [1, x.objPktIn / 12, x.cueObjIn / 12, 1 / Math.cos((cut * Math.PI) / 180) - 1, x.approachDeg / 10, x.mph, x.mph * x.mph];
}

export function inputsOf(s: Shot): ShotInputs | null {
  if (s.objPktIn == null || s.cueObjIn == null || s.cutDeg == null || s.approachDeg == null || s.mph == null || s.make == null) return null;
  return { objPktIn: s.objPktIn, cueObjIn: s.cueObjIn, cutDeg: s.cutDeg, approachDeg: s.approachDeg, mph: s.mph };
}

const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

// ---------- small dense linear algebra ----------

function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) throw new Error('model matrix is singular');
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function inverse(A: number[][]): number[][] {
  const n = A.length;
  const cols = Array.from({ length: n }, (_, j) => solve(A, Array.from({ length: n }, (_, i) => (i === j ? 1 : 0))));
  return Array.from({ length: n }, (_, i) => cols.map(c => c[i]));
}
const matmul = (A: number[][], B: number[][]) => A.map(r => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));

// ---------- fit ----------

export interface ModelFit {
  n: number;
  sessions: number;
  beta: number[];
  cov: number[][];          // cluster-robust covariance (by session)
  se: number[];
  logLik: number;
  pseudoR2: number;         // McFadden
  iterations: number;
  fittedAt: string;
  dateRange: [string, string];
}

export interface ModelRow { shot: Shot; x: number[]; y: number }

export function modelRows(shots: Iterable<Shot>, ex: Exclusions): ModelRow[] {
  const rows: ModelRow[] = [];
  for (const s of shots) {
    if (ex.has(s.shotId)) continue;
    const inp = inputsOf(s); if (!inp) continue;
    rows.push({ shot: s, x: features(inp), y: s.make ? 1 : 0 });
  }
  return rows;
}

export function fitModel(rows: ModelRow[]): ModelFit {
  if (rows.length < 50) throw new Error('need at least 50 kept shots with full geometry to fit the model');
  const k = rows[0].x.length;
  let beta = new Array(k).fill(0);
  let it = 0;
  let H: number[][] = [];
  for (; it < 50; it++) {
    const g = new Array(k).fill(0);
    H = Array.from({ length: k }, () => new Array(k).fill(0));
    for (const r of rows) {
      const p = sigmoid(r.x.reduce((s, v, i) => s + v * beta[i], 0));
      const w = p * (1 - p), e = r.y - p;
      for (let i = 0; i < k; i++) { g[i] += r.x[i] * e; for (let j = 0; j <= i; j++) H[i][j] += w * r.x[i] * r.x[j]; }
    }
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) H[i][j] = H[j][i];
    const step = solve(H, g);
    beta = beta.map((b, i) => b + step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-10) { it++; break; }
  }
  // information matrix at the final beta
  H = Array.from({ length: k }, () => new Array(k).fill(0));
  let ll = 0;
  const ybar = rows.reduce((s, r) => s + r.y, 0) / rows.length;
  const scoreBySession = new Map<number, number[]>();
  for (const r of rows) {
    const p = sigmoid(r.x.reduce((s, v, i) => s + v * beta[i], 0));
    const w = p * (1 - p), e = r.y - p;
    ll += r.y ? Math.log(p) : Math.log(1 - p);
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) H[i][j] += w * r.x[i] * r.x[j];
    const sc = scoreBySession.get(r.shot.sessionId) ?? scoreBySession.set(r.shot.sessionId, new Array(k).fill(0)).get(r.shot.sessionId)!;
    for (let i = 0; i < k; i++) sc[i] += r.x[i] * e;
  }
  const ll0 = rows.length * (ybar * Math.log(ybar) + (1 - ybar) * Math.log(1 - ybar));
  const Hinv = inverse(H);
  // Sandwich with the small-sample factor statsmodels uses for clustered logit:
  // G/(G−1) · (N−1)/(N−K).
  const G = scoreBySession.size, N = rows.length;
  const meat = Array.from({ length: k }, () => new Array(k).fill(0));
  for (const sc of scoreBySession.values()) for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) meat[i][j] += sc[i] * sc[j];
  const adj = (G / (G - 1)) * ((N - 1) / (N - k));
  const cov = matmul(matmul(Hinv, meat), Hinv).map(r => r.map(v => v * adj));
  const dates = rows.map(r => r.shot.sessionStart).filter(Boolean).sort();
  return {
    n: N, sessions: G, beta, cov, se: cov.map((r, i) => Math.sqrt(r[i])), logLik: ll, pseudoR2: 1 - ll / ll0,
    iterations: it, fittedAt: new Date().toISOString(), dateRange: [dates[0] ?? '', dates[dates.length - 1] ?? ''],
  };
}

export function predict(m: ModelFit, x: number[]): number {
  return sigmoid(x.reduce((s, v, i) => s + v * m.beta[i], 0));
}

/** Probability with a 95% interval from the coefficient covariance (delta method on the logit scale). */
export function predictCI(m: ModelFit, inp: ShotInputs): { p: number; lo: number; hi: number } {
  const x = features(inp);
  const z = x.reduce((s, v, i) => s + v * m.beta[i], 0);
  let v = 0;
  for (let i = 0; i < x.length; i++) for (let j = 0; j < x.length; j++) v += x[i] * m.cov[i][j] * x[j];
  const se = Math.sqrt(Math.max(v, 0));
  return { p: sigmoid(z), lo: sigmoid(z - 1.96 * se), hi: sigmoid(z + 1.96 * se) };
}

/** Make probability across speeds for one shot, the best speed and the band within `tol` of the peak. */
export function speedCurve(m: ModelFit, inp: ShotInputs, maxMph = 18, step = 0.25, tol = 0.02) {
  const pts: { mph: number; p: number }[] = [];
  for (let v = 0; v <= maxMph + 1e-9; v += step) pts.push({ mph: Math.round(v * 100) / 100, p: predict(m, features({ ...inp, mph: v })) });
  const best = pts.reduce((a, b) => (b.p > a.p ? b : a));
  const band = pts.filter(q => q.p >= best.p - tol);
  return { pts, best, band: [band[0].mph, band[band.length - 1].mph] as [number, number] };
}

/** Observed vs predicted make rate in equal-count bins of predicted probability. */
export function calibration(m: ModelFit, rows: ModelRow[], bins = 10) {
  const pr = rows.map(r => ({ p: predict(m, r.x), y: r.y })).sort((a, b) => a.p - b.p);
  const out: { pred: number; obs: number; n: number }[] = [];
  for (let b = 0; b < bins; b++) {
    const seg = pr.slice(Math.floor((b * pr.length) / bins), Math.floor(((b + 1) * pr.length) / bins));
    if (!seg.length) continue;
    out.push({ pred: seg.reduce((s, q) => s + q.p, 0) / seg.length, obs: seg.reduce((s, q) => s + q.y, 0) / seg.length, n: seg.length });
  }
  return out;
}

/** Your own record for shots like this one (for a reality check next to the model). */
export function similarShots(rows: ModelRow[], inp: ShotInputs, tol = { cut: 5, objPkt: 6, cueObj: 12 }) {
  let n = 0, makes = 0;
  for (const r of rows) {
    const s = r.shot;
    if (Math.abs((s.cutDeg ?? 999) - inp.cutDeg) > tol.cut) continue;
    if (Math.abs((s.objPktIn ?? 999) - inp.objPktIn) > tol.objPkt) continue;
    if (Math.abs((s.cueObjIn ?? 999) - inp.cueObjIn) > tol.cueObj) continue;
    n++; makes += r.y;
  }
  return { n, makes, rate: n ? makes / n : null, tol };
}
