// Per-device settings for progressive drills: a manual level switch, adjustable
// thresholds, and handedness. Levels themselves are worked out from the saved tallies,
// so they travel with backups and tally transfers; only these choices live here.

import type { DrillDef } from '../engine/drills';
import { DEFAULT_THRESHOLDS, levelState, type LevelOverride, type LevelState, type Thresholds } from '../engine/progressive';
import type { TallySession } from '../engine/tally';

const K_OVERRIDE = 'ec-prog-level', K_TH = 'ec-prog-thresholds', K_HAND = 'ec-handed';
const read = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* per-device convenience */ } };

const listeners = new Set<() => void>();
export const onProgPrefs = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const changed = () => listeners.forEach(f => f());

export function getOverride(drillId: string): LevelOverride | null { return read<Record<string, LevelOverride>>(K_OVERRIDE, {})[drillId] ?? null; }
export function setLevel(drillId: string, level: number) {
  const all = read<Record<string, LevelOverride>>(K_OVERRIDE, {});
  all[drillId] = { level, at: new Date().toISOString() }; write(K_OVERRIDE, all); changed();
}

export function getThresholds(drillId: string): Thresholds { return { ...DEFAULT_THRESHOLDS, ...(read<Record<string, Partial<Thresholds>>>(K_TH, {})[drillId] ?? {}) }; }
export function setThresholds(drillId: string, th: Thresholds | null) {
  const all = read<Record<string, Thresholds>>(K_TH, {});
  if (th) all[drillId] = th; else delete all[drillId];
  write(K_TH, all); changed();
}

export type Hand = 'R' | 'L';
export const getHand = (): Hand => (read<Hand>(K_HAND, 'R') === 'L' ? 'L' : 'R');
export function setHand(h: Hand) { write(K_HAND, h); changed(); }

/** The drill's level right now: replayed from finished tallies, starting at any manual switch. */
export function drillLevel(d: DrillDef, tallies: TallySession[]): LevelState {
  if (!d.prog) return { level: 1, good: 0, poor: 0, mastered: false };
  return levelState(d.prog, tallies.filter(t => t.drillId === d.id), getThresholds(d.id), getOverride(d.id));
}

// ---------- player stage (drives which warm-ups and stroke drills the plan picks) ----------

export type Stage = 'new' | 'developing' | 'advanced';
export const STAGE_LABEL: Record<Stage, string> = { new: 'New', developing: 'Developing', advanced: 'Advanced' };
const K_STAGE = 'ec-stage';
export const getStageSetting = (): Stage | null => { const v = read<string | null>(K_STAGE, null); return v === 'new' || v === 'developing' || v === 'advanced' ? v : null; };
export function setStage(s: Stage | null) { if (s) write(K_STAGE, s); else { try { localStorage.removeItem(K_STAGE); } catch { /* ignore */ } } changed(); }

/**
 * Suggested from the stroke drills: X-drill at Level 3 → Advanced; three or more finished
 * stroke sets all still at Level 1 → New; otherwise (including no stroke sets yet) Developing.
 */
export function suggestStage(drills: DrillDef[], tallies: TallySession[]): Stage {
  const prog = drills.filter(d => d.prog?.progressive);
  const x = drills.find(d => d.id === 'xdrill');
  if (x && drillLevel(x, tallies).level >= 3) return 'advanced';
  const sets = tallies.filter(t => t.ended && prog.some(d => d.id === t.drillId)).length;
  if (sets >= 3 && prog.every(d => drillLevel(d, tallies).level <= 1)) return 'new';
  return 'developing';
}
export const getStage = (drills: DrillDef[], tallies: TallySession[]): Stage => getStageSetting() ?? suggestStage(drills, tallies);
