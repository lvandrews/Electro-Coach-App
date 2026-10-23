import type { Block } from './plan';
import type { DrillDef } from './drills';
import { completionSummary, diagnosticCounts, type TallySession } from './tally';
import { requiredMakes } from './progressive';
import { bowlingCard, type BowlingGame, type Game } from './games';

// Timed practice sessions (the practice plan, run block by block on one phone).
// Each block has a set-up step, then a timer. A block ends on time, on a count, or on
// whichever comes first; the next block starts only when you acknowledge. While
// Railbird films, the phone shows Railbird, so the end of a timed block is signaled
// by an Android notification (which a paired watch mirrors).

export type BlockMode = 'tap' | 'record' | 'free';
export type EndRule = 'time' | 'count' | 'either';
export type CountUnit = 'racks' | 'shots' | 'games' | 'makes';

export interface RunBlock {
  title: string;
  why: string;
  label?: string;                 // plan segment, if this block works on one
  drills: string[];
  drillId: string | null;         // the drill this block runs
  minutes: number;
  mode: BlockMode;
  end: EndRule;
  count?: number;
  unit?: CountUnit;
  level?: number;                 // progressive drills: the level to play (else the player's current level)
  variant?: string;               // e.g. the speed for basic stop shots
  target?: number;                // chosen set size
  est?: number;                   // how many of your own past runs the minutes come from (0 = an estimate)
  stroke?: boolean;               // part of the stroke warm-up
  // filled in while running
  setupAt?: string;               // set-up card shown
  startedAt?: string;             // timer started
  endedAt?: string;               // acknowledged / moved on
  tallyId?: string;               // tally opened for this block
  counted?: number;               // count reached when the block ended
}

export interface PracticeSession {
  id: string;
  kind: 'practice';
  date: string;                   // started
  updated: string;
  minutes: number;                // planned length
  blocks: RunBlock[];
  current: number;                // index of the block in progress (blocks.length when done)
  paused?: { at: string; remainingMs: number } | null;
  ended?: string;
  rating?: number;                // 1–5, how it felt
  note?: string;
  device: string;
}

export const MODE_LABEL: Record<BlockMode, string> = { tap: 'Tap on the phone', record: 'Film with Railbird', free: 'No recording' };

/** Sensible defaults for a block from the drill it runs. */
export function defaultsFor(d: DrillDef | undefined): Pick<RunBlock, 'mode' | 'end' | 'count' | 'unit'> {
  if (!d) return { mode: 'free', end: 'time' };
  if (d.scorer === 'bowling') return { mode: 'tap', end: 'either', count: 1, unit: 'games' };
  if (d.counters === 'completion') return { mode: 'tap', end: 'either', count: (d.ballsPerRack ?? 9) > 9 ? 3 : 5, unit: 'racks' };
  if (d.counters === 'diagnostic') return { mode: 'tap', end: 'either', count: 20, unit: 'shots' };
  if (d.counters === 'progressive' && d.prog) return { mode: 'tap', end: 'either', count: requiredMakes(d.prog), unit: 'makes' };
  return { mode: 'record', end: 'time' };
}

/** Minutes of changeover before a block: a minute for a new drill, two when the phone goes onto (or off) its stand. */
export function changeover(prev: RunBlock | undefined, b: RunBlock): number {
  if (!prev) return 0;
  return (prev.mode === 'record') !== (b.mode === 'record') ? 2 : 1;
}

/**
 * Turn the plan's blocks into run blocks for a session of `minutes`: pick each block's
 * drill and defaults, keep filmed blocks together in the middle (one trip to the
 * phone stand), and take changeover time out of the blocks so the total holds.
 */
export function buildRun(blocks: Block[], drills: DrillDef[], minutes: number): RunBlock[] {
  const byId = new Map(drills.map(d => [d.id, d]));
  const run: RunBlock[] = blocks.map(b => {
    const drillId = b.drills.find(id => byId.has(id)) ?? null;
    return { title: b.title, why: b.why, label: b.label, drills: b.drills, drillId, minutes: b.minutes, ...defaultsFor(drillId ? byId.get(drillId) : undefined) };
  });
  // The warm-up is for finding the stroke, not for taps: film it if the drill has a Railbird tag, otherwise no recording.
  const w = run[0], wd = w?.drillId ? byId.get(w.drillId) : undefined;
  // Tap stroke drills (the X-drill and its family) stay tapped: they are the warm-up.
  if (w && blocks[0]?.title.startsWith('Warm up') && wd?.counters !== 'progressive') Object.assign(w, { mode: wd && (wd.tags.length || wd.railbirdBuiltIn) ? 'record' : 'free', end: 'time', count: undefined, unit: undefined });
  if (run.length > 3) {
    const first = run[0], last = run[run.length - 1];
    const middle = run.slice(1, -1).sort((a, b) => Number(b.mode === 'record') - Number(a.mode === 'record'));
    run.splice(0, run.length, first, ...middle, last);
  }
  fitMinutes(run, minutes);
  return run;
}

/** Scale block minutes so blocks + changeovers = minutes (whole minutes, at least 3 per block). */
export function fitMinutes(run: RunBlock[], minutes: number) {
  const over = run.reduce((s, b, i) => s + changeover(run[i - 1], b), 0);
  const avail = Math.max(run.length * 3, minutes - over);
  const total = run.reduce((s, b) => s + b.minutes, 0) || 1;
  run.forEach(b => { b.minutes = Math.max(3, Math.round((b.minutes * avail) / total)); });
  let diff = avail - run.reduce((s, b) => s + b.minutes, 0);
  for (let i = 0; diff !== 0 && i < 200; i++) {
    const k = [...run.keys()].sort((a, b) => run[b].minutes - run[a].minutes)[i % run.length];
    if (diff > 0) { run[k].minutes++; diff--; } else if (run[k].minutes > 3) { run[k].minutes--; diff++; }
  }
  return run;
}

export const plannedTotal = (run: RunBlock[]) => run.reduce((s, b, i) => s + b.minutes + changeover(run[i - 1], b), 0);

/** Progress toward a block's count, from its tally or the bowling games scored since it started. */
export function countSoFar(b: RunBlock, tallies: TallySession[], games: Game[], drill: DrillDef | undefined): number {
  if (!b.startedAt || !b.unit) return 0;
  if (b.unit === 'games') {
    return games.filter((g): g is BowlingGame => g.kind === 'bowling' && g.date >= b.startedAt! && !!g.frames && bowlingCard(g.frames).complete).length;
  }
  const t = tallies.find(x => x.id === b.tallyId);
  if (!t) return 0;
  if (b.unit === 'racks') return completionSummary(t, drill?.ballsPerRack ?? 9, 'include').racks;   // learning racks fill the block too
  if (b.unit === 'makes') return t.events.filter(e => e.key === 'make').length;
  let n = 0;
  for (const blk of Object.values(diagnosticCounts(t))) for (const s of ['L', 'R'] as const) n += blk[s].make + blk[s].thick + blk[s].thin;
  return n;
}

/** Milliseconds left on a running block (negative = overtime). */
export function msLeft(s: PracticeSession, now = Date.now()): number | null {
  const b = s.blocks[s.current];
  if (!b?.startedAt) return null;
  if (s.paused) return s.paused.remainingMs;
  return Date.parse(b.startedAt) + b.minutes * 60000 - now;
}

/** Whether the running block has reached its end (by time and/or count). */
export function blockDue(b: RunBlock, left: number | null, counted: number): boolean {
  const timeUp = left != null && left <= 0;
  const countUp = b.count != null && counted >= b.count;
  if (b.end === 'time') return timeUp;
  if (b.end === 'count') return countUp;
  return timeUp || countUp;
}
