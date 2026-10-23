import { useEffect } from 'preact/hooks';
import type { AppData } from '../app';
import type { DrillDef } from '../engine/drills';
import type { Game } from '../engine/games';
import type { TallySession } from '../engine/tally';
import { DEFAULT_REMINDERS, planReminders, REMINDER_IDS, type ReminderPrefs } from '../engine/reminders';
import { scheduleReminders } from '../notify';
import { activities } from './HistoryScreen';
import { buildPlan, type PlanSettings } from '../engine/plan';
import type { Baseline } from '../engine/progress';
import { rowsFor } from './ProgressScreen';

const KEY = 'ec-reminders';
const listeners = new Set<() => void>();

export function loadReminderPrefs(): ReminderPrefs {
  try { return { ...DEFAULT_REMINDERS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return DEFAULT_REMINDERS; }
}
export function saveReminderPrefs(p: ReminderPrefs) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* per-device convenience only */ }
  listeners.forEach(f => f());
}
export function onReminderPrefs(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Keep the reminder notifications in step with what has been logged (Android only). */
export function useReminders(loaded: boolean, data: AppData, tallies: TallySession[], games: Game[], drills: DrillDef[], prefsVersion: number, baseline: Baseline | null, plan: PlanSettings) {
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      const acts = activities(data, tallies, games, drills).filter(a => !a.live);
      const last = acts.length ? new Date(Math.max(...acts.map(a => Date.parse(a.date)))) : null;
      const lastDay = last ? acts.filter(a => sameDay(new Date(a.date), last))
        .map(a => ({ title: a.title, detail: a.detail, made: a.made, attempts: a.attempts, verdict: a.verdict })) : [];
      // What you're working on: the practice plan's top target (one you haven't hidden).
      let focus: string | null = null;
      try {
        if (baseline && data.shots.size) {
          const rows = rowsFor(data);
          if (rows.length) focus = buildPlan(baseline, rows, plan.period).targets.find(t => !plan.hidden.includes(t.label) && t.group !== 'Session type')?.label ?? null;
        }
      } catch { /* the recap falls back to the day's weakest drill */ }
      scheduleReminders(Object.values(REMINDER_IDS), planReminders(loadReminderPrefs(), last, lastDay, new Date(), focus));
    }, 1500);
    return () => clearTimeout(t);
  }, [loaded, data.exclusions, tallies, games, prefsVersion, baseline, plan.period, plan.hidden]);
}
