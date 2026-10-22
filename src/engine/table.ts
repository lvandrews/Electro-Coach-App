// Table geometry and cue-ball path simulation for drill diagrams.
//
// Coordinates: top view of a 9-ft playing surface, 50 × 100 inches, head rail at
// the top. X runs 0 (left long rail) → 50 (right long rail); Y runs 0 (foot rail)
// → 100 (head rail). Diamonds every 12.5″. Ball radius 1.125″.

export type Pt = [number, number];

export const TABLE = { w: 50, h: 100, ballR: 1.125, diamond: 12.5 };

export const POCKETS: Record<'TL' | 'TR' | 'ML' | 'MR' | 'BL' | 'BR', Pt> = {
  TL: [0, 100], TR: [50, 100], ML: [0, 50], MR: [50, 50], BL: [0, 0], BR: [50, 0],
};
export type PocketId = keyof typeof POCKETS;

export const SPOTS = { head: [25, 75] as Pt, center: [25, 50] as Pt, foot: [25, 25] as Pt, headString: 75 };

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const unit = (a: Pt): Pt => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0];

/** Ghost-ball center for sending `ob` to `pocket`. */
export function ghostBall(ob: Pt, pocket: Pt): Pt {
  return sub(ob, mul(unit(sub(pocket, ob)), 2 * TABLE.ballR));
}

/** Cut angle in degrees between the cue-ball travel line and the object-ball line. */
export function cutAngle(cb: Pt, ob: Pt, pocket: Pt): number {
  const g = ghostBall(ob, pocket);
  const a = unit(sub(g, cb)), o = unit(sub(pocket, ob));
  return (Math.acos(Math.max(-1, Math.min(1, dot(a, o)))) * 180) / Math.PI;
}

export interface SimOptions {
  /** Vertical spin at contact as a fraction of natural roll: 1 = rolling, 0 = stun, negative = draw. */
  spin: number;
  /** Cue-ball speed at contact, mph. */
  mph?: number;
  /** Cloth sliding friction coefficient. */
  mu?: number;
  /** Cap on path length, inches. */
  maxLen?: number;
  /** Cushion rebounds to follow before stopping at the next cushion (default 0: stop at the first). */
  cushions?: number;
}

/**
 * Cue-ball path after contact, as a polyline (inches). The cue ball keeps its
 * tangential velocity and its spin is unchanged at impact. Cloth friction then
 * acts on the slip between ball and cloth until the ball rolls (a curve while
 * sliding, straight once rolling). At a cushion the velocity reflects with
 * energy loss and the roll into the cushion is removed (the cushion meets the
 * ball above center); the ball slides briefly, then rolls on. Simplified
 * physics: treat the curves as typical, not exact.
 */
export function cueBallPath(cb: Pt, ob: Pt, pocket: Pt, opt: SimOptions): Pt[] {
  const g = 386.09;                                         // in/s²
  const mu = opt.mu ?? 0.2;
  const v0 = ((opt.mph ?? 5) * 63360) / 3600;               // in/s
  const ghost = ghostBall(ob, pocket);
  const aim = unit(sub(ghost, cb));                          // cue-ball direction before contact
  const obDir = unit(sub(pocket, ob));
  const R = TABLE.ballR;
  const restitution = 0.8, cushionGrip = 0.9;               // normal speed kept, tangential speed kept
  const rollDecel = 0.01 * g;                               // rolling resistance
  const maxLen = opt.maxLen ?? 400;
  const rebounds = opt.cushions ?? 0;

  // State: ball velocity v and the cloth-contact speed of the spin, w (equals v when rolling).
  let v: Pt = sub(mul(aim, v0), mul(obDir, v0 * dot(aim, obDir)));   // tangent-line velocity
  let w: Pt = mul(aim, v0 * opt.spin);
  let p = ghost;
  const pts: Pt[] = [ghost];
  let traveled = 0, hits = 0;
  const dt = 0.002;
  for (let t = 0, k = 0; t < 20 && traveled < maxLen; t += dt, k++) {
    const slip = sub(v, w), sl = len(slip);
    if (sl > 0.5) {
      const u = mul(slip, 1 / sl);
      const dv = mul(u, -mu * g * dt);                      // friction slows the ball along the slip
      const dw = mul(u, 2.5 * mu * g * dt);                 // and spins it toward rolling
      if (len(dv) * 3.5 >= sl) { const vr = add(mul(v, 5 / 7), mul(w, 2 / 7)); v = vr; w = vr; }   // reaches rolling this step
      else { v = add(v, dv); w = add(w, dw); }
    } else {
      const sp = len(v); if (sp < 1) break;
      v = mul(unit(v), Math.max(0, sp - rollDecel * dt)); w = v;
    }
    let q = add(p, mul(v, dt));
    const hitX = q[0] < R || q[0] > TABLE.w - R, hitY = q[1] < R || q[1] > TABLE.h - R;
    if (hitX || hitY) {
      // clip to the cushion
      let lo = 0, hi = 1;
      for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; const qq = add(p, mul(v, dt * m)); if (qq[0] >= R && qq[0] <= TABLE.w - R && qq[1] >= R && qq[1] <= TABLE.h - R) lo = m; else hi = m; }
      q = add(p, mul(v, dt * lo));
      pts.push(q);
      if (hits >= rebounds) return thin(pts);
      hits++;
      v = hitX ? [-restitution * v[0], cushionGrip * v[1]] : [cushionGrip * v[0], -restitution * v[1]];
      // The cushion nose meets the ball above center, which removes most of the
      // roll into the cushion; the roll along the cushion carries on.
      w = hitX ? [0, w[1]] : [w[0], 0];
      p = q;
      continue;
    }
    traveled += len(sub(q, p));
    p = q;
    if (k % 5 === 0) pts.push(p);
  }
  pts.push(p);
  return thin(pts);
}

function thin(pts: Pt[]): Pt[] {
  // keep points at least 0.6″ apart (plus the last) — enough for a smooth SVG line
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) if (len(sub(pts[i], out[out.length - 1])) > 0.6) out.push(pts[i]);
  out.push(pts[pts.length - 1]);
  return out.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
}

/** Final deflection (degrees) of the cue ball off the tangent line once it is rolling. */
export function bendOffTangent(cb: Pt, ob: Pt, pocket: Pt, spin: number): number {
  const aim = unit(sub(ghostBall(ob, pocket), cb));
  const obDir = unit(sub(pocket, ob));
  const vt = sub(aim, mul(obDir, dot(aim, obDir)));
  const vf = add(mul(vt, 5 / 7), mul(aim, (2 / 7) * spin));
  const ang = Math.atan2(Math.abs(cross(vt, vf)), dot(vt, vf));
  return (ang * 180) / Math.PI;
}

/** Straight line from a pocket into the table at `deg` from the line perpendicular to its rail. */
export function pocketRay(pocket: PocketId, deg: number, length: number): Pt[] {
  const p = POCKETS[pocket];
  // inward normal for each pocket (corner pockets point along the diagonal into the table)
  const n: Record<PocketId, Pt> = {
    TL: unit([1, -1]), TR: unit([-1, -1]), BL: unit([1, 1]), BR: unit([-1, 1]), ML: [1, 0], MR: [-1, 0],
  };
  const r = (deg * Math.PI) / 180;
  const d = n[pocket];
  const dir: Pt = [d[0] * Math.cos(r) - d[1] * Math.sin(r), d[0] * Math.sin(r) + d[1] * Math.cos(r)];
  return [p, add(p, mul(dir, length))];
}

/** Point `dist` inches from `from` toward `to`. */
export function along(from: Pt, to: Pt, dist: number): Pt {
  return add(from, mul(unit(sub(to, from)), dist));
}

// ---------- snap points for the layout editor ----------

export interface SnapPoint { at: Pt; label: string }

/**
 * Standard places a ball is set: the three spots, and at every diamond a ball
 * frozen to the cushion or with one ball-width gap to it. Distances are to the
 * cushion nose; ball centers sit 1.125″ (frozen) or 3.375″ (one ball gap) off it.
 */
export function snapPoints(): SnapPoint[] {
  const R = TABLE.ballR, D = 2 * R;
  const out: SnapPoint[] = [
    { at: SPOTS.head, label: 'head spot' }, { at: SPOTS.center, label: 'center spot' }, { at: SPOTS.foot, label: 'foot spot' },
  ];
  const offs: [number, string][] = [[R, 'frozen'], [R + D, 'one ball off']];
  for (const y of [12.5, 25, 37.5, 62.5, 75, 87.5]) for (const [o, t] of offs) {
    out.push({ at: [o, y], label: `${t} left rail, ${y}″` }, { at: [TABLE.w - o, y], label: `${t} right rail, ${y}″` });
  }
  for (const x of [12.5, 25, 37.5]) for (const [o, t] of offs) {
    out.push({ at: [x, TABLE.h - o], label: `${t} head rail` }, { at: [x, o], label: `${t} foot rail` });
  }
  return out;
}

/** Nearest snap point within `radius` inches, else null. */
export function snapTo(x: number, y: number, radius = 2): SnapPoint | null {
  let best: SnapPoint | null = null, bd = radius;
  for (const p of snapPoints()) { const d = Math.hypot(p.at[0] - x, p.at[1] - y); if (d <= bd) { bd = d; best = p; } }
  return best;
}
