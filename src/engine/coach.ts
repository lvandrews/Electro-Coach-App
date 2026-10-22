import type { ModelRow } from './model';
import type { DrillDef } from './drills';
import type { TallySession } from './tally';
import { bowlingStats, bowlingTotal, bpi, spState, type BowlingGame, type Game, type StraightPoolMatch } from './games';
import { between, drillMeters, drillShotSessions, periodSummary, progressNow, sessionPoints, timelineNotes, windowStat, type Baseline, type Note, type WindowStat } from './progress';
import { buildPlan } from './plan';
import type { PracticeSession } from './session';

// "Share with your coach AI": one plain-text summary a chatbot can read correctly.
// It starts with how to read the numbers (the frozen yardstick, O−E, ranges), then
// the current picture, then dated journal entries with the numbers around them.

export interface CoachOptions {
  days: number | null;          // period; null = all time
  journal: boolean;
  overall: boolean;
  plan: boolean;
  drills: boolean;
  sessions: boolean;
}
export const DEFAULT_COACH: CoachOptions = { days: 90, journal: true, overall: true, plan: true, drills: true, sessions: true };

const DAY = 86400000;
const d10 = (iso: string) => iso.slice(0, 10);
const pts = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(100 * x).toFixed(1)}`;
const pc = (x: number) => `${Math.round(100 * x)}%`;
const w = (s: WindowStat | null) => (s ? `${pts(s.oe)} pts${Number.isFinite(s.se) ? ` (range ${pts(s.lo)} to ${pts(s.hi)})` : ''}, ${s.n} shots in ${s.sessions} session${s.sessions === 1 ? '' : 's'}, made ${pc(s.makeRate)}` : 'no shots');

export function buildCoachSummary(o: CoachOptions, x: {
  baseline: Baseline | null; rows: ModelRow[]; notes: Note[]; tallies: TallySession[]; games: Game[]; drills: DrillDef[]; now?: Date;
}): string {
  const out: string[] = [];
  const today = x.now ?? new Date();
  const pointsAll = x.baseline ? sessionPoints(x.baseline, x.rows) : [];
  const end = pointsAll.length ? Math.max(progressNow(pointsAll), today.getTime()) : today.getTime();
  const start = o.days == null ? 0 : end - o.days * DAY;
  const inPeriod = (iso: string) => { const t = Date.parse(iso); return t >= start && t <= end + DAY; };

  out.push(`# Pool practice summary (Electro-Coach), ${d10(today.toISOString())}`);
  out.push(o.days == null ? 'Period: all recorded data.' : `Period: the last ${o.days} days (${d10(new Date(start).toISOString())} to ${d10(new Date(end).toISOString())}).`);
  out.push('');
  out.push('## How to read these numbers');
  out.push('- Shot data comes from Railbird video tracking, cleaned (impossible cut/approach angles, break shots, duplicates removed).');
  if (x.baseline) {
    out.push(`- "Made − expected" (O−E) compares makes with a difficulty model (object-ball and cue-ball distances, cut angle, pocket approach angle, speed) fitted once on ${x.baseline.n} shots from ${d10(x.baseline.from)} to ${d10(x.baseline.to)} and then frozen. 0 = the player's level over that baseline for shots of the same difficulty; +2 pts = two more makes per 100 shots than expected.`);
    out.push('- Ranges are 95% intervals clustered by session. A range that excludes 0 is a clear difference; one that includes 0 is not settled.');
  }
  out.push('- "Makes lost per 100 shots" = how many makes a weakness costs across all shots, given how often that shot comes up.');

  if (o.overall && x.baseline && pointsAll.length) {
    const s = periodSummary(pointsAll, x.baseline, progressNow(pointsAll));
    out.push('', '## Overall against the yardstick');
    out.push(`- Last 30 days: ${w(s.last30)}.`);
    out.push(`- Last 90 days: ${w(s.last90)}.`);
    out.push(`- The 90 days before that: ${w(s.prev90)}.`);
    if (s.change) out.push(`- Change, last 90 vs previous 90: ${pts(s.change.diff)} pts (range ${pts(s.change.lo)} to ${pts(s.change.hi)}).`);
  }

  if (o.plan && x.baseline && x.rows.length) {
    const period = o.days == null ? 'all' : o.days <= 90 ? '90' : o.days <= 180 ? '180' : '365';
    const p = buildPlan(x.baseline, x.rows, period);
    out.push('', '## Practice targets (weaknesses, ranked by makes lost per 100 shots)');
    if (!p.targets.length) out.push('- None stand out in this period.');
    for (const t of p.targets.slice(0, 6)) out.push(`- ${t.label}: ${t.perHundred.toFixed(1)} makes lost per 100; ${pts(t.stat.oe)} pts (range ${pts(t.stat.lo)} to ${pts(t.stat.hi)}) on ${t.n} shots, ${t.tier}.${t.overlap ? ` ${pc(t.overlap.frac)} of these shots are also "${t.overlap.label}".` : ''}`);
    out.push('', '## Strengths (ranked by makes gained per 100 shots)');
    if (!p.strengths.length) out.push('- None stand out in this period.');
    for (const t of p.strengths.slice(0, 5)) out.push(`- ${t.label}: ${Math.abs(t.perHundred).toFixed(1)} makes gained per 100; ${pts(t.stat.oe)} pts on ${t.n} shots, ${t.tier}.`);
  }

  if (o.drills) {
    const meters = drillMeters(x.drills, drillShotSessions(x.rows), x.tallies, x.games).filter(m => m.points.some(p => inPeriod(p.date)));
    const bowling = x.games.filter((g): g is BowlingGame => g.kind === 'bowling' && bowlingTotal(g) != null && inPeriod(g.date));
    const sp = x.games.filter((g): g is StraightPoolMatch => g.kind === 'straight-pool' && !!g.ended && inPeriod(g.date));
    if (meters.length || bowling.length || sp.length) out.push('', '## Drills and games');
    for (const m of meters) {
      const show = (v: number) => (m.kind === 'score' ? v.toFixed(0) : pc(v));
      const r = m.recent, e = m.earlier;
      const unitW = (n: number) => `${n} ${m.kind === 'score' ? (n === 1 ? 'game' : 'games') : (n === 1 ? 'session' : 'sessions')}`;
      out.push(`- ${m.drill.name} (${m.unit}): ${r ? `last ${unitW(r.sessions)} ${show(r.value)}` : 'no recent data'}${e ? `; earlier ${show(e.value)} over ${unitW(e.sessions)}` : ''}.${m.extra.length ? ` ${m.extra.join(' ')}` : ''}`);
    }
    if (bowling.length && !meters.some(m => m.kind === 'score')) { const st = bowlingStats(bowling); out.push(`- 10-ball bowling: ${st.games} games, average ${st.average!.toFixed(0)}, best ${st.best}.`); }
    if (sp.length) {
      const v = sp.map(m => bpi(spState(m), 0)).filter((y): y is number => y != null);
      out.push(`- Straight pool: ${sp.length} match${sp.length === 1 ? '' : 'es'}; balls per inning ${v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : '—'}; high run ${Math.max(0, ...sp.map(m => spState(m).highRun[0]))}.`);
    }
    const practice = x.games.filter((g): g is PracticeSession => g.kind === 'practice' && !!g.ended && inPeriod(g.date));
    if (practice.length) {
      out.push(`- Timed practice sessions: ${practice.length}; most recent ${d10(practice[practice.length - 1].date)}: ${practice[practice.length - 1].blocks.map(b => `${b.title} ${b.minutes}′`).join(', ')}.`);
    }
  }

  if (o.journal) {
    const notes = timelineNotes(x.notes, x.tallies).filter(n => inPeriod(`${n.date}T12:00:00`));
    out.push('', '## Journal (dated)');
    if (!notes.length) out.push('- No entries in this period.');
    for (const n of notes) {
      let around = '';
      if (x.baseline && pointsAll.length) {
        const t = Date.parse(`${n.date}T12:00:00`);
        const before = windowStat(between(pointsAll, t - 30 * DAY, t)), after = windowStat(between(pointsAll, t, t + 30 * DAY));
        if (before || after) around = ` [30 days before: ${before ? `${pts(before.oe)} pts on ${before.n} shots` : 'no shots'}; 30 days after: ${after ? `${pts(after.oe)} pts on ${after.n} shots` : 'no shots yet'}]`;
      }
      out.push(`- ${n.date} (${n.fromTally ? `${n.fromTally} tally` : n.kind}): ${n.text.replace(/\s*\n\s*/g, ' / ')}${around}`);
    }
  }

  if (o.sessions && x.baseline) {
    const recent = pointsAll.filter(p => inPeriod(p.start)).slice(-12).reverse();
    out.push('', '## Recent Railbird sessions');
    if (!recent.length) out.push('- None in this period.');
    for (const p of recent) out.push(`- ${d10(p.start)} ${p.sessionType === 'Free play' ? (p.name || 'Free play') : p.sessionType}: ${p.n} shots, made ${pc(p.made / p.n)}, expected ${pc(p.expected / p.n)} (${pts((p.made - p.expected) / p.n)} pts).`);
  }

  out.push('', '(Exported from Electro-Coach. Numbers are the player\'s own data; please ask before assuming anything not shown here.)');
  return out.join('\n');
}

/** Kept shots in the period as CSV (for a chatbot that can read files). */
export function shotsCsv(rows: ModelRow[], days: number | null, now = Date.now()): string {
  const start = days == null ? 0 : now - days * DAY;
  const head = ['date', 'session', 'session_type', 'table', 'make', 'cut_deg', 'obj_pocket_in', 'cue_obj_in', 'approach_deg', 'mph', 'pocket', 'direction', 'spin', 'backcut'];
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = rows.filter(r => Date.parse(r.shot.sessionStart) >= start).map(({ shot: s, y }) =>
    [d10(s.sessionStart), s.sessionName, s.sessionType, s.tableSize, y, s.cutDeg, s.objPktIn, s.cueObjIn, s.approachDeg, s.mph?.toFixed(2), s.pocketType, s.direction, s.spin, s.backcut].map(esc).join(','));
  return [head.join(','), ...lines].join('\n');
}
