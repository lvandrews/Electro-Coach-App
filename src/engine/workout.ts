// Building a practice session: the stroke warm-up chosen by player stage and drill
// levels, the plan's targets, and a closing run-out block, with filming limited to a
// few short sessions a week and block times taken from how long your drills actually
// take you. Shared by the Plan preview and the session review so the two always agree.

import type { DrillDef } from './drills';
import type { Game } from './games';
import { requiredMakes, summarize } from './progressive';
import { changeover, defaultsFor, type PracticeSession, type RunBlock } from './session';
import type { Block } from './plan';
import type { TallySession } from './tally';

export type Timing = 'finish' | 'time';
export type Stage = 'new' | 'developing' | 'advanced';
export type Kind = 'planned' | 'tournament' | 'stroke';

// ---------- how long a drill takes you ----------

export interface Estimate { minutes: number; n: number }   // n = how many of your own runs it comes from

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mins = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60000;

/**
 * Minutes for one set of a drill: the median of your last four finished runs of it
 * (timed-session blocks that reached their count, and complete stroke-drill sets),
 * otherwise the drill's first estimate.
 */
export function estimateMinutes(d: DrillDef, games: Game[], tallies: TallySession[], variant?: string): Estimate {
  const samples: { at: string; m: number }[] = [];
  for (const g of games) {
    if (g.kind !== 'practice') continue;
    for (const b of (g as PracticeSession).blocks) {
      if (b.drillId !== d.id || !b.startedAt || !b.endedAt || b.end === 'time') continue;
      if (b.count != null && (b.counted ?? 0) < b.count) continue;           // ended early: not a full set
      if (variant && b.variant && b.variant !== variant) continue;
      samples.push({ at: b.endedAt, m: mins(b.startedAt, b.endedAt) });
    }
  }
  if (d.prog) {
    for (const t of tallies) {
      if (t.drillId !== d.id || !t.ended || (variant && t.variant && t.variant !== variant)) continue;
      if (samples.some(x => Math.abs(Date.parse(x.at) - Date.parse(t.ended!)) < 90_000)) continue;   // the same set as a block
      if (!summarize(d.prog, t).complete) continue;
      samples.push({ at: t.ended, m: mins(t.started, t.ended) });
    }
  }
  const recent = samples.filter(x => x.m >= 1 && x.m <= 120).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 4);
  if (recent.length) return { minutes: Math.max(2, Math.round(median(recent.map(x => x.m)))), n: recent.length };
  const first = d.minutes ?? (d.prog ? Math.ceil(requiredMakes(d.prog) * 0.4) + 1 : 10);
  return { minutes: first, n: 0 };
}

// ---------- filming: a few short filmed sessions a week ----------

/** Monday 00:00 local of the week containing `now`. */
export function weekStart(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** Days this week with filming: a timed session with a filmed block, or an imported Railbird session. */
export function filmedThisWeek(games: Game[], railbirdStarts: string[], now = new Date()): number {
  const from = weekStart(now).getTime();
  const day = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const days = new Set<string>();
  for (const g of games) {
    if (g.kind !== 'practice' || Date.parse(g.date) < from) continue;
    if ((g as PracticeSession).blocks.some(b => b.mode === 'record' && b.startedAt)) days.add(day(g.date));
  }
  for (const s of railbirdStarts) if (Date.parse(s) >= from) days.add(day(s));
  return days.size;
}

// ---------- the stroke warm-up ----------

export interface StrokePick { drillId: string; variant?: string; target?: number; level?: number; why: string; core?: boolean }

/**
 * Lela's rules: every workout opens with stroke drills (Mid-table stop shots, X-drill,
 * Center table follow, Center table draw), one set each at the current level, with the
 * X-drill as the minimum. New players do Basic stop shots instead. Lower levels get an
 * extra Mid-table set; Center table draw waits until the X-drill reaches Level 2; at X-drill
 * Level 3 the lower of the two Center table drills gets an extra set. Advanced players warm up
 * with 5 medium Basic stop shots, and do all three speeds about once a week. Deep sessions
 * start with longer Basic stop shot sets.
 */
export function strokePicks(stage: Stage, level: (id: string) => number, opts: { deep: boolean; basicStopsThisWeek: boolean }): StrokePick[] {
  const speeds = (n: number, why: string): StrokePick[] => ['low', 'medium', 'high'].map(v => ({ drillId: 'basic-stops', variant: v, target: n, why }));
  if (stage === 'new') return speeds(opts.deep ? 7 : 5, 'New players: stop shots at three speeds, the foundation of the stroke.').map((p, i) => ({ ...p, core: i === 1 }));
  const out: StrokePick[] = [];
  if (stage === 'advanced' && !opts.basicStopsThisWeek) out.push(...speeds(opts.deep ? 7 : 5, 'Once a week: stop shots at every speed.'));
  else if (opts.deep) out.push({ drillId: 'basic-stops', variant: 'medium', target: 7, why: 'Deep session: start with basic stop shots.' });
  else if (stage === 'advanced') out.push({ drillId: 'basic-stops', variant: 'medium', target: 5, why: 'Warm-up: five medium-speed stop shots.' });
  const x = level('xdrill');
  const mostlyL1 = ['midtable-stops', 'xdrill', 'center-follow', 'center-draw'].filter(id => level(id) <= 1).length >= 3;
  out.push({ drillId: 'midtable-stops', why: 'Stop shots from every angle.' });
  if (mostlyL1) out.push({ drillId: 'midtable-stops', why: 'An extra set while your stroke drills are at Level 1.' });
  out.push({ drillId: 'xdrill', why: 'Follow, stop and draw: the minimum stroke warm-up.', core: true });
  out.push({ drillId: 'center-follow', why: 'Follow on a long straight-in shot.' });
  if (x >= 2) out.push({ drillId: 'center-draw', why: 'Draw on a long straight-in shot.' });
  if (x >= 3) {
    const lower = level('center-follow') <= level('center-draw') ? 'center-follow' : 'center-draw';
    out.push({ drillId: lower, why: 'An extra set on your lower Center table drill.' });
  }
  return out;
}

/** All three levels of each stroke drill, in order: the stroke workout preset. */
export function strokeWorkoutPicks(): StrokePick[] {
  return ['midtable-stops', 'xdrill', 'center-follow', 'center-draw'].flatMap(id => [1, 2, 3].map(level => ({ drillId: id, level, why: `Level ${level}.` })));
}

// ---------- the whole session ----------

export interface ComposeArgs {
  kind: Kind;
  planBlocks: Block[] | null;   // the plan's blocks (null without Railbird data)
  minutes: number;
  drills: DrillDef[];
  games: Game[];
  tallies: TallySession[];
  stage: Stage;
  level: (id: string) => number;
  timing: Timing;
  film: boolean;                // film this session
  filmMinutes: number;          // at most this many filmed minutes
  now?: Date;
}

export interface Composed { run: RunBlock[]; strokeMinutes: number; filmed: boolean }

export function composeSession(a: ComposeArgs): Composed {
  const byId = new Map(a.drills.map(d => [d.id, d]));
  const now = a.now ?? new Date();
  const basicThisWeek = a.tallies.some(t => t.drillId === 'basic-stops' && t.ended && Date.parse(t.ended) >= weekStart(now).getTime() && t.variant !== 'medium');
  const deep = a.minutes >= 90;

  // 1. Stroke blocks.
  let picks = a.kind === 'tournament' ? [{ drillId: 'basic-stops', variant: 'medium', target: 5, why: 'Little table time: five medium-speed stop shots.', core: true }]
    : a.kind === 'stroke' ? strokeWorkoutPicks()
    : strokePicks(a.stage, a.level, { deep, basicStopsThisWeek: basicThisWeek });
  picks = picks.filter(p => byId.has(p.drillId));
  const strokeBlock = (p: StrokePick): RunBlock => {
    const d = byId.get(p.drillId)!;
    const est = estimateMinutes(d, a.games, a.tallies, p.variant);
    const lv = p.level ?? (d.prog?.progressive ? a.level(d.id) : undefined);
    const variant = p.variant ? d.prog?.variants?.find(v => v.id === p.variant)?.label : undefined;
    const count = p.target ?? (d.prog ? requiredMakes(d.prog) : undefined);
    return {
      title: `${d.name}${variant ? ` · ${variant.toLowerCase()}` : ''}${lv ? ` · Level ${lv}` : ''}`, why: p.why, drills: [d.id], drillId: d.id,
      minutes: Math.max(2, Math.round(est.minutes * (p.target && d.prog?.setSizes ? p.target / d.prog.setSizes[0] : 1))), est: est.n,
      mode: 'tap', end: a.timing === 'finish' ? 'count' : 'either', count, unit: 'makes', level: lv, variant: p.variant, target: p.target, stroke: true,
    };
  };
  let stroke = picks.map(strokeBlock);
  const tot = (r: RunBlock[]) => r.reduce((s, b, i) => s + b.minutes + changeover(r[i - 1], b), 0);
  if (a.kind === 'planned') {
    // Keep the warm-up to about 40% of the session: drop extras, then the least central drills.
    const budget = Math.max(5, Math.round(a.minutes * 0.4));
    const dropOrder = ['An extra', 'Draw on', 'Follow on', 'Stop shots from', 'Once a week', 'Deep session'];
    for (const key of dropOrder) {
      while (tot(stroke) > budget) {
        const i = picks.findIndex(p => !p.core && p.why.startsWith(key));
        if (i < 0) break;
        picks.splice(i, 1); stroke.splice(i, 1);
      }
    }
  }
  if (a.kind !== 'planned') return { run: stroke, strokeMinutes: tot(stroke), filmed: false };

  // 2. The plan's targets and the run-out (the plan's own warm-up is replaced by the stroke drills).
  const rest = (a.planBlocks ?? [{ title: 'Run-out pattern', minutes: 20, why: 'Use the work inside a run-out.', drills: ['transitions-1', 'bowling-10'] }])
    .filter(b => !b.title.startsWith('Warm up'));
  let filmLeft = a.film ? a.filmMinutes : 0;
  let restRun: RunBlock[] = rest.map(b => {
    const drillsHere = b.drills.map(id => byId.get(id)).filter((d): d is DrillDef => !!d);
    const tappable = drillsHere.find(d => d.counters !== 'none' || d.scorer);
    const filmable = drillsHere.find(d => d.counters === 'none' && (d.tags.length || d.railbirdBuiltIn));
    let d = tappable ?? drillsHere[0];
    let mode: RunBlock['mode'];
    if (filmable && filmLeft > 0 && (!tappable || drillsHere.indexOf(filmable) < drillsHere.indexOf(tappable))) { d = filmable; mode = 'record'; }
    else mode = d && (d.counters !== 'none' || d.scorer) ? 'tap' : 'free';
    const base = defaultsFor(d);
    const blk: RunBlock = { title: b.title, why: b.why, label: b.label, drills: b.drills, drillId: d?.id ?? null, minutes: b.minutes, ...base, mode };
    if (mode === 'tap') blk.end = a.timing === 'finish' && base.count != null ? 'count' : base.end;
    else { blk.end = 'time'; blk.count = undefined; blk.unit = undefined; }
    if (mode === 'record') filmLeft -= b.minutes;
    return blk;
  });
  // Filmed blocks together, so the phone goes onto its stand once.
  const recs = restRun.filter(b => b.mode === 'record'), others = restRun.filter(b => b.mode !== 'record');
  const last = others.length && others[others.length - 1].title.startsWith('Run-out') ? others.pop()! : null;
  restRun = [...recs, ...others, ...(last ? [last] : [])];

  // 3. Fit the targets and run-out into the time the warm-up leaves.
  const strokeMin = tot(stroke);
  const avail = Math.max(restRun.length * 5, a.minutes - strokeMin - (restRun.length && stroke.length ? changeover(stroke[stroke.length - 1], restRun[0]) : 0));
  const run = [...stroke, ...restRun];
  const restOver = restRun.reduce((s, b, i) => s + changeover(restRun[i - 1], b), 0);
  const restTotal = restRun.reduce((s, b) => s + b.minutes, 0) || 1;
  restRun.forEach(b => { b.minutes = Math.max(5, Math.round((b.minutes * (avail - restOver)) / restTotal)); });
  // Filmed blocks never exceed the filming limit.
  if (a.film) {
    let cap = a.filmMinutes;
    for (const b of restRun.filter(x => x.mode === 'record')) { b.minutes = Math.max(5, Math.min(b.minutes, cap)); cap -= b.minutes; }
  }
  return { run, strokeMinutes: strokeMin, filmed: restRun.some(b => b.mode === 'record') };
}

/** A label for where a block's minutes come from. */
export const estLabel = (b: RunBlock) => (b.est == null ? '' : b.est > 0 ? `from your last ${b.est === 1 ? 'run' : `${b.est} runs`}` : 'estimate');
