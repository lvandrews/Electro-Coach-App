// Shot clock rules and state. Pure: every function takes the time (ms, a monotonic clock
// such as performance.now()) instead of reading it, so the whole flow can be tested.
//
// Flow of a rack: New rack → (break clock) → Shot played → first shot after the break
// (Push out available) → Shot played → … Tap the clock face when the balls stop to start
// the next shot. Turn over switches who is at the table; a time foul passes the table to
// the other player automatically.

export type RuleSetId = 'matchroom' | 'pbs' | 'wpba' | 'custom';

export interface ClockRules {
  shot: number;              // seconds per shot
  breakOff: number;          // seconds for the break; 0 = the break isn't timed
  afterBreak: number;        // first shot after the break
  pushIncoming: number;      // after a push out: the incoming player decides and shoots
  pushBack: number;          // the push is passed back: the player who pushed
  extension: number;         // seconds per extension
  extensionsPerRack: number; // per player
  hillHill: number;          // extensions per player per rack when the match is hill-hill; 0 = no special rule
  warnAt: number;            // warning chime, seconds left
}

export const RULE_SETS: Record<Exclude<RuleSetId, 'custom'>, { label: string; short: string; rules: ClockRules }> = {
  matchroom: {
    label: 'Matchroom (World Nineball Tour)', short: 'Matchroom',
    rules: { shot: 30, breakOff: 60, afterBreak: 60, pushIncoming: 60, pushBack: 30, extension: 30, extensionsPerRack: 1, hillHill: 0, warnAt: 10 },
  },
  pbs: {
    label: 'Predator Pro Billiard Series', short: 'PBS',
    rules: { shot: 30, breakOff: 0, afterBreak: 60, pushIncoming: 60, pushBack: 30, extension: 30, extensionsPerRack: 1, hillHill: 0, warnAt: 10 },
  },
  // WPBA 9-Ball Rules, revised 16 May 2025: 60 s after the break and after a push out, 40 s
  // otherwise; one 40 s extension per player per game, two each when the match is hill-hill.
  wpba: {
    label: 'WPBA (Women’s Professional Billiard Association)', short: 'WPBA',
    rules: { shot: 40, breakOff: 0, afterBreak: 60, pushIncoming: 60, pushBack: 40, extension: 40, extensionsPerRack: 1, hillHill: 2, warnAt: 10 },
  },
};

export type Stage = 'break' | 'afterBreak' | 'pushDecision' | 'pushBack' | 'normal';
export type Phase = 'ready' | 'running' | 'paused' | 'played' | 'expired';
export type Player = 0 | 1;

export interface ClockState {
  shooter: Player;
  breaker: Player;
  stage: Stage;          // the shot on the clock now (or the next one, while waiting)
  phase: Phase;
  duration: number;      // seconds for that shot, extensions included
  remainingMs: number;   // when not running
  endAt: number;         // when running
  extUsed: [number, number];
  pushCalled: boolean;   // the first shot after the break was declared a push out
  rack: number;
  hillHill?: boolean;    // the match is hill-hill (rules with a hill-hill extension allowance)
}

const other = (p: Player): Player => (p === 0 ? 1 : 0);

export function stageSeconds(rules: ClockRules, stage: Stage): number {
  return stage === 'break' ? rules.breakOff
    : stage === 'afterBreak' ? rules.afterBreak
    : stage === 'pushDecision' ? rules.pushIncoming
    : stage === 'pushBack' ? rules.pushBack
    : rules.shot;
}

function at(s: ClockState, rules: ClockRules, stage: Stage, shooter: Player, phase: Phase): ClockState {
  const secs = stageSeconds(rules, stage);
  return { ...s, stage, shooter, phase, duration: secs, remainingMs: secs * 1000, endAt: 0, pushCalled: false };
}

/** A new rack: the breaker is at the table; the break clock if the rules time it. */
export function newRack(rules: ClockRules, breaker: Player, prev?: ClockState): ClockState {
  const base: ClockState = { shooter: breaker, breaker, stage: 'break', phase: 'ready', duration: 0, remainingMs: 0, endAt: 0,
    extUsed: [0, 0], pushCalled: false, rack: (prev?.rack ?? 0) + 1, hillHill: prev?.hillHill ?? false };
  return at(base, rules, rules.breakOff > 0 ? 'break' : 'afterBreak', breaker, 'ready');
}

export function remaining(s: ClockState, now: number): number {
  return s.phase === 'running' ? Math.max(0, s.endAt - now) : s.remainingMs;
}

/**
 * The rules changed (a different rule set or a custom time): a shot that is waiting to start
 * takes the new time at once; a shot already on the clock keeps its time, and the new rules
 * apply from the next shot.
 */
export function applyRules(s: ClockState, rules: ClockRules): ClockState {
  if (s.phase !== 'ready' && s.phase !== 'played') return s;
  const stage: Stage = s.stage === 'break' && rules.breakOff <= 0 ? 'afterBreak' : s.stage;
  const secs = stageSeconds(rules, stage);
  return secs === s.duration && stage === s.stage ? s : { ...s, stage, duration: secs, remainingMs: secs * 1000 };
}

/** Tap the clock face: start the shot that is waiting. From a time foul, the other player gets the table. */
export function start(s: ClockState, rules: ClockRules, now: number): ClockState {
  if (s.phase === 'running') return s;
  if (s.phase === 'paused') return { ...s, phase: 'running', endAt: now + s.remainingMs };
  let next = s;
  if (s.phase === 'expired') next = at(s, rules, 'normal', other(s.shooter), 'ready');
  return { ...next, phase: 'running', endAt: now + next.remainingMs };
}

/** The cue ball was struck: stop the clock and set up the next shot (which starts when the balls stop). */
export function shotPlayed(s: ClockState, rules: ClockRules): ClockState {
  if (s.phase !== 'running' && s.phase !== 'paused') return s;
  if (s.stage === 'break') return at(s, rules, 'afterBreak', s.shooter, 'played');
  if (s.stage === 'afterBreak' && s.pushCalled) return at(s, rules, 'pushDecision', other(s.shooter), 'played');
  return at(s, rules, 'normal', s.shooter, 'played');
}

export function pause(s: ClockState, now: number): ClockState {
  if (s.phase === 'running') return { ...s, phase: 'paused', remainingMs: Math.max(0, s.endAt - now), endAt: 0 };
  if (s.phase === 'paused') return { ...s, phase: 'running', endAt: now + s.remainingMs };
  return s;
}

/** Time ran out: a foul. The table passes to the other player when the next shot starts. */
export function expire(s: ClockState): ClockState {
  return s.phase === 'running' ? { ...s, phase: 'expired', remainingMs: 0, endAt: 0 } : s;
}

/** Extensions each player gets this rack: more when the match is hill-hill, if the rules say so. */
export const extensionsAllowed = (s: ClockState, rules: ClockRules) => (s.hillHill && rules.hillHill > 0 ? rules.hillHill : rules.extensionsPerRack);
export function extensionsLeft(s: ClockState, rules: ClockRules, p: Player): number {
  return Math.max(0, extensionsAllowed(s, rules) - s.extUsed[p]);
}
/** Mark the match hill-hill (or not). Stays set for later racks until turned off. */
export const setHillHill = (s: ClockState, on: boolean): ClockState => ({ ...s, hillHill: on });

/**
 * A player takes an extension. Tapping your own extension also makes you the shooter,
 * so a forgotten turn-over never blocks it.
 */
export function extend(s: ClockState, rules: ClockRules, p: Player): ClockState {
  if (extensionsLeft(s, rules, p) <= 0 || s.phase === 'expired') return s;
  const extUsed: [number, number] = [...s.extUsed] as [number, number]; extUsed[p]++;
  const add = rules.extension * 1000;
  const base: ClockState = { ...s, shooter: p, extUsed, duration: s.duration + rules.extension };
  return s.phase === 'running' ? { ...base, endAt: s.endAt + add } : { ...base, remainingMs: s.remainingMs + add };
}

/** The other player comes to the table. If the clock was still running, the shot counts as played. */
export function turnOver(s: ClockState, rules: ClockRules): ClockState {
  if (s.phase === 'running' || s.phase === 'paused') {
    const played = shotPlayed(s, rules);
    return played.stage === 'pushDecision' ? played : at(played, rules, played.stage === 'afterBreak' ? 'afterBreak' : 'normal', other(s.shooter), 'played');
  }
  if (s.phase === 'expired') return at(s, rules, 'normal', other(s.shooter), 'ready');
  if (s.stage === 'pushDecision' || s.stage === 'pushBack') return at(s, rules, 'normal', other(s.shooter), s.phase);
  return { ...s, shooter: other(s.shooter) };
}

/** Push out is called on the first shot after the break. */
export const canPush = (s: ClockState) => s.stage === 'afterBreak' && s.phase !== 'expired';
export function callPush(s: ClockState): ClockState {
  return canPush(s) ? { ...s, pushCalled: !s.pushCalled } : s;
}

/** After a push out, the incoming player passes the shot back: the player who pushed gets the push-back time at once. */
export const canPassBack = (s: ClockState) => s.stage === 'pushDecision' && s.phase !== 'expired';
export function passBack(s: ClockState, rules: ClockRules, now: number): ClockState {
  if (!canPassBack(s)) return s;
  const n = at(s, rules, 'pushBack', other(s.shooter), 'ready');
  return { ...n, phase: 'running', endAt: now + n.remainingMs };
}

/** What the clock face says about the shot. */
export function stageLabel(s: ClockState): string {
  if (s.phase === 'expired') return 'Time foul: ball in hand';
  switch (s.stage) {
    case 'break': return 'Break';
    case 'afterBreak': return s.pushCalled ? 'Push out' : 'First shot after the break';
    case 'pushDecision': return 'After the push: take it or pass it back';
    case 'pushBack': return 'Pushed back to you';
    default: return '';
  }
}

/** Snapshot for Undo: a running clock is saved with the time it had left, and restored running from there. */
export interface Snapshot { state: ClockState; leftMs: number }
export const snapshot = (s: ClockState, now: number): Snapshot => ({ state: s, leftMs: remaining(s, now) });
export function restore(snap: Snapshot, now: number): ClockState {
  const s = snap.state;
  return s.phase === 'running' ? { ...s, endAt: now + snap.leftMs } : s;
}

/** Saved settings: the chosen rule set plus the custom values. Old settings (before rule sets) become Custom unless they match the old defaults. */
export interface ClockSettings { ruleSet: RuleSetId; custom: ClockRules; volume: number; names: [string, string] }

export function rulesFor(cfg: ClockSettings): ClockRules {
  return cfg.ruleSet === 'custom' ? cfg.custom : RULE_SETS[cfg.ruleSet].rules;
}

export function migrateSettings(raw: unknown): ClockSettings {
  const fresh: ClockSettings = { ruleSet: 'matchroom', custom: { ...RULE_SETS.matchroom.rules }, volume: 0.7, names: ['Player A', 'Player B'] };
  if (!raw || typeof raw !== 'object') return fresh;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const names = Array.isArray(r.names) && r.names.length === 2 ? [String(r.names[0]), String(r.names[1])] as [string, string] : fresh.names;
  const volume = num(r.volume, fresh.volume);
  if (r.ruleSet === 'matchroom' || r.ruleSet === 'pbs' || r.ruleSet === 'wpba' || r.ruleSet === 'custom') {
    const c = (r.custom ?? {}) as Record<string, unknown>;
    const d = RULE_SETS.matchroom.rules;
    return { ruleSet: r.ruleSet, volume, names, custom: {
      shot: num(c.shot, d.shot), breakOff: num(c.breakOff, d.breakOff), afterBreak: num(c.afterBreak, d.afterBreak),
      pushIncoming: num(c.pushIncoming, d.pushIncoming), pushBack: num(c.pushBack, d.pushBack), extension: num(c.extension, d.extension),
      extensionsPerRack: num(c.extensionsPerRack, d.extensionsPerRack), hillHill: num(c.hillHill, d.hillHill), warnAt: num(c.warnAt, d.warnAt) } };
  }
  // Settings from before rule sets: shot, firstShot, extension, extensionsPerRack, warnAt.
  const old = { shot: num(r.shot, 30), firstShot: num(r.firstShot, 60), extension: num(r.extension, 30), per: num(r.extensionsPerRack, 1), warnAt: num(r.warnAt, 10) };
  const isOldDefault = old.shot === 30 && old.firstShot === 60 && old.extension === 30 && old.per === 1 && old.warnAt === 10;
  const custom: ClockRules = { ...RULE_SETS.matchroom.rules, shot: old.shot, afterBreak: old.firstShot, extension: old.extension, extensionsPerRack: old.per, warnAt: old.warnAt };
  return { ruleSet: isOldDefault ? 'matchroom' : 'custom', custom, volume, names };
}
