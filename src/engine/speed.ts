import { fitModel, speedCurve, type ModelRow, type ShotInputs } from './model';

// Speed profile: the speed that makes the most balls, at short, medium and long
// distances. Raw make rate by speed bin is confounded (you hit harder on harder
// shots), so each distance band gets its own fit of the expected-make model, and the
// best speed is read from the model's speed curve for that band's typical shot, with
// the shot's geometry held fixed. Nothing is reported outside the speeds you
// actually played: the curve is clipped to the middle 90% of your speeds in the band.

/** Railbird reads some shots below this speed; they are tracking glitches (make rates collapse), so they are left out. */
export const SPEED_GLITCH_MPH = 1.5;
/** Universal reference bands, always shown beside your own numbers. */
export const REF_BANDS = {
  easy: { label: 'Easy pocket speed', lo: 4, hi: 7, text: '4–7 mph' },
  firm: { label: 'Firm pocket speed', lo: 8, hi: 11, text: '8–11 mph' },
  hard: { label: 'Hard speed', lo: 12, hi: Infinity, text: '12+ mph' },
} as const;
export const REF_KEYS = ['easy', 'firm', 'hard'] as const;
export type RefBand = keyof typeof REF_BANDS;

export const DIST_BANDS = [
  { id: 'short', label: 'Short', lo: 0, hi: 3.5, note: 'under 3½ ft of total travel' },
  { id: 'medium', label: 'Medium', lo: 3.5, hi: 6, note: '3½–6 ft' },
  { id: 'long', label: 'Long', lo: 6, hi: Infinity, note: 'over 6 ft' },
] as const;
export type DistBand = (typeof DIST_BANDS)[number]['id'];

/** Total travel in feet: cue ball to object ball plus object ball to pocket. */
export const travelFt = (r: ModelRow) => ((r.shot.cueObjIn ?? 0) + (r.shot.objPktIn ?? 0)) / 12;

const MIN_BAND = 300;          // shots needed to fit a band
const MIN_COVER_N = 100;       // a reference band needs this many shots …
const MIN_COVER_SHARE = 0.1;   // … and this share of the distance band, to be judged
const TOL = 0.02;              // "sweet spot" = within 2 points of the best speed

export interface Coverage { n: number; share: number; enough: boolean; made: number }

export interface SpeedBandResult {
  id: DistBand; label: string; note: string;
  n: number;
  observed: [number, number];          // middle 90% of your speeds here
  best: number | null;                 // best speed, mph (inside the observed range)
  bestP: number | null;                // modeled make chance at the best speed, typical shot
  sweet: [number, number] | null;      // speeds within 2 points of the best, inside the observed range
  openLo: boolean; openHi: boolean;    // the sweet spot runs into the edge of what you played
  peakClear: boolean;                  // the curve clearly bends (speed² range excludes 0)
  bestRange: [number, number] | null;  // 95% range for the best speed (when the peak is clear)
  coverage: Record<RefBand, Coverage>;
  atRef: Record<RefBand, number | null>; // modeled make chance at the middle of each reference band (if covered)
  typical: ShotInputs;
}

export interface SpeedProfile { bands: SpeedBandResult[]; n: number; glitches: number }

const quantile = (s: number[], q: number) => s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))];
const median = (a: number[]) => quantile([...a].sort((x, y) => x - y), 0.5);

export function speedProfile(rows: ModelRow[]): SpeedProfile {
  const usable = rows.filter(r => r.shot.mph != null && r.shot.mph >= SPEED_GLITCH_MPH);
  const bands: SpeedBandResult[] = [];
  for (const d of DIST_BANDS) {
    const b = usable.filter(r => { const t = travelFt(r); return t >= d.lo && t < d.hi; });
    if (b.length < MIN_BAND) continue;
    const speeds = b.map(r => r.shot.mph!).sort((x, y) => x - y);
    const observed: [number, number] = [quantile(speeds, 0.05), quantile(speeds, 0.95)];
    const cover = (k: RefBand): Coverage => {
      const { lo, hi } = REF_BANDS[k];
      // "4–7 mph" means 4.0 up to (not including) 8, and so on: the bands are whole-mph labels.
      const inB = b.filter(r => r.shot.mph! >= lo && r.shot.mph! < hi + 1);
      return { n: inB.length, share: inB.length / b.length, made: inB.reduce((s, r) => s + r.y, 0), enough: inB.length >= MIN_COVER_N && inB.length / b.length >= MIN_COVER_SHARE };
    };
    const coverage = { easy: cover('easy'), firm: cover('firm'), hard: cover('hard') };
    const typical: ShotInputs = {
      objPktIn: median(b.map(r => r.shot.objPktIn!)), cueObjIn: median(b.map(r => r.shot.cueObjIn!)),
      cutDeg: median(b.map(r => r.shot.cutDeg!)), approachDeg: median(b.map(r => r.shot.approachDeg!)), mph: 0,
    };
    let fit;
    try { fit = fitModel(b); } catch { continue; }
    const c = speedCurve(fit, typical, 20, 0.25, 0);
    const inRange = c.pts.filter(p => p.mph >= observed[0] - 1e-9 && p.mph <= observed[1] + 1e-9);
    const top = inRange.reduce((a, q) => (q.p > a.p ? q : a), inRange[0]);
    const near = inRange.filter(q => q.p >= top.p - TOL);
    const b5 = fit.beta[5], b6 = fit.beta[6], v55 = fit.cov[5][5], v66 = fit.cov[6][6], v56 = fit.cov[5][6];
    const peakClear = b6 + 1.96 * Math.sqrt(v66) < 0;
    let bestRange: [number, number] | null = null;
    if (peakClear) {
      const vtx = -b5 / (2 * b6), g5 = -1 / (2 * b6), g6 = b5 / (2 * b6 * b6);
      const se = Math.sqrt(Math.max(0, g5 * g5 * v55 + 2 * g5 * g6 * v56 + g6 * g6 * v66));
      bestRange = [Math.max(observed[0], vtx - 1.96 * se), Math.min(observed[1], vtx + 1.96 * se)];
    }
    const at = (k: RefBand) => {
      if (!coverage[k].enough) return null;
      const mid = k === 'hard' ? 13.5 : (REF_BANDS[k].lo + REF_BANDS[k].hi + 1) / 2;
      return c.pts.reduce((a, q) => (Math.abs(q.mph - mid) < Math.abs(a.mph - mid) ? q : a)).p;
    };
    const sweet: [number, number] = [near[0].mph, near[near.length - 1].mph];
    bands.push({
      id: d.id, label: d.label, note: d.note, n: b.length, observed,
      best: top.mph, bestP: top.p, sweet,
      openLo: sweet[0] <= observed[0] + 0.25, openHi: sweet[1] >= observed[1] - 0.25,
      peakClear, bestRange, coverage, atRef: { easy: at('easy'), firm: at('firm'), hard: at('hard') }, typical,
    });
  }
  return { bands, n: usable.length, glitches: rows.length - usable.length };
}

/** "5.5–7" style range, rounded to the half mph. */
export const mphRange = (r: [number, number]) => {
  const h = (x: number) => (Math.round(x * 2) / 2).toString();
  return h(r[0]) === h(r[1]) ? h(r[0]) : `${h(r[0])}–${h(r[1])}`;
};
