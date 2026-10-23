// Everything the session builder needs, gathered from app state, so the Plan preview and
// the session review build the same session.

import type { AppData } from '../app';
import type { DrillDef } from '../engine/drills';
import type { Game } from '../engine/games';
import { buildPlan, sessionBlocks, DEFAULT_PLAN, type PlanSettings } from '../engine/plan';
import type { Baseline } from '../engine/progress';
import type { TallySession } from '../engine/tally';
import { composeSession, filmedThisWeek, type Composed, type Kind } from '../engine/workout';
import { drillLevel, getStage } from './progPrefs';
import { rowsFor } from './ProgressScreen';

export interface SessionCtx { data: AppData; baseline: Baseline | null; plan: PlanSettings; drills: DrillDef[]; tallies: TallySession[]; games: Game[] }

export function railbirdStarts(data: AppData): string[] {
  const seen = new Set<string>();
  for (const s of data.shotList) seen.add(s.sessionStart);
  return [...seen];
}

export function filmingStatus(c: SessionCtx) {
  const perWeek = c.plan.filmPerWeek ?? DEFAULT_PLAN.filmPerWeek!;
  const done = filmedThisWeek(c.games, railbirdStarts(c.data));
  return { perWeek, done, due: done < perWeek, minutes: c.plan.filmMinutes ?? DEFAULT_PLAN.filmMinutes! };
}

export function composeFor(c: SessionCtx, kind: Kind, film?: boolean): Composed & { hasPlan: boolean } {
  const rows = c.baseline && c.data.shots.size ? rowsFor(c.data) : [];
  const plan = c.baseline && rows.length ? buildPlan(c.baseline, rows, c.plan.period) : null;
  const f = filmingStatus(c);
  const byId = new Map(c.drills.map(d => [d.id, d]));
  const out = composeSession({
    kind, planBlocks: plan ? sessionBlocks(plan, c.plan.hidden, c.plan.minutes) : null, minutes: c.plan.minutes,
    drills: c.drills, games: c.games, tallies: c.tallies, stage: getStage(c.drills, c.tallies),
    level: id => { const d = byId.get(id); return d ? drillLevel(d, c.tallies).level : 1; },
    timing: c.plan.timing ?? 'finish', film: film ?? f.due, filmMinutes: f.minutes,
  });
  return { ...out, hasPlan: !!plan };
}

export const ADAPT_NOTE = 'Block times adapt to you. The first times are estimates; adjust any block if it looks off. After each session, the plan suggests times from how long each drill actually took you.';
