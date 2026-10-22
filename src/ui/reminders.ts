import { useEffect } from 'preact/hooks';
import type { AppData } from '../app';
import type { DrillDef } from '../engine/drills';
import type { Game } from '../engine/games';
import type { TallySession } from '../engine/tally';
import { DEFAULT_REMINDERS, planReminders, REMINDER_IDS, type ReminderPrefs } from '../engine/reminders';
import { scheduleReminders } from '../notify';
import { activities } from './HistoryScreen';

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
export function useReminders(loaded: boolean, data: AppData, tallies: TallySession[], games: Game[], drills: DrillDef[], prefsVersion: number) {
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      const acts = activities(data, tallies, games, drills).filter(a => !a.live);
      const last = acts.length ? new Date(Math.max(...acts.map(a => Date.parse(a.date)))) : null;
      const lastDay = last ? acts.filter(a => sameDay(new Date(a.date), last)).map(a => ({ title: a.title, detail: a.detail })) : [];
      const plan = planReminders(loadReminderPrefs(), last, lastDay);
      scheduleReminders(Object.values(REMINDER_IDS), plan);
    }, 1500);
    return () => clearTimeout(t);
  }, [loaded, data.exclusions, tallies, games, prefsVersion]);
}
