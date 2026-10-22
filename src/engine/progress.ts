import type { Shot } from './schema';
import { fitModel, type ModelRow } from './model';
import { SEGMENTS, type SegmentDef } from './ledger';
import type { DrillDef } from './drills';
import { completionSummary, diagnosticCounts, localDate, type TallySession } from './tally';
import { bowlingStats, bowlingTotal, type BowlingGame, type Game } from './games';

// Progress (build step 4). Everything is measured against a FROZEN baseline: the
// step 2 model fitted once on the shots up to a cutoff date and stored. New imports
// never refit it, so improvement shows up as a rising O−E instead of being absorbed
// by a yardstick that moves with you. Zero means "your level over the baseline
// period" for shots of the same geometry.

// ---------- the yardstick ----------

export interface Baseline {
  version: 1;
  cutoff: string;          // ISO; shots from sessions starting on or before this are in the baseline
  createdAt: string;
  beta: number[];          // step 2 model coefficients
  n: number;
  sessions: number;
  from: string;            // first and last session in the baseline
  to: string;
  makeRate: number;
}

const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
export const expectedOf = (b: Baseline, x: number[]) => sigmoid(x.reduce((s, v, i) => s + v * b.beta[i], 0));

/** Fit and freeze the yardstick on the rows from sessions starting on or before `cutoff`. */
export function fitBaseline(rows: ModelRow[], cutoff: string, now = new Date()): Baseline {
  const sub = rows.filter(r => r.shot.sessionStart <= cutoff);
  const m = fitModel(sub);
  return {
    version: 1, cutoff, createdAt: now.toISOString(), beta: m.beta, n: m.n, sessions: m.sessions,
    from: m.dateRange[0], to: m.dateRange[1], makeRate: sub.reduce((s, r) => s + r.y, 0) / sub.length,
  };
}

/** Latest session start among the rows (the default cutoff: "everything so far"). */
export const latestStart = (rows: ModelRow[]) => rows.reduce((m, r) => (r.shot.sessionStart > m ? r.shot.sessionStart : m), '');

// ---------- per-session points ----------

export interface SessionPoint {
  sessionId: number;
  start: string;
  name: string;
  sessionType: string;
  n: number;
  made: number;
  expected: number;        // sum of baseline probabilities
}

export function sessionPoints(b: Baseline, rows: ModelRow[], filter?: (s: Shot) => boolean): SessionPoint[] {
  const map = new Map<number, SessionPoint>();
  for (const r of rows) {
    if (filter && !filter(r.shot)) continue;
    const s = r.shot;
    let p = map.get(s.sessionId);
    if (!p) { p = { sessionId: s.sessionId, start: s.sessionStart, name: s.sessionName, sessionType: s.sessionType, n: 0, made: 0, expected: 0 }; map.set(s.sessionId, p); }
    p.n++; p.made += r.y; p.expected += expectedOf(b, r.x);
  }
  return [...map.values()].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.sessionId - b.sessionId));
}

// ---------- windows ----------

export interface WindowStat {
  n: number;
  sessions: number;
  made: number;
  expected: number;
  makeRate: number;
  expRate: number;
  oe: number;              // (made − expected) / n
  se: number;              // session-clustered standard error of oe (NaN with < 2 sessions)
  lo: number;
  hi: number;
}

/**
 * Pooled O−E over a set of sessions with a session-clustered standard error:
 * var = G/(G−1) · Σ_s (R_s − n_s·oe)² / N², where R_s is the session's made − expected.
 */
export function windowStat(points: SessionPoint[]): WindowStat | null {
  const N = points.reduce((s, p) => s + p.n, 0);
  if (!N) return null;
  const made = points.reduce((s, p) => s + p.made, 0), expected = points.reduce((s, p) => s + p.expected, 0);
  const oe = (made - expected) / N, G = points.length;
  let ss = 0;
  for (const p of points) { const d = p.made - p.expected - p.n * oe; ss += d * d; }
  const se = G >= 2 ? Math.sqrt((G / (G - 1)) * ss) / N : NaN;
  return { n: N, sessions: G, made, expected, makeRate: made / N, expRate: expected / N, oe, se, lo: oe - 1.96 * se, hi: oe + 1.96 * se };
}

const DAY = 86400000;
export const between = (points: SessionPoint[], fromMs: number, toMs: number) =>
  points.filter(p => { const t = Date.parse(p.start); return t > fromMs && t <= toMs; });

/** Rolling window ending at each session: (t − days, t]. Null where the window holds fewer than minShots. */
export function rollingSeries(points: SessionPoint[], days: number, minShots = 60): { t: string; stat: WindowStat | null }[] {
  return points.map(p => {
    const t = Date.parse(p.start);
    const w = windowStat(between(points, t - days * DAY, t));
    return { t: p.start, stat: w && w.n >= minShots ? w : null };
  });
}

export interface DiffStat { diff: number; se: number; lo: number; hi: number }
/** a − b for two non-overlapping windows. */
export function diffStat(a: WindowStat | null, b: WindowStat | null): DiffStat | null {
  if (!a || !b) return null;
  const se = Math.sqrt(a.se ** 2 + b.se ** 2), diff = a.oe - b.oe;
  return { diff, se, lo: diff - 1.96 * se, hi: diff + 1.96 * se };
}

export interface PeriodSummary {
  last30: WindowStat | null;
  last90: WindowStat | null;
  prev90: WindowStat | null;      // 90–180 days before `now`
  change: DiffStat | null;        // last 90 − previous 90
  sinceFrozen: WindowStat | null; // sessions after the baseline cutoff
  allTime: WindowStat | null;
}

export function periodSummary(points: SessionPoint[], b: Baseline, now = Date.now()): PeriodSummary {
  const last90 = windowStat(between(points, now - 90 * DAY, now + DAY));
  const prev90 = windowStat(between(points, now - 180 * DAY, now - 90 * DAY));
  const after = points.filter(p => p.start > b.cutoff);
  return {
    last30: windowStat(between(points, now - 30 * DAY, now + DAY)),
    last90, prev90, change: diffStat(last90, prev90),
    sinceFrozen: after.length ? windowStat(after) : null,
    allTime: windowStat(points),
  };
}

/** "Now" for the progress screen: the latest session, so a break from the table doesn't empty every window. */
export const progressNow = (points: SessionPoint[]) => (points.length ? Date.parse(points[points.length - 1].start) : Date.now());

// ---------- segment meters ----------

// The ledger's segments, minus equipment rows (those are conditions, not skills). Radar axes are
// left out: they overlap these, and the overall spin axes mix cut bands (see v17).
export const TRACKABLE: SegmentDef[] = SEGMENTS.filter(s => !s.condition);
export const segmentByLabel = (label: string) => TRACKABLE.find(s => s.label === label) ?? null;

export interface SegmentMeter {
  label: string;
  group: string;
  allTime: WindowStat | null;
  last90: WindowStat | null;
  prev90: WindowStat | null;
  change: DiffStat | null;
  rolling: { t: string; stat: WindowStat | null }[];   // 90-day window
  points: SessionPoint[];
}

export function segmentMeter(b: Baseline, rows: ModelRow[], seg: SegmentDef, now?: number): SegmentMeter {
  const pts = sessionPoints(b, rows, seg.test);
  const t = now ?? progressNow(pts);
  const last90 = windowStat(between(pts, t - 90 * DAY, t + DAY));
  const prev90 = windowStat(between(pts, t - 180 * DAY, t - 90 * DAY));
  return {
    label: seg.label, group: seg.group, allTime: windowStat(pts), last90, prev90, change: diffStat(last90, prev90),
    rolling: rollingSeries(pts, 90, 40), points: pts,
  };
}

/**
 * Segments to pin when the user hasn't chosen any: those whose all-time O−E range
 * clears zero, ranked by makes lost or gained (shots × O−E), at most `max`.
 */
export function suggestedPins(b: Baseline, rows: ModelRow[], max = 4): string[] {
  const scored: { label: string; impact: number }[] = [];
  for (const seg of TRACKABLE) {
    const w = windowStat(sessionPoints(b, rows, seg.test));
    if (!w || w.n < 100 || !Number.isFinite(w.se)) continue;
    if (w.lo > 0 || w.hi < 0) scored.push({ label: seg.label, impact: Math.abs(w.oe) * w.n });
  }
  return scored.sort((a, b) => b.impact - a.impact).slice(0, max).map(s => s.label);
}

// ---------- drill meters ----------

export interface DrillSessionPoint {
  date: string;            // ISO start
  n: number;               // shots (Railbird) or racks (completion) or attempts (diagnostic)
  value: number;           // make rate or completion rate
  detail: string;
  source: 'railbird' | 'tally';
}

export interface DrillMeter {
  drill: DrillDef;
  kind: 'reps' | 'completion' | 'diagnostic' | 'score';
  unit: string;                      // what `value` measures
  points: DrillSessionPoint[];       // primary series, oldest first
  railbird: DrillSessionPoint[];     // Railbird make rate (for tally drills, the secondary series)
  recent: { value: number; n: number; sessions: number } | null;    // last 5 sessions pooled
  earlier: { value: number; n: number; sessions: number } | null;   // everything before
  extra: string[];                   // short lines for the card
  target: number;                    // shots (or racks) per session needed to read a session
  max: number;                       // 1 for rates, 300 for bowling scores
}

const RECENT = 5;
function pool(pts: DrillSessionPoint[]) {
  const n = pts.reduce((s, p) => s + p.n, 0);
  return n ? { value: pts.reduce((s, p) => s + p.value * p.n, 0) / n, n, sessions: pts.length } : null;
}

export interface DrillShotSession { start: string; drill: string; n: number; makes: number }

/** Kept Railbird shots per drill session (session type = drill name). */
export function drillShotSessions(rows: { shot: Shot; y: number }[]): DrillShotSession[] {
  const m = new Map<number, DrillShotSession>();
  for (const r of rows) {
    const s = r.shot;
    if (s.sessionType === 'Free play' || s.sessionType === 'Other drill') continue;
    const x = m.get(s.sessionId) ?? m.set(s.sessionId, { start: s.sessionStart, drill: s.sessionType, n: 0, makes: 0 }).get(s.sessionId)!;
    x.n++; x.makes += r.y;
  }
  return [...m.values()].sort((a, b) => (a.start < b.start ? -1 : 1));
}

export function drillMeters(drills: DrillDef[], shotSessions: DrillShotSession[], tallies: TallySession[], games: Game[] = []): DrillMeter[] {
  const out: DrillMeter[] = [];
  for (const d of drills) {
    const railbird: DrillSessionPoint[] = shotSessions.filter(s => s.drill === d.name)
      .map(s => ({ date: s.start, n: s.n, value: s.makes / s.n, detail: `${s.makes} of ${s.n} recorded`, source: 'railbird' }));
    const ts = tallies.filter(t => t.drillId === d.id && t.events.length).sort((a, b) => (a.started < b.started ? -1 : 1));
    let kind: DrillMeter['kind'] = 'reps', unit = 'make rate', points = railbird, target = d.target?.minimum ?? 20, max = 1;
    const extra: string[] = [];
    const bowl = d.scorer === 'bowling'
      ? games.filter((g): g is BowlingGame => g.kind === 'bowling' && bowlingTotal(g) != null).sort((a, b) => (a.date < b.date ? -1 : 1)) : [];

    if (bowl.length) {
      kind = 'score'; unit = 'game score'; target = 1; max = 300;
      points = bowl.map(g => ({ date: g.date, n: 1, value: bowlingTotal(g)!, detail: `${bowlingTotal(g)}`, source: 'tally' as const }));
      const st = bowlingStats(bowl);
      if (st.strikeRate != null) extra.push(`Strikes on ${Math.round(100 * st.strikeRate)}% of frames, spares on ${Math.round(100 * st.spareRate!)}%; ${st.firstInning!.toFixed(1)} balls run in a first inning.`);
      if (st.best != null) extra.push(`Best game ${st.best}.`);
    } else
    if (d.counters === 'completion' && ts.length) {
      kind = 'completion'; unit = 'racks run out'; target = 3;
      points = ts.map(t => {
        const c = completionSummary(t, d.ballsPerRack ?? 9);
        return { date: t.started, n: c.racks, value: c.racks ? c.completed / c.racks : 0, detail: `${c.completed} of ${c.racks} ${c.racks === 1 ? 'rack' : 'racks'} · ${c.ballsPerRack.toFixed(1)} balls a rack`, source: 'tally' as const };
      }).filter(p => p.n > 0);
      const all = completionSummary(ts, d.ballsPerRack ?? 9);
      if (all.learning) extra.push(`${all.learning} learning ${all.learning === 1 ? 'rack' : 'racks'} (ball in hand) left out.`);
      if (all.racks) {
        extra.push(`${all.racks} ${all.racks === 1 ? 'rack' : 'racks'} tapped: ${all.completed} run out, ${all.missedAt.length} ended on a miss, ${all.outOfLineAt.length} out of line${all.endedAt.length ? `, ${all.endedAt.length} with no reason recorded` : ''}.`);
        if (all.shotsAttempted) {
          const last = completionSummary(ts[ts.length - 1], d.ballsPerRack ?? 9);
          extra.push(`Tapped make rate ${Math.round((100 * all.makes) / all.shotsAttempted)}%: ${all.makes} of ${all.shotsAttempted} shots${ts.length > 1 && last.shotsAttempted ? `; last session ${Math.round((100 * last.makes) / last.shotsAttempted)}% (${last.makes} of ${last.shotsAttempted})` : ''}. A miss counts as a shot taken; leaving a rack out of line doesn't.`);
        }
        const worst = [...all.ends].sort((a, b) => (b.missed + b.outOfLine + b.unknown) - (a.missed + a.outOfLine + a.unknown))[0];
        if (worst && worst.missed + worst.outOfLine + worst.unknown >= 2) extra.push(`Most racks end on the ${worst.ball} ball (${worst.missed} missed, ${worst.outOfLine} out of line).`);
      }
    } else if (d.counters === 'diagnostic' && ts.length) {
      kind = 'diagnostic'; unit = 'make rate (tapped)'; target = 20;
      let thick = 0, thin = 0;
      points = ts.map(t => {
        const c = diagnosticCounts(t);
        let makes = 0, att = 0;
        for (const blk of Object.values(c)) for (const side of ['L', 'R'] as const) {
          const x = blk[side]; makes += x.make; att += x.make + x.thick + x.thin; thick += x.thick; thin += x.thin;
        }
        return { date: t.started, n: att, value: att ? makes / att : 0, detail: `${makes} of ${att} tapped`, source: 'tally' as const };
      }).filter(p => p.n > 0);
      if (thick + thin) extra.push(`Misses: ${thick} thick, ${thin} thin (${Math.round((100 * thick) / (thick + thin))}% thick).`);
    }
    if (!points.length && !railbird.length) continue;
    // The last five sessions against everything before; with fewer than ten, the later half against the earlier.
    const k = points.length >= 2 * RECENT ? RECENT : Math.max(1, Math.floor(points.length / 2));
    const recentPts = points.slice(-k), earlierPts = points.slice(0, points.length - k);
    out.push({ drill: d, kind, unit, points, railbird, recent: pool(recentPts), earlier: pool(earlierPts), extra, target, max });
  }
  return out;
}

// ---------- dated notes ----------

export type NoteKind = 'technique' | 'equipment' | 'coach' | 'other';
export interface Note { id: string; date: string; text: string; kind: NoteKind }   // date = YYYY-MM-DD (local)

export const NOTE_KIND_LABEL: Record<NoteKind, string> = { technique: 'Technique', equipment: 'Equipment', coach: 'Coach or chatbot summary', other: 'Other' };

/** Notes plus post-session tally notes, oldest first, numbered for chart markers. */
export function timelineNotes(notes: Note[], tallies: TallySession[]): (Note & { n: number; fromTally?: string })[] {
  const all: (Note & { fromTally?: string })[] = [
    ...notes,
    ...tallies.filter(t => t.note?.trim()).map(t => ({ id: `tally:${t.id}`, date: localDate(t.started), text: t.note!.trim(), kind: 'other' as NoteKind, fromTally: t.drillName })),
  ];
  return all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1)).map((x, i) => ({ ...x, n: i + 1 }));
}
