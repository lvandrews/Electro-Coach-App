import type { PracticeSession } from './session';

// Scored games kept in the app itself (no Railbird data): 10-ball bowling and
// straight pool (14.1 continuous). Both are stored as plain records so they back up,
// move between devices and chart like everything else.

// ---------- 10-ball bowling ----------
// A frame is one rack of ten balls with up to two innings, scored like ten-pin bowling:
// all ten in the first inning is a strike (10 + next two innings), all ten across both
// innings is a spare (10 + next inning). The tenth frame earns its bonus innings.
// 300 is a perfect game.

/** The table a game was played on (all optional). */
export interface TableInfo { brand?: string; model?: string; size?: '7ft' | '8ft' | '9ft' | '10ft'; pocketIn?: number }
export interface Played { venue?: string; table?: TableInfo }

export const POCKET_SIZES: { v: number; label: string }[] = [
  { v: 4, label: '4″' }, { v: 4.125, label: '4⅛″' }, { v: 4.25, label: '4¼″' }, { v: 4.5, label: '4½″' },
  { v: 4.75, label: '4¾″' }, { v: 5, label: '5″' }, { v: 5.25, label: '5¼″' },
];

/** "Family Billiards · Diamond Professional · 9 ft · 4½″ pockets" (empty when nothing is noted). */
export function playedText(p: Played, opts: { ascii?: boolean } = {}): string {
  const t = p.table ?? {};
  let pk = POCKET_SIZES.find(x => x.v === t.pocketIn)?.label ?? (t.pocketIn ? `${t.pocketIn}″` : '');
  if (opts.ascii && t.pocketIn) pk = `${t.pocketIn} in`;    // the PDF's standard font has no fraction glyphs
  return [p.venue, [t.brand, t.model].filter(Boolean).join(' '), t.size && t.size.replace('ft', ' ft'), pk && `${pk} pockets`].filter(Boolean).join(' · ');
}

export interface BowlingGame {
  id: string;
  kind: 'bowling';
  date: string;               // ISO, when the game started (or the date entered)
  updated: string;
  frames: number[][] | null;  // balls made per inning, frame by frame; null for a total-only entry
  total?: number;             // games entered or imported as a final score only
  source: 'scored' | 'entered' | 'imported';
  device: string;
  note?: string;
  venue?: string;
  table?: TableInfo;
}

export interface BowlingCard {
  marks: string[][];          // what the score sheet shows per inning: 'X', '/', '–' or a number
  cumulative: (number | null)[];
  total: number | null;       // null until the game is complete
  complete: boolean;
  next: { frame: number; inning: number; max: number } | null;   // the next inning to enter
}

/** Largest legal count for the next inning, or null when the game is over. */
function nextInning(frames: number[][]): { frame: number; inning: number; max: number } | null {
  const f = frames.length ? frames.length - 1 : 0;
  const cur = frames[f] ?? [];
  if (!frames.length) return { frame: 0, inning: 0, max: 10 };
  if (f < 9) {
    if (cur.length === 0) return { frame: f, inning: 0, max: 10 };
    if (cur.length === 1 && cur[0] < 10) return { frame: f, inning: 1, max: 10 - cur[0] };
    return { frame: f + 1, inning: 0, max: 10 };
  }
  // tenth frame
  const [a, b] = cur;
  if (cur.length === 0) return { frame: 9, inning: 0, max: 10 };
  if (cur.length === 1) return { frame: 9, inning: 1, max: a === 10 ? 10 : 10 - a };
  if (cur.length === 2) {
    if (a === 10) return { frame: 9, inning: 2, max: b === 10 ? 10 : 10 - b };
    if (a + b === 10) return { frame: 9, inning: 2, max: 10 };
  }
  return null;
}

export function bowlingCard(frames: number[][]): BowlingCard {
  const rolls: number[] = [], starts: number[] = [];
  frames.forEach(fr => { starts.push(rolls.length); rolls.push(...fr); });
  const cumulative: (number | null)[] = [];
  let run = 0, known = true;
  for (let f = 0; f < 10; f++) {
    const fr = frames[f];
    if (!fr || !known) { cumulative.push(null); continue; }
    const i = starts[f];
    let v: number | null;
    if (f === 9) {
      const need = fr[0] === 10 || (fr.length >= 2 && fr[0] + fr[1] === 10) ? 3 : 2;
      v = fr.length >= need ? fr.reduce((s, x) => s + x, 0) : null;
    } else if (fr[0] === 10) v = rolls.length >= i + 3 ? 10 + rolls[i + 1] + rolls[i + 2] : null;
    else if (fr.length < 2) v = null;
    else if (fr[0] + fr[1] === 10) v = rolls.length >= i + 3 ? 10 + rolls[i + 2] : null;
    else v = fr[0] + fr[1];
    if (v == null) { known = false; cumulative.push(null); continue; }
    run += v; cumulative.push(run);
  }
  const marks = frames.map((fr, f) => fr.map((x, k) => {
    if (f < 9) return k === 0 ? (x === 10 ? 'X' : x === 0 ? '–' : String(x)) : (fr[0] + x === 10 ? '/' : x === 0 ? '–' : String(x));
    const prev = fr[k - 1];
    const fresh = k === 0 || prev === 10 || (k === 2 && fr[0] !== 10 && fr[0] + fr[1] === 10) || (k === 2 && fr[0] === 10 && fr[1] === 10);
    if (fresh) return x === 10 ? 'X' : x === 0 ? '–' : String(x);
    return prev + x === 10 ? '/' : x === 0 ? '–' : String(x);
  }));
  const next = nextInning(frames);
  const complete = next == null && frames.length === 10;
  return { marks, cumulative, total: complete ? cumulative[9] : null, complete, next };
}

/** Add one inning's count to a game in progress (ignored if not legal). */
export function addInning(frames: number[][], balls: number): number[][] {
  const n = nextInning(frames);
  if (!n || balls < 0 || balls > n.max || !Number.isInteger(balls)) return frames;
  const out = frames.map(f => [...f]);
  if (n.frame >= out.length) out.push([]);
  out[n.frame].push(balls);
  return out;
}
export function undoInning(frames: number[][]): number[][] {
  const out = frames.map(f => [...f]);
  if (!out.length) return out;
  out[out.length - 1].pop();
  if (!out[out.length - 1].length) out.pop();
  return out;
}

export const bowlingTotal = (g: BowlingGame): number | null => (g.frames ? bowlingCard(g.frames).total : g.total ?? null);

export interface BowlingStats { games: number; average: number | null; best: number | null; strikeRate: number | null; spareRate: number | null; firstInning: number | null }
/** Strike and spare rates use frames 1–10 of fully scored games only. */
export function bowlingStats(games: BowlingGame[]): BowlingStats {
  const totals = games.map(bowlingTotal).filter((x): x is number => x != null);
  let frames = 0, strikes = 0, spares = 0, first = 0;
  for (const g of games) {
    if (!g.frames || !bowlingCard(g.frames).complete) continue;
    for (const fr of g.frames.slice(0, 10)) {
      frames++; first += fr[0];
      if (fr[0] === 10) strikes++; else if (fr[0] + (fr[1] ?? 0) === 10) spares++;
    }
  }
  return {
    games: totals.length, average: totals.length ? totals.reduce((s, x) => s + x, 0) / totals.length : null,
    best: totals.length ? Math.max(...totals) : null,
    strikeRate: frames ? strikes / frames : null, spareRate: frames ? spares / frames : null, firstInning: frames ? first / frames : null,
  };
}

// ---------- straight pool (14.1 continuous) ----------
// Points are balls pocketed. A foul costs 1; a foul on the opening break costs 2; a
// third foul in a row costs a further 15. Fourteen balls are re-racked when one
// remains. A match is a race to a point total.

export type InningEnd = 'open' | 'miss' | 'safety' | 'foul' | 'breakFoul' | 'win';
export interface Inning { p: 0 | 1; balls: number; end: InningEnd; rebreak?: boolean }   // rebreak: after a break foul, the opponent made the breaker break again (false = accepted the table)

export interface StraightPoolMatch {
  id: string;
  kind: 'straight-pool';
  date: string;
  updated: string;
  players: [string, string];      // players[0] is you
  raceTo: number;
  first: 0 | 1;                   // who broke
  innings: Inning[];
  ended?: string;
  device: string;
  note?: string;
  venue?: string;                 // where it was played (optional)
  table?: TableInfo;
}

export interface SPState {
  score: [number, number];
  balls: [number, number];          // balls pocketed
  innings: [number, number];        // innings played (the current one included once a ball is made or it ends)
  highRun: [number, number];
  consecutiveFouls: [number, number];
  shooter: 0 | 1;
  run: number;                      // balls in the current inning
  onTable: number;                  // object balls on the table
  rerack: boolean;                  // one ball left: re-rack fourteen before the next shot
  winner: 0 | 1 | null;
  opening: boolean;                 // a break is due (start, re-break, or after a three-foul penalty): a break foul is possible
  breakChoice: boolean;             // a break foul was just called: accept the table or break again?
}

export function spState(m: StraightPoolMatch): SPState {
  const score: [number, number] = [0, 0], balls: [number, number] = [0, 0], inn: [number, number] = [0, 0], high: [number, number] = [0, 0], cf: [number, number] = [0, 0];
  let winner: 0 | 1 | null = null, table = 15, rebreakBy: 0 | 1 | null = null;
  m.innings.forEach((i, k) => {
    const p = i.p;
    rebreakBy = null;
    score[p] += i.balls; balls[p] += i.balls;
    // Fourteen down and one left: the fourteen are re-racked before the next ball counts.
    for (let b = 0; b < i.balls; b++) { if (table === 1) table = 15; table--; }
    high[p] = Math.max(high[p], i.balls);
    if (i.end !== 'open' || i.balls > 0) inn[p]++;
    if (i.end === 'foul') {
      cf[p] = i.balls > 0 ? 1 : cf[p] + 1;
      score[p] -= 1;
      // Third foul in a row: a further 15 off, all fifteen re-racked, and the offender breaks again.
      if (cf[p] === 3) { score[p] -= 15; cf[p] = 0; table = 15; if (k === m.innings.length - 1) rebreakBy = p; }
    } else if (i.end === 'breakFoul') {
      score[p] -= 2;                       // breaking fouls don't count toward three in a row
      if (i.rebreak) { table = 15; if (k === m.innings.length - 1) rebreakBy = p; }
    }
    else if (i.end !== 'open' || i.balls > 0) cf[p] = 0;
    if (i.end === 'win') winner = p;
  });
  const last = m.innings[m.innings.length - 1];
  const open = last && last.end === 'open' ? last : null;
  const prev = open ? m.innings[m.innings.length - 2] : last;
  const shooter: 0 | 1 = open ? open.p : !last ? m.first : last.end === 'win' ? last.p : rebreakBy ?? ((1 - last.p) as 0 | 1);
  // A break is due at the start, after a re-break is called, and after a three-foul penalty.
  const breakDue = !prev || (prev.end === 'breakFoul' && !!prev.rebreak) || (prev.end === 'foul' && afterThirdFoul(m, m.innings.indexOf(prev)));
  return {
    score, balls, innings: inn, highRun: high, consecutiveFouls: cf, shooter, run: open?.balls ?? 0,
    onTable: table, rerack: table === 1, winner, opening: breakDue && (!open || open.balls === 0),
    breakChoice: !open && last?.end === 'breakFoul' && last.rebreak == null,
  };
}

/** Whether inning k was a player's third foul in a row (the 15-point penalty). */
function afterThirdFoul(m: StraightPoolMatch, k: number): boolean {
  if (k < 0) return false;
  const p = m.innings[k].p;
  let run = 0;
  for (let j = 0; j <= k; j++) {
    const i = m.innings[j];
    if (i.p !== p) continue;
    if (i.end === 'foul') { run = i.balls > 0 ? 1 : run + 1; if (run === 3) { if (j === k) return true; run = 0; } }
    else if (i.end !== 'breakFoul' && (i.end !== 'open' || i.balls > 0)) run = 0;
  }
  return false;
}

/** After a break foul: the opponent accepts the table, or makes the breaker break again. */
export function spBreakChoice(m: StraightPoolMatch, rebreak: boolean): StraightPoolMatch {
  const inns = m.innings.map(i => ({ ...i }));
  const last = inns[inns.length - 1];
  if (!last || last.end !== 'breakFoul') return m;
  last.rebreak = rebreak;
  return { ...m, innings: inns };
}

function withOpen(m: StraightPoolMatch): Inning[] {
  const inns = m.innings.map(i => ({ ...i }));
  const last = inns[inns.length - 1];
  if (!last || last.end !== 'open') inns.push({ p: spState(m).shooter, balls: 0, end: 'open' });
  return inns;
}

/** One ball pocketed by the shooter; ends the match when they reach the race. */
export function spBall(m: StraightPoolMatch): StraightPoolMatch {
  if (spState(m).winner != null) return m;
  const inns = withOpen(m);
  const cur = inns[inns.length - 1];
  cur.balls++;
  const next = { ...m, innings: inns };
  if (spState(next).score[cur.p] >= m.raceTo) cur.end = 'win';
  return next;
}

/** End the shooter's inning. */
export function spEnd(m: StraightPoolMatch, end: Exclude<InningEnd, 'open' | 'win'>): StraightPoolMatch {
  if (spState(m).winner != null) return m;
  const inns = withOpen(m);
  inns[inns.length - 1].end = end;
  return { ...m, innings: inns };
}

export function spUndo(m: StraightPoolMatch): StraightPoolMatch {
  const inns = m.innings.map(i => ({ ...i }));
  const last = inns[inns.length - 1];
  if (!last) return m;
  if (last.end === 'breakFoul' && last.rebreak != null) { delete last.rebreak; return { ...m, innings: inns }; }
  if (last.end === 'win') { last.end = 'open'; last.balls--; }
  else if (last.end !== 'open') last.end = 'open';
  else if (last.balls > 0) last.balls--;
  else { inns.pop(); const prev = inns[inns.length - 1]; if (prev) prev.end = 'open'; }
  if (inns.length && inns[inns.length - 1].end === 'open' && inns[inns.length - 1].balls === 0 && inns.length === 1) inns.pop();
  return { ...m, innings: inns };
}

/** Balls per inning for one player (the standard 14.1 skill measure). */
export const bpi = (s: SPState, p: 0 | 1) => (s.innings[p] ? s.balls[p] / s.innings[p] : null);

export type Game = BowlingGame | StraightPoolMatch | PracticeSession;
export const newGameId = () => `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 7)}`;
