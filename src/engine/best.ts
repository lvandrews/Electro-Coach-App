import type { ModelRow } from './model';

// "Your best shot": a kind of shot you make reliably, described in the terms you
// would set it up in (cut, distance, speed, spin). Shots are grouped by those four;
// the group with the highest make rate you can count on wins, judged by the lower end
// of its 95% range so a lucky handful can't beat a long record.

export interface Band { lo: number; hi: number; label: string }

export const CUT_BANDS: Band[] = [
  { lo: 0, hi: 10, label: 'near-straight (0–10°)' }, { lo: 10, hi: 20, label: '10–20° cut' }, { lo: 20, hi: 30, label: '20–30° cut' },
  { lo: 30, hi: 45, label: '30–45° cut' }, { lo: 45, hi: 60, label: '45–60° cut' }, { lo: 60, hi: 90, label: 'thin cut (60°+)' },
];
// Hangers (object ball within a foot of the pocket) are left out: they say little.
export const DIST_BANDS: Band[] = [
  { lo: 1, hi: 2, label: '1–2 ft' }, { lo: 2, hi: 3, label: '2–3 ft' },
  { lo: 3, hi: 4.5, label: '3–4½ ft' }, { lo: 4.5, hi: 99, label: 'over 4½ ft' },
];
export const SPEED_BANDS: Band[] = [
  { lo: 1.5, hi: 4, label: 'soft (under 4 mph)' }, { lo: 4, hi: 8, label: 'easy (4–7 mph)' },
  { lo: 8, hi: 12, label: 'firm (8–11 mph)' }, { lo: 12, hi: 99, label: 'hard (12+ mph)' },
];
export const SPIN_LABEL: Record<string, string> = { FOLLOW: 'follow', DRAW: 'draw', CENTER: 'stun (tangent line)' };

export interface BestShot {
  cut: Band; objDist: Band; speed: Band; spin: string;
  n: number; made: number; rate: number; lo: number; sessions: number;
  cornerShare: number;   // share of these shots into corner pockets
  recent: { n: number; made: number } | null;   // last 90 days
}

const MIN_N = 30, MIN_SESSIONS = 5;
const DAY = 86400000;

/** Wilson score interval, lower end (95%). */
export function wilsonLo(made: number, n: number, z = 1.96) {
  if (!n) return 0;
  const p = made / n, d = 1 + (z * z) / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
}

const pick = (bands: Band[], v: number | null) => (v == null ? -1 : bands.findIndex(b => v >= b.lo && v < b.hi));

export function bestShots(rows: ModelRow[], top = 3): BestShot[] {
  const cells = new Map<string, ModelRow[]>();
  for (const r of rows) {
    const s = r.shot;
    if (!s.spin || !SPIN_LABEL[s.spin]) continue;
    const c = pick(CUT_BANDS, s.cutDeg), d = pick(DIST_BANDS, s.objPktIn == null ? null : s.objPktIn / 12), v = pick(SPEED_BANDS, s.mph);
    if (c < 0 || d < 0 || v < 0) continue;
    const k = `${c}|${d}|${v}|${s.spin}`;
    (cells.get(k) ?? cells.set(k, []).get(k)!).push(r);
  }
  const now = Math.max(0, ...rows.map(r => Date.parse(r.shot.sessionStart) || 0));
  const out: BestShot[] = [];
  for (const [k, rs] of cells) {
    const sessions = new Set(rs.map(r => r.shot.sessionId)).size;
    if (rs.length < MIN_N || sessions < MIN_SESSIONS) continue;
    const [c, d, v, spin] = k.split('|');
    const made = rs.reduce((s, r) => s + r.y, 0);
    const rec = rs.filter(r => Date.parse(r.shot.sessionStart) > now - 90 * DAY);
    out.push({
      cut: CUT_BANDS[+c], objDist: DIST_BANDS[+d], speed: SPEED_BANDS[+v], spin,
      n: rs.length, made, rate: made / rs.length, lo: wilsonLo(made, rs.length), sessions,
      cornerShare: rs.filter(r => r.shot.pocketType === 'CORNER').length / rs.length,
      recent: rec.length ? { n: rec.length, made: rec.reduce((s, r) => s + r.y, 0) } : null,
    });
  }
  return out.sort((a, b) => b.lo - a.lo).slice(0, top);
}

/** "Follow, 10–20° cut, object ball 1–2 ft from a corner pocket, easy speed (4–7 mph)". */
export function describeShot(b: BestShot): string {
  const pocket = b.cornerShare >= 0.8 ? ' a corner pocket' : b.cornerShare <= 0.2 ? ' a side pocket' : ' the pocket';
  const spin = SPIN_LABEL[b.spin];
  return `${spin[0].toUpperCase()}${spin.slice(1)}, ${b.cut.label}, object ball ${b.objDist.label} from${pocket}, ${b.speed.label}`;
}
