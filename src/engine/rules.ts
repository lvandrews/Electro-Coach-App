import type { Shot } from './schema';

/**
 * Validity rules carried over from the analysis workbook (v15). Every rule is
 * evaluated over the WHOLE stored record after each import, so results never
 * depend on import order. Excluded shots are kept in storage — exclusion is
 * reversible by changing a threshold or switching a rule off.
 */
export interface RuleConfig {
  maxCutDeg: number;             // cut angle above this = measurement anomaly
  maxApproachDeg: number;        // pocket approach above this = detection error
  fpScoreExclude: number;        // false_positive_score at or above this is excluded
  breakMph: number;              // speed at or above this = break shot
  dupFrames: number;             // duplicate: start frame within N frames…
  dupCutDeg: number;             // …cut angle within N degrees…
  dupPktIn: number;              // …and pocket distance within N inches of an earlier shot
  geometryCheck: boolean;        // optional: distances longer than the table diagonal
  enabled: Record<RuleId, boolean>;
}

export type RuleId = 'incomplete' | 'cut' | 'approach' | 'fp' | 'break' | 'duplicate' | 'geometry';

export const DEFAULT_RULES: RuleConfig = {
  maxCutDeg: 85, maxApproachDeg: 90, fpScoreExclude: 0.5, breakMph: 18,
  dupFrames: 10, dupCutDeg: 5, dupPktIn: 3, geometryCheck: false,
  enabled: { incomplete: true, cut: true, approach: true, fp: true, break: true, duplicate: true, geometry: false },
};

export interface RuleInfo { id: RuleId; label: string; describe: (c: RuleConfig) => string; why: string }

export const RULES: RuleInfo[] = [
  { id: 'incomplete', label: 'Incomplete record',
    describe: () => 'Missing make, cut angle, cue→object or object→pocket distance',
    why: 'The shot cannot be placed in the geometry, so it cannot be modeled.' },
  { id: 'cut', label: 'Implausible cut angle',
    describe: c => `Cut angle > ${c.maxCutDeg}°`,
    why: 'Your thinnest real cuts do not exceed ~85°; the 85–90° band behaves like detection anomalies (Cut-angle audit, workbook v9).' },
  { id: 'approach', label: 'Impossible approach angle',
    describe: c => `Pocket approach angle > ${c.maxApproachDeg}°`,
    why: 'Same geometric bound on the approach angle; above 90° indicates a detection error.' },
  { id: 'fp', label: 'Railbird false-positive flag',
    describe: c => `false_positive_score ≥ ${c.fpScoreExclude}`,
    why: "Railbird developer's default QC threshold." },
  { id: 'break', label: 'Break shot',
    describe: c => `Speed ≥ ${c.breakMph} mph`,
    why: 'Breaks are very fast with rack-to-pocket geometry and often read as >90° cuts. 18 mph separates breaks from genuine power shots; 15 mph changes no result.' },
  { id: 'duplicate', label: 'Duplicate record',
    describe: c => `Same session, start frame within ${c.dupFrames} frames, cut within ${c.dupCutDeg}° and pocket distance within ${c.dupPktIn}″ of an earlier shot`,
    why: 'Railbird sometimes logs a shot twice with a new ID a few seconds later. The first copy is kept.' },
  { id: 'geometry', label: 'Distance beyond table (optional)',
    describe: () => 'Cue→object or object→pocket distance longer than the table diagonal',
    why: 'Physically impossible for the recorded table size; usually a mislabeled table or a tracking error. Off by default to match the workbook.' },
];

export type Exclusions = Map<number, RuleId[]>;

export function tableDiagonalIn(s: Shot): number | null {
  if (s.tableLengthIn == null) return null;
  return Math.hypot(s.tableLengthIn, s.tableLengthIn / 2);
}

/** Returns shotId → list of rules the shot fails. Shots not in the map are valid. */
export function evaluate(shots: Shot[], cfg: RuleConfig = DEFAULT_RULES): Exclusions {
  const ex: Exclusions = new Map();
  const add = (id: number, r: RuleId) => {
    if (!cfg.enabled[r]) return;
    const a = ex.get(id); if (a) a.push(r); else ex.set(id, [r]);
  };

  for (const s of shots) {
    if (s.make == null || s.cutDeg == null || s.cueObjIn == null || s.objPktIn == null) add(s.shotId, 'incomplete');
    if (s.cutDeg != null && s.cutDeg > cfg.maxCutDeg) add(s.shotId, 'cut');
    if (s.approachDeg != null && s.approachDeg > cfg.maxApproachDeg) add(s.shotId, 'approach');
    if (s.fpScore != null && s.fpScore >= cfg.fpScoreExclude) add(s.shotId, 'fp');
    if (s.mph != null && s.mph >= cfg.breakMph) add(s.shotId, 'break');
    const diag = tableDiagonalIn(s);
    if (diag != null && ((s.cueObjIn ?? 0) > diag || (s.objPktIn ?? 0) > diag)) add(s.shotId, 'geometry');
  }

  // Duplicates: within a session, ordered by creation time, a shot matching an
  // earlier non-duplicate shot is flagged.
  const bySession = new Map<number, Shot[]>();
  for (const s of shots) {
    const a = bySession.get(s.sessionId); if (a) a.push(s); else bySession.set(s.sessionId, [s]);
  }
  for (const list of bySession.values()) {
    list.sort((a, b) => (a.shotCreated < b.shotCreated ? -1 : a.shotCreated > b.shotCreated ? 1 : a.shotId - b.shotId));
    const kept: Shot[] = [];
    for (const s of list) {
      const twin = kept.find(k =>
        k.startFrame != null && s.startFrame != null && Math.abs(k.startFrame - s.startFrame) <= cfg.dupFrames &&
        k.cutDeg != null && s.cutDeg != null && Math.abs(k.cutDeg - s.cutDeg) <= cfg.dupCutDeg &&
        k.objPktIn != null && s.objPktIn != null && Math.abs(k.objPktIn - s.objPktIn) <= cfg.dupPktIn);
      if (twin) add(s.shotId, 'duplicate'); else kept.push(s);
    }
  }
  return ex;
}

export interface RuleTally { id: RuleId; flagged: number; only: number }

/** Per-rule counts, including how many shots each rule removes on its own. */
export function tally(ex: Exclusions, subset?: Set<number>): RuleTally[] {
  const t = new Map<RuleId, RuleTally>();
  for (const r of RULES) t.set(r.id, { id: r.id, flagged: 0, only: 0 });
  for (const [id, rs] of ex) {
    if (subset && !subset.has(id)) continue;
    for (const r of rs) t.get(r)!.flagged++;
    if (rs.length === 1) t.get(rs[0])!.only++;
  }
  return [...t.values()];
}
