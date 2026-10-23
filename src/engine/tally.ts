import type { Shot } from './schema';
import type { Exclusions } from './rules';
import { matchDrill, type DiagKey, type DrillDef, type Side } from './drills';

// Tallies are taps recorded on the phone while Railbird films. Every tap is
// timestamped so it can later be lined up with Railbird's shot times.

// Completion drills: 'complete' = ran out; 'missed' = missed ball N; 'outOfLine' =
// abandoned on ball N without shooting it (position lost). 'ended' is the earlier
// reason-less form ("run ended at ball N"), still read for old tallies.
export type TallyKey = DiagKey | 'complete' | 'missed' | 'outOfLine' | 'ended' | 'miss';

export interface TallyEvent {
  t: string;            // ISO timestamp of the tap
  key: TallyKey;
  block?: string;       // diagnostic block id ('A', 'F', 'M')
  side?: Side;
  ball?: number;        // completion drills: the ball the rack ended on (1…N)
  learning?: true;      // played with ball in hand on every shot: kept out of the drill's stats
  res?: string;         // progressive drills: the outcome tapped (or the miss direction)
  ph?: string;          // progressive drills: the phase (follow / stop / draw …)
}

export interface TallySession {
  id: string;
  drillId: string;
  drillName: string;
  device: string;       // which device recorded it
  started: string;
  updated: string;
  ended?: string;
  events: TallyEvent[];
  note?: string;
  learning?: boolean;   // the Learning (ball in hand) switch, as last set
  level?: number;       // progressive drills: the level played (1–3)
  variant?: string;     // drills with variants: e.g. the speed for basic stop shots
  target?: number;      // drills with a chosen set size: makes in this set
}

export interface TallyFile {
  app: 'electro-coach';
  kind: 'tallies';
  version: 1;
  exportedAt: string;
  device: string;
  sessions: TallySession[];
}

export function newTallyId(now = new Date()) {
  return `${now.toISOString()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Calendar date (YYYY-MM-DD) in the device's own time zone. */
export function localDate(iso: string): string {
  const d = new Date(iso);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

// ---------- summaries ----------

export interface CellCounts { make: number; thick: number; thin: number; rail: number; pocket: number }
const zero = (): CellCounts => ({ make: 0, thick: 0, thin: 0, rail: 0, pocket: 0 });

/** Diagnostic counts per block and side: counts[block][side]. */
export function diagnosticCounts(s: TallySession): Record<string, Record<Side, CellCounts>> {
  const out: Record<string, Record<Side, CellCounts>> = {};
  for (const e of s.events) {
    if (!e.block || !e.side) continue;
    if (!['make', 'thick', 'thin', 'rail', 'pocket'].includes(e.key)) continue;
    out[e.block] ??= { L: zero(), R: zero() };
    out[e.block][e.side][e.key as DiagKey]++;
  }
  return out;
}

export interface BallEnds { ball: number; missed: number; outOfLine: number; unknown: number }

export interface CompletionSummary {
  racks: number;
  completed: number;            // ran out
  missedAt: number[];           // ball missed
  outOfLineAt: number[];        // ball abandoned on (not shot)
  endedAt: number[];            // older tallies: run ended at ball, reason not recorded
  shotsAttempted: number;
  makes: number;
  ballsPerRack: number;         // average balls made per rack
  ends: BallEnds[];             // per ball: how racks ended there
  learning: number;             // learning racks (ball in hand), left out of everything above
}

export type LearningRule = 'exclude' | 'include' | 'only';
const RACK_END = new Set(['complete', 'missed', 'outOfLine', 'ended']);
/** Number of rack-ending taps made with the Learning switch on. */
export const learningRacks = (s: TallySession | TallySession[]) =>
  (Array.isArray(s) ? s : [s]).reduce((n, t) => n + t.events.filter(e => e.learning && RACK_END.has(e.key)).length, 0);

/**
 * Balls made per rack: a run-out makes all N; a miss on ball k makes k − 1 and
 * attempts k; abandoning on ball k (out of line) makes k − 1 and attempts k − 1.
 */
export function completionSummary(s: TallySession | TallySession[], ballsPerRack = 9, rule: LearningRule = 'exclude'): CompletionSummary {
  const list = Array.isArray(s) ? s : [s];
  let completed = 0;
  const missedAt: number[] = [], outOfLineAt: number[] = [], endedAt: number[] = [];
  for (const t of list) for (const e of t.events) {
    if (rule === 'exclude' ? e.learning : rule === 'only' ? !e.learning : false) continue;
    if (e.key === 'complete') completed++;
    else if (e.key === 'missed' && e.ball) missedAt.push(e.ball);
    else if (e.key === 'outOfLine' && e.ball) outOfLineAt.push(e.ball);
    else if (e.key === 'ended' && e.ball) endedAt.push(e.ball);
  }
  const sum = (a: number[], f: (b: number) => number) => a.reduce((acc, b) => acc + f(b), 0);
  const racks = completed + missedAt.length + outOfLineAt.length + endedAt.length;
  const makes = completed * ballsPerRack + sum([...missedAt, ...outOfLineAt, ...endedAt], b => b - 1);
  const ends: BallEnds[] = Array.from({ length: ballsPerRack }, (_, i) => ({ ball: i + 1, missed: 0, outOfLine: 0, unknown: 0 }));
  for (const b of missedAt) if (ends[b - 1]) ends[b - 1].missed++;
  for (const b of outOfLineAt) if (ends[b - 1]) ends[b - 1].outOfLine++;
  for (const b of endedAt) if (ends[b - 1]) ends[b - 1].unknown++;
  return {
    racks, completed, missedAt, outOfLineAt, endedAt,
    shotsAttempted: completed * ballsPerRack + sum(missedAt, b => b) + sum(outOfLineAt, b => b - 1) + sum(endedAt, b => b),
    makes,
    ballsPerRack: racks ? makes / racks : 0,
    ends,
    learning: rule === 'exclude' ? learningRacks(list) : 0,
  };
}

/** Makes and attempts per side for any tally session (diagnostic or completion). */
export function tappedBySide(s: TallySession): Record<Side, { makes: number; attempts: number }> {
  const out = { L: { makes: 0, attempts: 0 }, R: { makes: 0, attempts: 0 } };
  for (const e of s.events) {
    if (!e.side) continue;
    if (e.key === 'make') { out[e.side].makes++; out[e.side].attempts++; }
    else if (e.key === 'thick' || e.key === 'thin') out[e.side].attempts++;
  }
  return out;
}

// ---------- capture check ----------

export interface CaptureRow {
  tallyId: string;
  drillName: string;
  date: string;                       // local date shared by the tally and the Railbird sessions
  railbirdSessions: number[];
  tapped: { makes: number; attempts: number };
  recorded: { makes: number; shots: number };
  capture: number | null;             // recorded makes ÷ tapped makes
  bySide?: Record<Side, { tapped: number; recorded: number; capture: number | null }>;
}

/**
 * Compare tapped makes with what Railbird recorded for the same drill on the same
 * local date. Duplicate records are left out of Railbird's count; every other
 * stored shot counts, because the question is what Railbird captured, not what
 * the analysis keeps.
 */
export function captureCheck(tallies: TallySession[], shots: Shot[], ex: Exclusions, drills: DrillDef[]): CaptureRow[] {
  const byDrill = new Map<string, Shot[]>();
  for (const s of shots) {
    if (ex.get(s.shotId)?.includes('duplicate')) continue;
    const d = matchDrill(drills, s.tags, s.gameTypes, s.sessionName);
    if (!d) continue;
    const key = `${d.id}|${localDate(s.sessionStart)}`;
    (byDrill.get(key) ?? byDrill.set(key, []).get(key)!).push(s);
  }
  const rows: CaptureRow[] = [];
  for (const t of tallies) {
    const d = drills.find(x => x.id === t.drillId);
    if (!d || d.counters === 'none') continue;
    const date = localDate(t.started);
    const rb = byDrill.get(`${d.id}|${date}`) ?? [];
    let tapped: { makes: number; attempts: number };
    let bySide: CaptureRow['bySide'];
    if (d.counters === 'completion') {
      // Learning racks are still filmed, so they count here.
      const c = completionSummary(t, d.ballsPerRack ?? 9, 'include');
      tapped = { makes: c.makes, attempts: c.shotsAttempted };
    } else {
      const s = tappedBySide(t);
      tapped = { makes: s.L.makes + s.R.makes, attempts: s.L.attempts + s.R.attempts };
      const rec = (side: 'LEFT' | 'RIGHT') => rb.filter(x => x.direction === side && x.make).length;
      const cap = (r: number, tp: number) => (tp ? r / tp : null);
      bySide = {
        L: { tapped: s.L.makes, recorded: rec('LEFT'), capture: cap(rec('LEFT'), s.L.makes) },
        R: { tapped: s.R.makes, recorded: rec('RIGHT'), capture: cap(rec('RIGHT'), s.R.makes) },
      };
    }
    const recMakes = rb.filter(x => x.make).length;
    rows.push({
      tallyId: t.id, drillName: d.name, date,
      railbirdSessions: [...new Set(rb.map(x => x.sessionId))],
      tapped, recorded: { makes: recMakes, shots: rb.length },
      capture: tapped.makes ? recMakes / tapped.makes : null,
      bySide,
    });
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
}

// ---------- transfer between devices ----------

export function makeTallyFile(sessions: TallySession[], device: string): TallyFile {
  return { app: 'electro-coach', kind: 'tallies', version: 1, exportedAt: new Date().toISOString(), device, sessions };
}

export function parseTallyFile(text: string): TallyFile {
  let j: any;
  try { j = JSON.parse(text.trim()); } catch { throw new Error('the text is not a tally file (it is not valid JSON).'); }
  if (j?.app !== 'electro-coach' || !Array.isArray(j.sessions)) {
    // A full backup also carries tallies — accept it.
    if (j?.app === 'electro-coach' && Array.isArray(j.tallies)) return { ...j, kind: 'tallies', sessions: j.tallies };
    throw new Error('this is not an Electro-Coach tally file.');
  }
  for (const s of j.sessions) if (typeof s.id !== 'string' || !Array.isArray(s.events)) throw new Error('a session in the file is malformed.');
  return j as TallyFile;
}

/** Merge incoming sessions; for the same id the most recently updated copy wins. */
export function mergeTallies(existing: TallySession[], incoming: TallySession[]) {
  const map = new Map(existing.map(s => [s.id, s]));
  let added = 0, updated = 0, unchanged = 0;
  for (const s of incoming) {
    const old = map.get(s.id);
    if (!old) { map.set(s.id, s); added++; }
    else if (s.updated > old.updated) { map.set(s.id, s); updated++; }
    else unchanged++;
  }
  return { sessions: [...map.values()], added, updated, unchanged };
}
