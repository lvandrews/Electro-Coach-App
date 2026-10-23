import shipped from '../drills/layouts.json';
import { POCKETS, SPOTS, TABLE, cueBallPath, cutAngle, ghostBall, pocketRay, type Pt, type PocketId } from './table';
import type { MakeOutcome, ProgSpec } from './progressive';

// ---------- types ----------

export type DrillCategory = 'stroke' | 'transitions' | 'runout' | 'reps' | 'calibration';
export type CounterLevel = 'none' | 'completion' | 'diagnostic' | 'progressive';
export type DiagKey = 'make' | 'thick' | 'thin' | 'rail' | 'pocket';
export type Side = 'L' | 'R';

export interface DiagramBall { kind: 'cb' | 'ob'; x: number; y: number; num?: number; label?: string }
// Cue ball travel (cb, stun, roll, draw) is drawn as a ball-wide translucent band under the
// aim and object-ball lines, so a follow or draw path along the shot line doesn't hide it.
export interface DiagramPath { kind: 'ob' | 'cb' | 'stun' | 'roll' | 'draw' | 'aim' | 'guide'; points: Pt[]; label?: string }
export interface DiagramZone { polygon: Pt[]; tone: 'good' | 'caution' }
export interface DiagramRay { from: Pt; to: Pt; label: string; tone: 'good' | 'caution' | 'bad' }
export interface DiagramSpec {
  balls: DiagramBall[];
  paths: DiagramPath[];
  zones?: DiagramZone[];
  rays?: DiagramRay[];
  labels?: { at: Pt; text: string; anchor?: 'start' | 'middle' | 'end' }[];
  notes?: string[];
}

export interface DrillTag { value: string; label?: string }

export interface Block { id: string; name: string; keys: DiagKey[] }

export interface DrillDef {
  id: string;
  name: string;
  short?: string;                  // compact label, e.g. "D2"
  category: DrillCategory;
  tags: DrillTag[];                // tags to copy into Railbird
  railbirdBuiltIn?: 'drillx-shot' | 'drillspot-shot';
  aliases: string[];               // case-insensitive substrings of a Railbird tag that also identify this drill
  diagram: DiagramSpec | null;     // null = layout not entered yet (editable)
  editableLayout?: boolean;
  setup: string[];
  counters: CounterLevel;
  blocks?: Block[];                // diagnostic drills: one or more blocks of keys
  sides?: Side[];
  alternateMakes?: boolean;        // switch side automatically after a make
  ballsPerRack?: number;           // completion drills
  target?: { text: string; perCell?: number; minimum?: number; unit?: 'shots' | 'misses' | 'racks' | 'makes' };
  custom?: boolean;
  scorer?: 'bowling';              // scored with its own scorer instead of tapped
  learning?: string;               // how to start out on a hard drill (shown above the set-up)
  prog?: ProgSpec;                 // progressive tap drills: levels, phases and outcomes
  minutes?: number;                // first estimate of one set, before your own times take over
}

const LEARNING = 'This drill is hard. Start by taking ball in hand on every shot, placing the cue ball where your position should have left it, until the patterns feel familiar. Start logging racks once you can regularly get through several balls.';

// ---------- helpers for building diagrams ----------

const cb = (p: Pt, label?: string): DiagramBall => ({ kind: 'cb', x: p[0], y: p[1], label });
const ob = (p: Pt, label?: string, num?: number): DiagramBall => ({ kind: 'ob', x: p[0], y: p[1], label, num });

/** Aim line, object-ball path and cue-ball paths for one shot. */
function shot(cbP: Pt, obP: Pt, pocket: PocketId, cuePaths: { kind: 'stun' | 'roll' | 'draw'; spin: number; mph?: number; label?: string }[] = []): DiagramPath[] {
  const pk = POCKETS[pocket];
  const ghost = ghostBall(obP, pk);
  const out: DiagramPath[] = [
    { kind: 'aim', points: [cbP, ghost] },
    { kind: 'ob', points: [obP, pk] },
  ];
  for (const c of cuePaths) out.push({ kind: c.kind, label: c.label, points: cueBallPath(cbP, obP, pk, { spin: c.spin, mph: c.mph ?? 5 }) });
  return out;
}

/** Spin factor that gives a chosen bend (degrees) off the tangent line — used for "slight roll". */
function spinForBend(cbP: Pt, obP: Pt, pocket: PocketId, bendDeg: number): number {
  const pk = POCKETS[pocket];
  const th = (cutAngle(cbP, obP, pk) * Math.PI) / 180;
  // bend = atan((2/7)·k·cosθ / ((5/7)·sinθ + (2/7)·k·sinθ … )) — solve numerically
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const k = (lo + hi) / 2;
    const along = (2 / 7) * k * Math.cos(th), tang = (5 / 7) * Math.sin(th) + (2 / 7) * k * Math.sin(th);
    if ((Math.atan2(along, tang) * 180) / Math.PI < bendDeg) lo = k; else hi = k;
  }
  return (lo + hi) / 2;
}

// ---------- drill layouts (handoff spec §4) ----------

const D0_OB: Pt = [16.67, 75], D0_CB: Pt = [16.67, 37.5];
const D0R_OB: Pt = [33.33, 75], D0R_CB: Pt = [33.33, 37.5];

const d0: DiagramSpec = {
  balls: [ob(D0_OB), cb(D0_CB)],
  paths: shot(D0_CB, D0_OB, 'TL', [
    { kind: 'stun', spin: 0, mph: 7, label: 'stun: tangent line' },
    { kind: 'roll', spin: spinForBend(D0_CB, D0_OB, 'TL', 4.5), mph: 7, label: 'slight roll' },
  ]),
  notes: [`Cut ≈ ${cutAngle(D0_CB, D0_OB, POCKETS.TL).toFixed(0)}° (Railbird reads about 32–34°).`],
};

const D1_OB: Pt = [12.5, 75];
const D1_CBS: [number, Pt][] = [[30, [39.58, 55.77]], [45, [43.15, 63.11]], [55, [44.42, 68.40]], [65, [44.74, 73.84]], [75, [44.12, 79.25]]];
const d1: DiagramSpec = {
  balls: [ob(D1_OB), ...D1_CBS.map(([a, p]) => cb(p, `${a}°`))],
  paths: [
    { kind: 'ob', points: [D1_OB, POCKETS.TL] },
    ...D1_CBS.flatMap(([, p]) => [
      { kind: 'aim' as const, points: [p, ghostBall(D1_OB, POCKETS.TL)] },
      { kind: 'roll' as const, points: cueBallPath(p, D1_OB, POCKETS.TL, { spin: 1, mph: 4 }) },
    ]),
  ],
  notes: ['Natural-roll bend off the tangent line: 26°, 16°, 11°, 8°, 4° at 30°–75°.'],
};

const d2: DiagramSpec = {
  balls: [ob(D0_OB, 'L'), cb(D0_CB, 'L'), ob(D0R_OB, 'R'), cb(D0R_CB, 'R')],
  paths: [
    ...shot(D0_CB, D0_OB, 'TL', [{ kind: 'stun', spin: 0, mph: 7.5 }, { kind: 'roll', spin: 0.6, mph: 7.5 }]),
    ...shot(D0R_CB, D0R_OB, 'TR', [{ kind: 'stun', spin: 0, mph: 7.5 }, { kind: 'roll', spin: 0.6, mph: 7.5 }]),
  ],
  notes: ['Thick miss = head-rail side of the pocket; thin miss = long-rail side.'],
};

const SQ_OB: Pt = [17.68, 82.32];
const SQ_CBS: Pt[] = [[26.52, 73.48], [35.36, 64.64], [44.19, 55.81]];
const squirt: DiagramSpec = {
  balls: [ob(SQ_OB), ...SQ_CBS.map((p, i) => cb(p, `${i + 1}`))],
  paths: [{ kind: 'ob', points: [SQ_OB, POCKETS.TL] }, { kind: 'aim', points: [SQ_CBS[2], ghostBall(SQ_OB, POCKETS.TL)] }],
  notes: ['Cue ball 1, 2 and 3 diamonds straight back. One tip left, then one tip right.'],
};

function wedge(c: Pt, dirDeg: number, from: number, to: number, r: number): Pt[] {
  const pts: Pt[] = [c];
  for (let a = from; a <= to + 1e-9; a += (to - from) / 8) {
    const t = ((dirDeg + a) * Math.PI) / 180;
    pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  return pts;
}
const SPOT = SPOTS.foot;

// Spot shot (what Railbird's built-in spot-shot mode records): object ball on the
// foot spot, cue ball just behind the head string 2½ ball widths off a side rail,
// cut into the far bottom corner. The rolling cue ball is followed off the foot
// and side rails back to the head rail (about the middle diamond at 10 mph).
const SPOT_CB: Pt = [2.5 * 2 * TABLE.ballR, 76.5];
const spot: DiagramSpec = {
  balls: [ob(SPOT), cb(SPOT_CB)],
  paths: [
    ...shot(SPOT_CB, SPOT, 'BR'),
    { kind: 'cb', points: cueBallPath(SPOT_CB, SPOT, POCKETS.BR, { spin: 1, mph: 10, cushions: 2 }) },
  ],
  notes: [
    `Cut ≈ ${cutAngle(SPOT_CB, SPOT, POCKETS.BR).toFixed(0)}° from this spot, close to a half-ball hit. The mirror shot from the right side goes into the bottom-left corner.`,
    'Rolling cue ball at a medium-firm 10 mph: foot rail, side rail, then back to the head rail near the middle diamond. Simplified physics, so treat the path as typical.',
  ],
};

// "9 on the spot" zone drill: retired from the list for now (kept for later use).
// Green = cue ball within 15° of the pocket-through-spot line, amber = 15–45°.
export const SPOT_ZONES_DIAGRAM: DiagramSpec = {
  balls: [ob(SPOT, undefined, 9), cb([31.5, 33], 'green')],
  paths: [{ kind: 'ob', points: [SPOT, POCKETS.BL] }, { kind: 'aim', points: [[31.5, 33], ghostBall(SPOT, POCKETS.BL)] }],
  zones: [
    { polygon: wedge(SPOT, 45, -45, -15, 22), tone: 'caution' },
    { polygon: wedge(SPOT, 45, 15, 45, 22), tone: 'caution' },
    { polygon: wedge(SPOT, 45, -15, 15, 22), tone: 'good' },
  ],
  notes: ['Green: within 15° of the pocket-through-spot line (≈75%). Amber: 15–45° (≈55–60%). Mirror for the other corner.'],
};

// The table diagonal the straight-in stroke drills use.
const DIAG_TL_BR: Pt[] = [POCKETS.TL, POCKETS.BR];

const MR = POCKETS.MR;
const SIDE: [number, Pt, Pt][] = [
  [0, [32.0, 50.0], [19.5, 50.0]], [20, [33.09, 56.16], [21.34, 60.43]], [40, [36.21, 61.57], [26.64, 69.61]],
  [50, [38.43, 63.79], [30.39, 73.36]], [60, [41.0, 65.59], [34.75, 76.41]],
];
const sideRay = (deg: number, tone: DiagramRay['tone'], label: string): DiagramRay => {
  const [from, to] = pocketRay('MR', deg, 34);
  return { from, to, tone, label };
};
const sideLadder: DiagramSpec = {
  balls: SIDE.flatMap(([a, o, c]) => [ob(o, `${a}°`), cb(c)]),
  paths: SIDE.map(([, o]) => ({ kind: 'ob' as const, points: [o, MR] })),
  rays: [sideRay(-45, 'good', '45°'), sideRay(-55, 'caution', '55°'), sideRay(-65, 'bad', '65°')],
  notes: ['Rays from the pocket: 45° green, 55° amber, 65° red — your availability rule.'],
};

const MIR_OB = SPOTS.head;
const MIR_L: Pt = [44.52, 47.81], MIR_R: Pt = [5.48, 47.81];
const mirror: DiagramSpec = {
  balls: [ob(MIR_OB), cb(MIR_L, 'L'), cb(MIR_R, 'R')],
  paths: [...shot(MIR_L, MIR_OB, 'TL'), ...shot(MIR_R, MIR_OB, 'TR')],
  notes: ['About a 10° cut each way. Alternate sides in 20-shot blocks.'],
};

// 10-ball rack on the foot spot: 1 at the apex, 10 in the middle of the third row.
const RACK_ROWS = [[1], [2, 3], [4, 10, 5], [6, 7, 8, 9]];
const ROW = 2.25 * Math.sqrt(3) / 2;
const bowling: DiagramSpec = {
  balls: [
    ...RACK_ROWS.flatMap((row, k) => row.map((num, j) => ob([25 + (j - (row.length - 1) / 2) * 2.25, 25 - k * ROW], undefined, num))),
    cb([25, 87.5], 'break'),
  ],
  paths: [],
  notes: ['Ten balls racked on the foot spot; break from the kitchen.'],
};

// ---------- stroke drills (Lela's definitions) ----------

const D = TABLE.diamond;
/** A point `d` inches further from `pocket` than `obP`, on the line from the pocket through the object ball. */
function behind(obP: Pt, pocket: Pt, d: number): Pt {
  const dx = obP[0] - pocket[0], dy = obP[1] - pocket[1];
  const k = d / Math.abs(dy || 1);              // distances are measured along the long rail
  return [obP[0] + dx * k, obP[1] + dy * k];
}
/** Straight-in shot with the follow and draw lines the stroke drills ask for. */
function straightIn(cbP: Pt, obP: Pt, pk: PocketId, opts: { follow?: boolean; draw?: Pt | null; stop?: boolean } = {}): DiagramPath[] {
  const g = ghostBall(obP, POCKETS[pk]);
  const out: DiagramPath[] = [{ kind: 'aim', points: [cbP, g] }, { kind: 'ob', points: [obP, POCKETS[pk]] }];
  if (opts.follow) out.push({ kind: 'roll', points: [g, POCKETS[pk]], label: 'follow' });
  if (opts.draw) out.push({ kind: 'draw', points: [g, opts.draw], label: 'draw' });
  return out;
}

const X_OB2: Pt = [D, 100 - 2 * D];                              // 1 diamond off the long rail, 2 off the short rail
const X_CB_LEVELS: Pt[] = [[25, 50], [2.5 * D, 100 - 5 * D], [50 - D, 2 * D]];
const xLevel = (i: number): DiagramSpec => ({
  balls: [ob(X_OB2), cb(X_CB_LEVELS[i], `L${i + 1}`)],
  paths: [{ kind: 'guide', points: DIAG_TL_BR }, ...straightIn(X_CB_LEVELS[i], X_OB2, 'TL', { follow: true, draw: X_CB_LEVELS[i] })],
  notes: ['Straight in along the diagonal. 10 follow, 10 stop, 10 draw.'],
});

const MID_R = TABLE.ballR;
const MID_X: number[] = (() => {
  const outer = MID_R + 2 * MID_R * 0.5 + MID_R;                // half a ball off the cushion
  const step = (25 - outer) / 7;
  return Array.from({ length: 15 }, (_, i) => 25 + (i - 7) * step);
})();
const midLevel = (i: number): DiagramSpec => {
  const d = (i + 1) * D;
  const ex: [number, PocketId][] = [[MID_X[13], 'BR'], [MID_X[7], 'BR'], [MID_X[1], 'BL']];
  return {
    balls: [...MID_X.map(x => ob([x, 50])), ...ex.map(([x, pk]) => cb(behind([x, 50], POCKETS[pk], d)))],
    paths: ex.flatMap(([x, pk]) => straightIn(behind([x, 50], POCKETS[pk], d), [x, 50], pk)),
    notes: [`Examples for three of the balls. Each cue ball sits ${i + 1} diamond${i ? 's' : ''} back (measured along the long rail) on the line from the pocket through the ball.`],
  };
};

const CT_OB: Pt = [25, 50];
const ctLevel = (i: number, kind: 'follow' | 'draw'): DiagramSpec => {
  const c: Pt = [25 - ((i + 1) * D) / 2, 50 + (i + 1) * D];
  return {
    balls: [ob(CT_OB), cb(c, `L${i + 1}`)],
    paths: [{ kind: 'guide', points: DIAG_TL_BR }, ...straightIn(c, CT_OB, 'BR', kind === 'follow' ? { follow: true } : { draw: POCKETS.TL })],
    notes: [kind === 'follow' ? 'Follow the cue ball into the same corner.' : 'Draw the cue ball straight back into the opposite corner.', 'Shown for a right-handed player (cue ball on the left); left-handed is the mirror image.'],
  };
};

const STOP_OUTCOMES = (p: string): MakeOutcome[] => [
  { id: `${p}stop`, label: 'Stopped', quality: 'good' },
  { id: `${p}dl`, label: 'Drifted left', drift: 'L' },
  { id: `${p}dr`, label: 'Drifted right', drift: 'R' },
];
const DRAW_OUTCOMES = (p: string): MakeOutcome[] => [
  { id: `${p}made`, label: 'Made' },
  { id: `${p}rail`, label: 'Drew back to the rail', quality: 'good' },
  { id: `${p}in`, label: 'Drew into the corner', quality: 'best' },
];
const STRAIGHT_COACHING = ['Stay relaxed and keep the cue on a straight line.', 'Tension shows up immediately as a miss.', 'Follow through.'];

const X_PROG: ProgSpec = {
  progressive: true, missKind: 'lr', bestLabel: 'with the cue ball pocketed (followed or drawn in)',
  levels: [
    { label: 'Level 1', cue: 'Cue ball at the center of the table.', diagram: xLevel(0) },
    { label: 'Level 2', cue: 'Cue ball one diamond further back on the diagonal: 2½ diamonds off the long rail, 5 from the short rail.', diagram: xLevel(1) },
    { label: 'Level 3', cue: 'Cue ball at the mirror spot of the object ball: 1 diamond off the other long rail, 2 off the far short rail.', diagram: xLevel(2) },
  ],
  phases: [
    { id: 'follow', name: 'Follow', makes: 10, outcomes: [{ id: 'f-made', label: 'Made' }, { id: 'f-in', label: 'Cue ball followed in', quality: 'best' }] },
    { id: 'stop', name: 'Stop', makes: 10, outcomes: STOP_OUTCOMES('s-') },
    { id: 'draw', name: 'Draw', makes: 10, outcomes: DRAW_OUTCOMES('d-') },
  ],
};
const MID_PROG: ProgSpec = {
  progressive: true, missKind: 'lr',
  levels: [0, 1, 2].map(i => ({ label: `Level ${i + 1}`, cue: [`Cue ball 1 diamond back from each ball.`, 'Cue ball 2 diamonds back (the head string).', 'Cue ball 3 diamonds back. Very difficult.'][i], diagram: midLevel(i) })),
  phases: [{ id: 'stop', name: 'Stop', makes: 15, outcomes: STOP_OUTCOMES('m-') }],
};
const ctProg = (kind: 'follow' | 'draw'): ProgSpec => ({
  progressive: true, missKind: 'lr', handed: true, coaching: STRAIGHT_COACHING, bestLabel: 'cue ball pocketed',
  levels: [0, 1, 2].map(i => ({ label: `Level ${i + 1}`, cue: `Cue ball ${i + 1} diamond${i ? 's' : ''} back on the diagonal, measured along the long rail.`, diagram: ctLevel(i, kind) })),
  phases: [{
    id: kind, name: kind === 'follow' ? 'Follow' : 'Draw', makes: 10,
    outcomes: kind === 'follow'
      ? [{ id: 'cf-made', label: 'Made' }, { id: 'cf-rail', label: 'Followed to the rail', quality: 'good' }, { id: 'cf-in', label: 'Followed in', quality: 'best' }]
      : DRAW_OUTCOMES('cd-'),
  }],
});

// Basic stop and draw shots: cue ball on the center spot, object ball an inch off the side pocket's lip.
const BASIC_OB: Pt = [50 - (1 + 2 * TABLE.ballR), 50];
const basicStop: DiagramSpec = {
  balls: [ob(BASIC_OB), cb([25, 50])],
  paths: straightIn([25, 50], BASIC_OB, 'MR'),
  notes: ['Short and straight into the side pocket. The cue ball should stop dead on the spot.'],
};
const basicDraw: DiagramSpec = {
  balls: [ob(BASIC_OB), cb([25, 50])],
  paths: straightIn([25, 50], BASIC_OB, 'MR', { draw: POCKETS.ML }),
  notes: ['Draw the cue ball straight back into the opposite side pocket.'],
};
const stopCombo = (pos: 'stop' | 'dl' | 'dr', spin?: Side): MakeOutcome => ({
  id: `b-${pos}${spin ? `-s${spin}` : ''}`,
  label: `${pos === 'stop' ? (spin ? 'Stopped, spinning' : 'Stopped dead') : pos === 'dl' ? 'Drifted left' : 'Drifted right'}${pos !== 'stop' && spin ? `, spinning ${spin === 'L' ? 'left' : 'right'}` : pos === 'stop' && spin ? ` ${spin === 'L' ? 'left' : 'right'}` : ''}`,
  quality: pos === 'stop' ? (spin ? 'good' : 'best') : undefined,
  drift: pos === 'dl' ? 'L' : pos === 'dr' ? 'R' : undefined,
  spin,
  hidden: pos !== 'stop' && !!spin,
  amend: pos !== 'stop' && !spin ? [{ label: '↺ also spinning left', to: `b-${pos}-sL` }, { label: 'also spinning right ↻', to: `b-${pos}-sR` }] : undefined,
});
const BASIC_STOP_PROG: ProgSpec = {
  progressive: false, missKind: 'lr', bestLabel: 'stopped dead (no spin)',
  levels: [{ label: 'Basic', cue: 'Cue ball on the center spot; object ball an inch off the side pocket’s lip.', diagram: basicStop }],
  setSizes: [5, 7, 10, 15],
  variants: [{ id: 'low', label: 'Low speed' }, { id: 'medium', label: 'Medium speed' }, { id: 'high', label: 'High speed' }],
  phases: [{ id: 'stop', name: 'Stop', makes: 5, outcomes: [
    stopCombo('stop'), stopCombo('stop', 'L'), stopCombo('stop', 'R'), stopCombo('dl'), stopCombo('dr'),
    stopCombo('dl', 'L'), stopCombo('dl', 'R'), stopCombo('dr', 'L'), stopCombo('dr', 'R'),
  ] }],
  coaching: [
    'Spinning but stopped on the spot: you didn’t hit the center of the cue ball.',
    'Drifting left or right: you didn’t hit the center of the target.',
    'Both together: both at once. Ideally it stops dead with no spin.',
  ],
};
const BASIC_DRAW_PROG: ProgSpec = {
  progressive: false, missKind: 'lr', bestLabel: 'drawn into the pocket',
  levels: [{ label: 'Basic', cue: 'Cue ball on the center spot; object ball an inch off the side pocket’s lip.', diagram: basicDraw }],
  phases: [{ id: 'draw', name: 'Draw', makes: 7, outcomes: [
    { id: 'bd-in', label: 'Drew into the pocket', quality: 'best' },
    { id: 'bd-rl', label: 'Rail, left of the pocket', quality: 'good', rail: 'L' },
    { id: 'bd-rr', label: 'Rail, right of the pocket', quality: 'good', rail: 'R' },
    { id: 'bd-short', label: 'Short of the rail' },
  ] }],
};

// Thin cuts: cue ball on the center spot, cut into the nearest corner, alternating sides.
const TC_R = 1 + TABLE.ballR;                                   // about an inch off the cushion
const tc1L: Pt = [TC_R, 50 + D], tc1R: Pt = [TC_R, 50 - D];
const thinCuts1: DiagramSpec = {
  balls: [cb([25, 50]), ob(tc1L, '1'), ob(tc1R, '2')],
  paths: [...shot([25, 50], tc1L, 'TL'), { kind: 'ob', points: [tc1R, POCKETS.BL] }, { kind: 'aim', points: [[25, 50], ghostBall(tc1R, POCKETS.BL)] }],
  notes: [`About a ${cutAngle([25, 50], tc1L, POCKETS.TL).toFixed(0)}° cut. After each make, switch to the ball on the other side of the side pocket and cut the other way.`],
};
const tc2L: Pt = [D, 100 - TC_R], tc2R: Pt = [50 - D, 100 - TC_R];
const thinCuts2: DiagramSpec = {
  balls: [cb([25, 50]), ob(tc2L, '1'), ob(tc2R, '2')],
  paths: [...shot([25, 50], tc2L, 'TL'), { kind: 'ob', points: [tc2R, POCKETS.TR] }, { kind: 'aim', points: [[25, 50], ghostBall(tc2R, POCKETS.TR)] }],
  notes: [`A longer shot, about a ${cutAngle([25, 50], tc2L, POCKETS.TL).toFixed(0)}° cut. After each make, switch to the other corner on the same short rail.`],
};
const thinProg = (diagram: DiagramSpec, sides: [string, string]): ProgSpec => ({
  progressive: false, missKind: 'thickthin', noQuality: true, alternate: sides,
  levels: [{ label: 'Thin cuts', cue: 'Cue ball on the center spot.', diagram }],
  phases: [{ id: 'cut', name: 'Cut', makes: 10, outcomes: [{ id: 'tc-made', label: 'Made' }] }],
});

export const THIN_CUT_DRILLS: DrillDef[] = [
  {
    id: 'thin-cuts-1', minutes: 12, name: 'Thin cuts 1', category: 'reps', tags: [{ value: 'ec-thin-cuts-1' }], aliases: ['thin cut'],
    diagram: thinCuts1, counters: 'progressive', prog: thinProg(thinCuts1, ['Head-side corner', 'Foot-side corner']),
    setup: [
      'Cue ball on the center spot. Object ball about an inch off the long rail, at the diamond next to the side pocket.',
      'Cut it into the nearest corner pocket. After each make, put the next ball at the matching diamond on the other side of the side pocket and cut the other way.',
      'Misses are thick (undercut) or thin (overcut); repeat until made. Very difficult: 5 makes each way can take 10 to 15 minutes.',
    ],
    target: { text: '5 makes in each direction (10 makes).', unit: 'makes' },
  },
  {
    id: 'thin-cuts-2', minutes: 12, name: 'Thin cuts 2', category: 'reps', tags: [{ value: 'ec-thin-cuts-2' }], aliases: [],
    diagram: thinCuts2, counters: 'progressive', prog: thinProg(thinCuts2, ['Left corner', 'Right corner']),
    setup: [
      'Cue ball on the center spot. Object ball one diamond from a corner pocket along the short rail, about an inch off the rail.',
      'Cut it into that corner. After each make, switch to the matching spot by the other corner on the same short rail.',
      'Misses are thick or thin; at this distance it can be hard to tell, so use "not sure" rather than guess.',
    ],
    target: { text: '5 makes into each corner (10 makes).', unit: 'makes' },
  },
];

const STROKE_DRILLS: DrillDef[] = [
  {
    id: 'basic-stops', minutes: 3, name: 'Basic stop shots', category: 'stroke', tags: [{ value: 'ec-basic-stops' }], aliases: ['basic stop'],
    diagram: basicStop, counters: 'progressive', prog: BASIC_STOP_PROG,
    setup: [
      'Cue ball on the center spot; object ball right in front of a side pocket, about an inch off the lip. Play stop shots.',
      'Choose a speed: low, medium or high. Sets of 5 by default; 7 is about what a drop pocket holds, and longer sets suit deep practice.',
      'Success is the cue ball stopping within one ball radius; ideally it stops dead with no spin. Note drift (left or right) and spin (left or right): they tell you about your stroke.',
      'A beginner’s drill and a warm-up for any level: 5 medium-speed stop shots warm up an advanced player before a match.',
    ],
    target: { text: 'Sets of 5 (or 7+) at each speed.', unit: 'makes' },
  },
  {
    id: 'basic-draws', minutes: 4, name: 'Basic draw shots', category: 'stroke', tags: [{ value: 'ec-basic-draws' }], aliases: ['basic draw'],
    diagram: basicDraw, counters: 'progressive', prog: BASIC_DRAW_PROG,
    setup: [
      'The same set-up as Basic stop shots: cue ball on the center spot, object ball an inch off the side pocket’s lip.',
      'Draw the cue ball straight back into the opposite side pocket. Pocketed with perfectly straight draw is the goal; reaching the long rail is a partial success, so note which side of the pocket it hit.',
    ],
    target: { text: 'Sets of 7.', unit: 'makes' },
  },
  {
    id: 'midtable-stops', minutes: 8, name: 'Mid-table stop shots', category: 'stroke', tags: [{ value: 'ec-midtable-stops' }], aliases: ['centerline drill', 'mid-table stop'],
    diagram: midLevel(0), counters: 'progressive', prog: MID_PROG,
    setup: [
      'All 15 balls on the line between the side pockets: one on the center spot, then seven spread evenly toward each side pocket. The outermost ball sits about half a ball off the long rail, not frozen to it.',
      'Ball in hand every shot: straight in, stop shot. Any ball, any order. Balls on the right go in the right corner, balls on the left in the left corner; the center ball in either.',
      'Shoot from the head side toward the foot corners (either direction works). The cue ball goes on the line from the pocket through the ball, 1, 2 or 3 diamonds back by level, measured along the long rail.',
      'A stop counts when the cue ball stops within one ball radius; note any drift left or right. A miss is repeated until it’s made.',
    ],
    target: { text: '15 makes per set, one per ball.', unit: 'makes' },
  },
  {
    id: 'xdrill', minutes: 12, name: 'X-drill', category: 'stroke', tags: [], railbirdBuiltIn: 'drillx-shot', aliases: ['drillx-shot', 'drill x-shot', 'x-drill', 'mighty x'],
    diagram: xLevel(0), counters: 'progressive', prog: X_PROG,
    setup: [
      'Object ball one diamond off the long rail and two diamonds from the short rail; straight into that corner along the diagonal.',
      'Cue ball by level: the center of the table, one diamond further back, or the mirror spot of the object ball.',
      '30 makes: 10 follow (ideally the cue ball follows it in), 10 stop (within one ball radius; note drift left or right), 10 draw (note a draw back to the rail, or straight into the opposite corner).',
      'A miss is repeated until it’s made. It covers all three spins, so it’s the minimum stroke warm-up.',
      "When filming, Railbird's built-in X-shot drill mode still identifies it.",
    ],
    target: { text: '30 makes per set: 10 follow, 10 stop, 10 draw.', unit: 'makes' },
  },
  {
    id: 'center-follow', minutes: 6, name: 'Center table follow', category: 'stroke', tags: [{ value: 'ec-center-follow' }], aliases: ['center table follow'],
    diagram: ctLevel(0, 'follow'), counters: 'progressive', prog: ctProg('follow'),
    setup: [
      'One ball on the center spot. Shoot it straight along the diagonal into a corner of your choice and follow the cue ball into the same pocket.',
      'Right-handed players put the cue ball on the left side of the table, left-handed players on the right. Cue ball 1, 2 or 3 diamonds back by level, measured along the long rail.',
      'Note made, followed to the rail, or followed in. Re-spot after each shot; a miss is repeated until it’s made.',
    ],
    target: { text: 'Sets of 10 makes.', unit: 'makes' },
  },
  {
    id: 'center-draw', minutes: 6, name: 'Center table draw', category: 'stroke', tags: [{ value: 'ec-center-draw' }], aliases: ['center table draw', 'longest shot'],
    diagram: ctLevel(0, 'draw'), counters: 'progressive', prog: ctProg('draw'),
    setup: [
      'One ball on the center spot. Shoot it straight along the diagonal into a corner of your choice and draw the cue ball straight back to the opposite corner.',
      'Right-handed players put the cue ball on the left side of the table, left-handed players on the right. Cue ball 1, 2 or 3 diamonds back by level, measured along the long rail. Level 3 is quite advanced.',
      'Note made, drawn back to the rail, or drawn into the corner (it must go in). Re-spot after each shot; a miss is repeated until it’s made.',
    ],
    target: { text: 'Sets of 10 makes.', unit: 'makes' },
  },
];

// ---------- the registry ----------

const DRILL_DEFS: DrillDef[] = [
  ...STROKE_DRILLS,
  ...THIN_CUT_DRILLS,
  {
    id: 'transitions-1', name: 'Transitions-1', category: 'transitions',
    tags: [{ value: 'ec-transitions-1' }], aliases: ['pool kata bassai 9 ball', 'pool kata', 'kata'],
    diagram: null, editableLayout: true, counters: 'completion', ballsPerRack: 9, learning: LEARNING,
    setup: [
      '1 on the right rail and 2 on the left rail, each at the second diamond beside the head spot; 3 at the middle diamond of the head rail; 4 on the head spot.',
      '5 on the right rail and 7 on the left rail, each at the second diamond beside the foot spot; 6 at the middle diamond of the foot rail; 8 on the foot spot; 9 on the center spot.',
      'Rail balls one ball-width off the cushion. Cue ball 1½ balls uptable of the 9.',
      'Several ways to complete it, using different transitions from each ball to the next. Focus: fine-tune position with slightly more or less spin on chosen shots.',
    ],
    target: { text: 'Log every rack: completed, or the ball where the run ended.', unit: 'racks' },
  },
  {
    id: 'bowling-10', name: '10-ball bowling', category: 'runout', tags: [{ value: 'ec-10ball-bowling' }],
    aliases: ['10 ball bowling', '10-ball bowling', 'bowliards'], diagram: bowling, counters: 'none', scorer: 'bowling',
    setup: [
      'Rack ten balls and break. Each frame is one rack, with two innings to clear it.',
      'All ten in the first inning is a strike (10 plus your next two innings); all ten across both innings is a spare (10 plus your next inning). The tenth frame earns its bonus innings. 300 is perfect.',
      'Play your usual rules for the break and ball in hand; the scorer only needs the balls you ran in each inning.',
      'An offensive drill: it measures how far you get through a rack, so run-out planning and position decide it.',
    ],
    target: { text: 'Score each game with the scorer (Open the scorer below). Watch the average of your last five.', unit: 'racks' },
  },
  {
    id: 'spot', minutes: 8, name: 'Spot shot', category: 'reps', tags: [], railbirdBuiltIn: 'drillspot-shot', aliases: ['drillspot-shot', 'drill spot-shot', 'spot shot'],
    diagram: spot, counters: 'progressive',
    prog: { progressive: false, missKind: 'thickthin', noQuality: true, alternate: ['Left side', 'Right side'],
      levels: [{ label: 'Spot shot', cue: 'Object ball on the foot spot; cue ball behind the head string, 2–3 ball widths off a side rail.', diagram: spot }],
      phases: [{ id: 'spot', name: 'Spot shot', makes: 10, outcomes: [{ id: 'sp-made', label: 'Made' }] }] },
    setup: [
      'Object ball on the foot spot. Cue ball just behind the head string, 2–3 ball widths off a side rail.',
      'Cut it into the far bottom corner, close to a half-ball hit.',
      'After a make, switch to the other side of the table (the mirror shot into the other bottom corner). After a miss, repeat the same position until you make it.',
      'Tests committing to a longer shot and a smooth delivery: full routine, fundamentals, stay still through the shot.',
      "Tap each shot, or on a filming day use Railbird's built-in spot-shot drill mode.",
    ],
    target: { text: '10 makes, alternating sides (about 20 shots).', minimum: 20, unit: 'shots' },
  },
  {
    id: 'mirror', name: 'Mirror set', category: 'reps', tags: [{ value: 'ec-mirror' }], aliases: ['mirror set'],
    diagram: mirror, counters: 'diagnostic', sides: ['L', 'R'], alternateMakes: false,
    blocks: [{ id: 'M', name: 'Mirror set', keys: ['make', 'thick', 'thin'] }],
    setup: ['Object ball on the head spot; cue ball for a ~10° cut into the left corner, then the mirror for the right.', 'Alternate left and right, 20-shot blocks, same routine both sides.', 'Tallies are optional: tap thick/thin on misses while you use it as a test.'],
    target: { text: '20-shot blocks.', unit: 'shots' },
  },
  {
    id: 'side-ladder', name: 'Side-pocket go / no-go', category: 'reps', tags: [{ value: 'ec-side-ladder' }], aliases: [],
    diagram: sideLadder, counters: 'none',
    setup: ['Object ball 1½ diamonds from the side pocket at 0°, 20°, 40°, 50°, 60° approach; cue ball 1 diamond straight behind.', '5 per angle. Past the line, play the corner or a safety.'],
    target: { text: '5 shots per angle.', perCell: 5, unit: 'shots' },
  },
  {
    id: 'squirt', name: 'Squirt calibration', category: 'reps', tags: [{ value: 'ec-squirt' }], aliases: [],
    diagram: squirt, counters: 'none',
    setup: ['Straight-in to a corner; object ball 2 diamonds from the pocket.', 'Cue ball 1, 2 and 3 diamonds straight back. Firm. One tip left, then one tip right.', 'Note the aim offset or back-hand pivot that holds the ball on line.'],
  },
  {
    id: 'double-box', name: 'Double box', category: 'transitions', tags: [{ value: 'ec-doublebox' }], aliases: ['double box'],
    diagram: null, editableLayout: true, counters: 'completion', ballsPerRack: 14, learning: LEARNING,
    setup: [
      'Fourteen balls in two L shapes, odd numbers at the head end and even at the foot end, half a diamond (6.25″) apart.',
      'Head end: 7 on the head spot; 5, 3 and 1 along the head string toward the left rail (1 half a diamond off the rail); 9, 11 and 13 up the center line toward the head rail.',
      'Foot end: the mirror image. 8 on the foot spot; 6, 4 and 2 along the second diamond toward the left rail; 10, 12 and 14 down the center line toward the foot rail.',
      'Cue ball in hand to start. Cut shots, with one- and two-rail position; like the L drill, most shots need some side spin as well as follow.',
      'Bring the cue ball back to the right side rail after every shot. Too low on the rail and you lose the angle for the next ball, so precise position matters as much as the pot.',
      'Shoot them in order, 1 to 14, so play alternates ends.',
    ],
    target: { text: 'Log every rack: ran out, or the ball where it ended and why.', unit: 'racks' },
  },
  {
    id: 'd0-tangent', name: 'Tangent-line set-up', short: 'D0', category: 'calibration', tags: [{ value: 'ec-tangent' }],
    aliases: ['tangent line', 'abc'], diagram: d0, counters: 'none',
    setup: ['Object ball on the break-box corner at the headstring, into the head-left corner.', 'Cue ball 3 diamonds straight back.', 'Stun follows the tangent line to the right long rail ~6″ short of the corner; a 4–5° forward bend sends it into the corner.'],
  },
  {
    id: 'd1-roll', name: 'Natural-roll cut ladder', short: 'D1', category: 'calibration', tags: [{ value: 'ec-d1-roll' }],
    aliases: ['cal roll ladder', 'roll ladder'], diagram: d1, counters: 'none',
    setup: ['Object ball on the headstring 1 diamond off the left rail, into the head-left corner.', 'Cue ball 2½ diamonds away at 30°, 45°, 55°, 65°, 75°.', 'Center to ½ tip above, fully rolling at contact. 3–5 mph.'],
    target: { text: '15 shots per angle minimum, 20 better.', perCell: 20, minimum: 15, unit: 'shots' },
  },
  {
    id: 'd2-stun', name: 'Stun miss-direction test', short: 'D2', category: 'calibration',
    tags: [{ value: 'ec-d2-stun', label: 'Block A' }, { value: 'ec-d2-follow', label: 'Block F' }], aliases: ['d2 a', 'd2 f'],
    diagram: d2, counters: 'diagnostic', sides: ['L', 'R'], alternateMakes: true,
    blocks: [
      { id: 'A', name: 'A · stun', keys: ['make', 'thick', 'thin', 'rail', 'pocket'] },
      { id: 'F', name: 'F · follow', keys: ['make', 'thick', 'thin'] },
    ],
    setup: ['Left: the tangent-line set-up. Right: its mirror into the head-right corner.', 'Block A = stun, no side. Block F = follow ½–1 tip, no side. Firm, 7–8 mph.', 'Alternate makes: repeat a side until you make it, then switch. 10 makes per side per block.'],
    target: { text: '20 misses per cell (about 50 shots); first look at 15.', perCell: 20, minimum: 15, unit: 'misses' },
  },
];

/** Layouts shipped in src/drills/layouts.json replace the drawn defaults. */
export const SHIPPED_LAYOUTS = (shipped as { layouts: Record<string, DiagramSpec> }).layouts;

export const BUILTIN_DRILLS: DrillDef[] = DRILL_DEFS.map(d => (SHIPPED_LAYOUTS[d.id] ? { ...d, diagram: SHIPPED_LAYOUTS[d.id] } : d));

/** The layout as JSON, ready to paste into src/drills/layouts.json. */
export function layoutSnippet(drillId: string, spec: DiagramSpec): string {
  const round = (v: number) => Math.round(v * 100) / 100;
  const clean: DiagramSpec = {
    balls: spec.balls.map(b => ({ ...b, x: round(b.x), y: round(b.y) })),
    paths: spec.paths.map(p => ({ ...p, points: p.points.map(([x, y]) => [round(x), round(y)] as Pt) })),
    ...(spec.zones ? { zones: spec.zones } : {}),
    ...(spec.rays ? { rays: spec.rays } : {}),
    ...(spec.notes ? { notes: spec.notes } : {}),
  };
  return `"${drillId}": ${JSON.stringify(clean)}`;
}

export const CATEGORY_LABEL: Record<DrillCategory, string> = {
  stroke: 'Stroke drills', transitions: 'Transitions', runout: 'Run-out drill', reps: 'Reps', calibration: 'Calibration',
};
export const CATEGORY_HINT: Record<DrillCategory, string> = {
  stroke: 'Straight-in stroke work, tapped shot by shot. Three levels each; the app moves you up or down from your results.',
  transitions: 'Pattern drills: ball-to-ball position. Measured by completion.',
  runout: 'Full racks, scored like bowling. Set aside time to finish all ten frames.',
  reps: 'Fixed single-shot drills: tapped on the phone, or measured by make % from Railbird.',
  calibration: 'Tests that pin down how Railbird reads spin and where your misses go.',
};

// ---------- identifying drills in Railbird data ----------

const norm = (s: string) => s.toLowerCase().trim();

/** Returns the drill a Railbird session belongs to, from its tags, game types and name. */
export function matchDrill(drills: DrillDef[], tags: string[], gameTypes: string[], sessionName: string): DrillDef | null {
  const tokens = [...tags, ...gameTypes].map(norm);
  const name = norm(sessionName);
  // Exact tag matches first (most specific), then built-in modes, then alias substrings.
  for (const d of drills) if (d.tags.some(t => tokens.includes(norm(t.value)))) return d;
  for (const d of drills) if (d.railbirdBuiltIn && tokens.includes(d.railbirdBuiltIn)) return d;
  for (const d of drills) if (d.aliases.some(a => tokens.some(t => t.includes(norm(a))) || (a.length > 4 && name.includes(norm(a))))) return d;
  return null;
}

export function sessionLabel(drills: DrillDef[], tags: string[], gameTypes: string[], sessionName: string): string {
  const d = matchDrill(drills, tags, gameTypes, sessionName);
  if (d) return d.name;
  if ([...tags, ...gameTypes].some(t => /\bdrill\b/i.test(t))) return 'Other drill';
  return 'Free play';
}

/** A new custom Transitions drill: next free number, empty layout. */
export function newTransitionsDrill(existing: DrillDef[]): DrillDef {
  const nums = existing.map(d => /^transitions-(\d+)$/.exec(d.id)?.[1]).filter(Boolean).map(Number);
  const n = Math.max(1, ...nums) + 1;
  return {
    id: `transitions-${n}`, name: `Transitions-${n}`, category: 'transitions', tags: [{ value: `ec-transitions-${n}` }], aliases: [],
    diagram: null, editableLayout: true, counters: 'completion', ballsPerRack: 9, custom: true,
    setup: ['Describe the pattern and what the drill is for.'],
    target: { text: 'Log every rack: completed, or the ball where the run ended.', unit: 'racks' },
  };
}

export { TABLE };
