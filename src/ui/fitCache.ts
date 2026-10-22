import type { AppData } from '../app';
import { fitModel, type ModelFit, type ModelRow } from '../engine/model';
import { speedProfile, type SpeedProfile } from '../engine/speed';
import { routineFacts, type RoutineFacts } from '../engine/facts';
import { bestShots, type BestShot } from '../engine/best';
import { rowsFor } from './ProgressScreen';

// One fit of the expected-make model on all kept shots, shared by the Model screen,
// the speed profile and the routine's numbers. `data.exclusions` is a new Map
// whenever shots or rules change, so it is the cache key.

let cache: { key: unknown; fit: ModelFit | null; speed?: SpeedProfile; facts?: RoutineFacts | null; best?: BestShot[] } | null = null;

const entry = (data: AppData) => {
  if (cache?.key !== data.exclusions) {
    let fit: ModelFit | null = null;
    try { fit = fitModel(rowsFor(data)); } catch { fit = null; }
    cache = { key: data.exclusions, fit };
  }
  return cache;
};

export function fitFor(data: AppData): { rows: ModelRow[]; fit: ModelFit } | null {
  if (!data.shots.size) return null;
  const e = entry(data);
  return e.fit ? { rows: rowsFor(data), fit: e.fit } : null;
}

export function speedFor(data: AppData): SpeedProfile | null {
  if (!data.shots.size) return null;
  const e = entry(data);
  e.speed ??= speedProfile(rowsFor(data));
  return e.speed;
}

export function factsFor(data: AppData): RoutineFacts | null {
  const m = fitFor(data);
  if (!m) return null;
  const e = entry(data);
  if (e.facts === undefined) e.facts = routineFacts(m.fit, m.rows);
  return e.facts;
}

/** The kinds of shot you make most reliably. */
export function bestFor(data: AppData): BestShot[] {
  if (!data.shots.size) return [];
  const e = entry(data);
  e.best ??= bestShots(rowsFor(data), 5);
  return e.best;
}
