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
