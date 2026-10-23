// Progressive tap drills (the stroke drills, and the plain tap drills that share their
// screen): each shot is tapped as one outcome. Misses are repeated until made, so a
// completion is a fixed number of makes; make % = makes ÷ attempts and quality % =
// quality results ÷ makes. Progressive drills have three levels with Lela's rules:
//   move up   = two completions in a row at the level with ≥ 80% makes AND ≥ 70% quality
//   move down = two completions in a row that are poor: < 70% makes OR < 50% quality
// One bad day never demotes. Thresholds are adjustable per drill.

import type { DiagramSpec, Side } from './drills';
import type { TallyEvent, TallySession } from './tally';

export type MissKind = 'lr' | 'thickthin';
export type MissDir = 'L' | 'R' | 'thick' | 'thin' | '?';

export interface MakeOutcome {
  id: string;
  label: string;
  quality?: 'good' | 'best';   // counts toward quality %; 'best' is also shown on its own
  drift?: Side;                // stop shots: the cue ball drifted left or right
  spin?: Side;                 // basic stop shots: spinning in place
}
export interface ProgPhase { id: string; name: string; makes: number; outcomes: MakeOutcome[] }
export interface ProgLevel { label: string; cue: string; diagram: DiagramSpec | null }

export interface ProgSpec {
  progressive: boolean;        // false: one "level", no promotion (still fully diagnosed)
  levels: ProgLevel[];
  phases: ProgPhase[];
  missKind: MissKind;
  handed?: boolean;            // the diagram depends on the shooter's hand
  coaching?: string[];
  bestLabel?: string;          // what "best" means here, for summaries
}

export interface Thresholds { upMake: number; upQuality: number; downMake: number; downQuality: number }
export const DEFAULT_THRESHOLDS: Thresholds = { upMake: 0.8, upQuality: 0.7, downMake: 0.7, downQuality: 0.5 };

export const requiredMakes = (spec: ProgSpec) => spec.phases.reduce((a, p) => a + p.makes, 0);

/** Event shape: key 'make' or 'miss'; res = outcome id or miss direction; ph = phase id. */
export function makeEvent(o: MakeOutcome, phase: ProgPhase): Omit<TallyEvent, 't'> {
  return { key: 'make', res: o.id, ph: phase.id };
}
export function missEvent(dir: MissDir, phase: ProgPhase): Omit<TallyEvent, 't'> {
  return { key: 'miss', res: dir, ph: phase.id };
}

const outcomeOf = (spec: ProgSpec, phId: string | undefined, res: string | undefined): MakeOutcome | undefined =>
  (spec.phases.find(p => p.id === phId) ?? spec.phases[0]).outcomes.find(o => o.id === res)
  ?? spec.phases.flatMap(p => p.outcomes).find(o => o.id === res);

/** Which phase the next shot belongs to, and how many makes it has so far. */
export function currentPhase(spec: ProgSpec, events: TallyEvent[]): { index: number; phase: ProgPhase; made: number; done: boolean } {
  let makes = events.filter(e => e.key === 'make').length;
  for (let i = 0; i < spec.phases.length; i++) {
    const ph = spec.phases[i];
    if (makes < ph.makes) return { index: i, phase: ph, made: makes, done: false };
    makes -= ph.makes;
  }
  const last = spec.phases[spec.phases.length - 1];
  return { index: spec.phases.length - 1, phase: last, made: last.makes, done: true };
}

export interface ProgSummary {
  makes: number; attempts: number; quality: number; best: number;
  makePct: number | null; qualityPct: number | null;
  misses: Record<MissDir, number>;
  drift: Record<Side, number>; spin: Record<Side, number>;
  byPhase: Record<string, { makes: number; attempts: number; quality: number; best: number }>;
  complete: boolean;
}

export function summarize(spec: ProgSpec, s: Pick<TallySession, 'events'>): ProgSummary {
  const out: ProgSummary = {
    makes: 0, attempts: 0, quality: 0, best: 0, makePct: null, qualityPct: null,
    misses: { L: 0, R: 0, thick: 0, thin: 0, '?': 0 }, drift: { L: 0, R: 0 }, spin: { L: 0, R: 0 }, byPhase: {}, complete: false,
  };
  for (const e of s.events) {
    if (e.key !== 'make' && e.key !== 'miss') continue;
    const ph = e.ph ?? spec.phases[0].id;
    const b = (out.byPhase[ph] ??= { makes: 0, attempts: 0, quality: 0, best: 0 });
    out.attempts++; b.attempts++;
    if (e.key === 'miss') { const d = (e.res ?? '?') as MissDir; out.misses[d in out.misses ? d : '?']++; continue; }
    out.makes++; b.makes++;
    const o = outcomeOf(spec, e.ph, e.res);
    if (o?.quality) { out.quality++; b.quality++; }
    if (o?.quality === 'best') { out.best++; b.best++; }
    if (o?.drift) out.drift[o.drift]++;
    if (o?.spin) out.spin[o.spin]++;
  }
  out.makePct = out.attempts ? out.makes / out.attempts : null;
  out.qualityPct = out.makes ? out.quality / out.makes : null;
  out.complete = out.makes >= requiredMakes(spec);
  return out;
}

export type Verdict = 'good' | 'poor' | 'neither';
export function verdictOf(sum: Pick<ProgSummary, 'makePct' | 'qualityPct'>, th: Thresholds = DEFAULT_THRESHOLDS): Verdict {
  const m = sum.makePct ?? 0, q = sum.qualityPct ?? 0;
  if (m >= th.upMake && q >= th.upQuality) return 'good';
  if (m < th.downMake || q < th.downQuality) return 'poor';
  return 'neither';
}

export interface LevelOverride { level: number; at: string }   // a manual level switch, and when

export interface LevelState {
  level: number;               // where the next completion starts
  good: number;                // completions in a row at this level that met the move-up bar
  poor: number;                // … that were poor
  mastered: boolean;           // the top level's move-up bar has been met twice in a row
  changed?: { from: number; to: number; at: string };   // the latest automatic move
}

/**
 * Replay finished completions (oldest first) to find the current level. A manual switch
 * resets the count from that moment. Completions at other levels (a stroke workout running
 * all three) don't count toward the current level's streak.
 */
export function levelState(spec: ProgSpec, sessions: TallySession[], th: Thresholds = DEFAULT_THRESHOLDS, override?: LevelOverride | null): LevelState {
  const top = spec.levels.length;
  const st: LevelState = { level: Math.min(top, Math.max(1, override?.level ?? 1)), good: 0, poor: 0, mastered: false };
  if (!spec.progressive) return { ...st, level: 1 };
  const done = sessions.filter(s => s.ended && (!override || s.ended > override.at))
    .sort((a, b) => ((a.ended ?? '') < (b.ended ?? '') ? -1 : 1));
  for (const s of done) {
    const sum = summarize(spec, s);
    if (!sum.complete || (s.level ?? 1) !== st.level) continue;
    const v = verdictOf(sum, th);
    if (v === 'good') { st.good++; st.poor = 0; } else if (v === 'poor') { st.poor++; st.good = 0; } else { st.good = 0; st.poor = 0; }
    if (st.good >= 2) {
      if (st.level < top) { st.changed = { from: st.level, to: st.level + 1, at: s.ended! }; st.level++; st.mastered = false; }
      else st.mastered = true;
      st.good = 0;
    } else if (st.poor >= 2) {
      if (st.level > 1) { st.changed = { from: st.level, to: st.level - 1, at: s.ended! }; st.level--; }
      st.poor = 0; st.mastered = false;
    }
  }
  return st;
}

/** Plain-language result of one completion against the level rules. */
export function progressNote(before: LevelState, after: LevelState, v: Verdict, playedLevel: number, top: number): string {
  if (after.level > before.level) return `Moving up: your next ${'set'} starts at Level ${after.level}.`;
  if (after.level < before.level) return `Two sets in a row below the bar: your next set starts at Level ${after.level}, to rebuild consistency.`;
  if (playedLevel !== before.level) return `Level ${playedLevel} practice; your progress is tracked at Level ${before.level}.`;
  if (after.mastered && !before.mastered) return `Level ${top} mastered: the move-up bar met twice in a row.`;
  if (v === 'good') return after.level === top ? 'At the bar. Once more in a row to master this level.' : `At the bar: one more like this and you move up to Level ${after.level + 1}.`;
  if (v === 'poor') return after.level > 1 ? 'Below the bar. One bad set never moves you down; two in a row would.' : 'Below the bar. Keep at it; Level 1 is the base.';
  return 'Solid, but not yet at the move-up bar.';
}

/** Mirror a diagram left-to-right (for left-handed players). */
export function mirrorDiagram(spec: DiagramSpec | null, width = 50): DiagramSpec | null {
  if (!spec) return null;
  const fx = (x: number) => width - x;
  return {
    ...spec,
    balls: spec.balls.map(b => ({ ...b, x: fx(b.x) })),
    paths: spec.paths.map(p => ({ ...p, points: p.points.map(([x, y]) => [fx(x), y] as [number, number]) })),
    labels: spec.labels?.map(l => ({ ...l, at: [fx(l.at[0]), l.at[1]] as [number, number], anchor: l.anchor === 'start' ? 'end' : l.anchor === 'end' ? 'start' : l.anchor })),
  };
}

/** One-line description of a tapped event (for Undo and history). */
export function describeEvent(spec: ProgSpec, e: TallyEvent): string {
  if (e.key === 'miss') {
    const r = e.res as MissDir;
    return r === 'thick' ? 'missed thick' : r === 'thin' ? 'missed thin' : r === 'L' ? 'missed left' : r === 'R' ? 'missed right' : 'missed (not sure)';
  }
  return (outcomeOf(spec, e.ph, e.res)?.label ?? 'made').toLowerCase();
}
