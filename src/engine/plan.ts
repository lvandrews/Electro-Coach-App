import type { ModelRow } from './model';
import { tierOf, type Tier } from './ledger';
import { between, progressNow, sessionPoints, TRACKABLE, windowStat, type Baseline, type WindowStat } from './progress';

// Practice plan (build step 5). Targets are ranked by MAKES LOST: how many makes per
// 100 of your shots a weakness costs, given how often you face that kind of shot
// (volume × deficit). Measured against the same frozen yardstick as Progress.
// Strengths are listed too, ranked by makes gained, so the plan says what to keep.

export type PlanPeriod = 'all' | '365' | '180' | '90';
export const PLAN_PERIODS: { id: PlanPeriod; label: string; days: number | null }[] = [
  { id: 'all', label: 'All time', days: null }, { id: '365', label: 'Last 12 months', days: 365 },
  { id: '180', label: 'Last 6 months', days: 180 }, { id: '90', label: 'Last 90 days', days: 90 },
];

export interface PlanSettings {
  period: PlanPeriod;
  minutes: number;
  general: string;                    // free text for the whole plan
  text: Record<string, string>;       // coaching text per segment label
  hidden: string[];                   // targets left out of the session
  timing?: 'finish' | 'time';         // tap blocks: finish each drill (default) or keep to time
  filmPerWeek?: number;               // filmed (Railbird) sessions a week: 0–3, default 2
  filmMinutes?: number;               // filmed minutes in a filmed session: 20, 30 or 45
}
export const DEFAULT_PLAN: PlanSettings = { period: '365', minutes: 60, general: '', text: {}, hidden: [], timing: 'finish', filmPerWeek: 2, filmMinutes: 30 };

export interface PlanItem {
  label: string;
  group: string;
  n: number;
  share: number;            // n ÷ all shots in the window
  stat: WindowStat;
  tier: Tier;
  perHundred: number;       // makes lost (+) or gained (−) per 100 of all your shots
  recent: WindowStat | null;   // last 90 days
  drills: string[];         // drill ids worth practicing for it
  overlap: { label: string; frac: number } | null;   // biggest share of these shots inside a higher-ranked item
  shotIds: Set<number>;
}

export interface Plan { targets: PlanItem[]; strengths: PlanItem[]; shots: number; sessions: number; from: string; to: string }

const DAY = 86400000;
const MIN_SHOTS = 30;

/** Drills in the library that work on a segment. */
export function drillsFor(label: string): string[] {
  const l = label.toLowerCase();
  if (l.startsWith('center (tangent line), 20')) return ['d0-tangent', 'd2-stun'];
  if (l.startsWith('center (tangent line), 0')) return ['xdrill'];
  if (l.startsWith('center (tangent line), 10')) return ['mirror', 'd0-tangent'];
  if (l.startsWith('follow')) return ['d1-roll', 'xdrill'];
  if (l.startsWith('draw')) return ['xdrill'];
  if (l.includes('near-straight')) return ['mirror', 'xdrill'];
  if (l.includes('moderate 20–45')) return ['d0-tangent', 'd2-stun', 'spot'];
  if (l.includes('steep')) return ['thin-cuts-1', 'thin-cuts-2', 'd1-roll'];
  if (l.startsWith('side pocket')) return ['side-ladder'];
  if (l.startsWith('corner pocket')) return ['spot', 'double-box'];
  if (l.startsWith('backcuts')) return ['mirror'];
  if (l.startsWith('9-ball')) return ['transitions-1', 'bowling-10'];
  return [];
}

export function buildPlan(b: Baseline, rows: ModelRow[], period: PlanPeriod): Plan {
  const all = sessionPoints(b, rows);
  const now = progressNow(all);
  const days = PLAN_PERIODS.find(p => p.id === period)?.days ?? null;
  const inWin = days == null ? rows : rows.filter(r => { const t = Date.parse(r.shot.sessionStart); return t > now - days * DAY && t <= now + DAY; });
  const N = inWin.length;
  const sessions = new Set(inWin.map(r => r.shot.sessionId)).size;
  const items: PlanItem[] = [];
  for (const seg of TRACKABLE) {
    const pts = sessionPoints(b, inWin, seg.test);
    const w = windowStat(pts);
    if (!w || w.n < MIN_SHOTS || !Number.isFinite(w.se)) continue;
    const segAll = sessionPoints(b, rows, seg.test);
    items.push({
      label: seg.label, group: seg.group, n: w.n, share: w.n / N, stat: w, tier: tierOf(w.oe, w.lo, w.hi),
      perHundred: (100 * (w.expected - w.made)) / N,
      recent: windowStat(between(segAll, now - 90 * DAY, now + DAY)),
      drills: drillsFor(seg.label), overlap: null,
      shotIds: new Set(inWin.filter(r => seg.test(r.shot)).map(r => r.shot.shotId)),
    });
  }
  const starts = inWin.map(r => r.shot.sessionStart).sort();
  const targets = withOverlap(items.filter(i => i.tier === 'Established weakness' || i.tier === 'Watch').sort((a, b) => b.perHundred - a.perHundred));
  const strengths = withOverlap(items.filter(i => i.tier === 'Established strength' || i.tier === 'Emerging strength').sort((a, b) => a.perHundred - b.perHundred));
  return {
    targets, strengths,
    shots: N, sessions, from: starts[0] ?? '', to: starts[starts.length - 1] ?? '',
  };
}

/** Segments overlap (a tangent-line 20–45° shot is also a left or right 20–45° cut): note the largest. */
function withOverlap(list: PlanItem[]): PlanItem[] {
  list.forEach((it, i) => {
    let best: PlanItem['overlap'] = null;
    for (const prev of list.slice(0, i)) {
      let k = 0; for (const id of it.shotIds) if (prev.shotIds.has(id)) k++;
      const frac = k / it.shotIds.size;
      if (frac >= 0.3 && (!best || frac > best.frac)) best = { label: prev.label, frac };
    }
    it.overlap = best;
  });
  return list;
}

export const OVERLAP_SKIP = 0.35;

// ---------- one session ----------

export interface Block { title: string; minutes: number; why: string; drills: string[]; label?: string }

/**
 * A session of `minutes`: a short warm-up on your top strength, up to three targets
 * with time in proportion to makes lost (at least 10 minutes each), and a closing
 * run-out block so the work is tested in a pattern.
 */
export function sessionBlocks(plan: Plan, hidden: string[], minutes: number): Block[] {
  const round5 = (x: number) => Math.max(5, Math.round(x / 5) * 5);
  // Up to three targets (two in short sessions), skipping any that mostly repeats one already chosen.
  const targets: PlanItem[] = [];
  for (const t of plan.targets) {
    if (hidden.includes(t.label) || t.group === 'Session type') continue;
    if (targets.some(c => { let k = 0; for (const id of t.shotIds) if (c.shotIds.has(id)) k++; return k / t.shotIds.size >= OVERLAP_SKIP; })) continue;
    targets.push(t);
    if (targets.length === (minutes >= 60 ? 3 : 2)) break;
  }
  const warm = round5(minutes * 0.12), close = minutes >= 45 ? round5(minutes * 0.2) : 0;
  const blocks: Block[] = [];
  const s = plan.strengths[0];
  blocks.push(s
    ? { title: `Warm up: ${s.label}`, minutes: warm, why: 'Start with something you do well.', drills: s.drills, label: s.label }
    : { title: 'Warm up', minutes: warm, why: 'Easy shots to find your stroke.', drills: ['xdrill'] });
  let left = minutes - warm - close;
  if (targets.length) {
    const total = targets.reduce((x, t) => x + t.perHundred, 0) || 1;
    const raw = targets.map(t => Math.max(10, (left * t.perHundred) / total));
    const scale = left / raw.reduce((x, y) => x + y, 0);
    const mins = raw.map(r => round5(r * scale));
    mins[0] += left - mins.reduce((x, y) => x + y, 0);   // keep the total exact
    targets.forEach((t, i) => blocks.push({
      title: t.label, minutes: mins[i], label: t.label, drills: t.drills,
      why: `Costs ${t.perHundred.toFixed(1)} makes per 100 shots.`,
    }));
    left = 0;
  }
  const games = plan.targets.find(t => t.group === 'Session type' && !hidden.includes(t.label));
  if (close || left) blocks.push({
    title: 'Run-out pattern', minutes: close + left, drills: ['transitions-1', 'bowling-10'],
    why: games ? `Use the work inside a run-out. ${games.label} run ${Math.abs(100 * games.stat.oe).toFixed(1)} pts below the yardstick.` : 'Use the work inside a run-out.',
  });
  return blocks;
}
