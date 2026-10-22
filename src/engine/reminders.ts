// Practice reminders (Android notifications). Gentle by design: two nudges after a gap
// in logging (3 and 7 days), then quiet until you log again; and a recap the morning
// after a day you practiced. Everything is rescheduled whenever something is logged,
// so a nudge never arrives after you've already practiced.

export interface ReminderPrefs {
  nudges: boolean;        // 3- and 7-day reminders
  recap: boolean;         // next-morning recap of the last practice day
  nudgeHour: number;      // local hour for nudges
  recapHour: number;      // local hour for the recap
}
export const DEFAULT_REMINDERS: ReminderPrefs = { nudges: true, recap: true, nudgeHour: 18, recapHour: 9 };

export const NUDGE_DAYS = [3, 7] as const;
export const REMINDER_IDS = { nudge3: 7201, nudge7: 7202, recap: 7203 } as const;

export interface PlannedNote { id: number; at: Date; title: string; body: string }
export interface DayActivity { title: string; detail: string }

/** Local date at a given hour, `days` after the calendar day of `from`. */
export function dayAt(from: Date, days: number, hour: number): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days, hour, 0, 0, 0);
  return d;
}

/**
 * The notifications to schedule now. `last` is when you last logged practice (a tally,
 * game, match, timed session or Railbird session); `lastDay` is what you did on that day.
 */
export function planReminders(prefs: ReminderPrefs, last: Date | null, lastDay: DayActivity[], now = new Date()): PlannedNote[] {
  if (!last) return [];
  const out: PlannedNote[] = [];
  if (prefs.nudges) {
    const a = dayAt(last, NUDGE_DAYS[0], prefs.nudgeHour), b = dayAt(last, NUDGE_DAYS[1], prefs.nudgeHour);
    if (a > now) out.push({ id: REMINDER_IDS.nudge3, at: a, title: 'Time for some practice?',
      body: 'Nothing logged for 3 days. Your next session is ready in the practice plan.' });
    if (b > now) out.push({ id: REMINDER_IDS.nudge7, at: b, title: 'A week since your last practice',
      body: 'Pick up where you left off: the plan has a session ready, or log a quick drill.' });
  }
  if (prefs.recap && lastDay.length) {
    const r = dayAt(last, 1, prefs.recapHour);
    if (r > now) {
      const lines = lastDay.slice(0, 3).map(a => (a.detail ? `${a.title}: ${a.detail}` : a.title));
      out.push({ id: REMINDER_IDS.recap, at: r, title: 'Yesterday at the table',
        body: `${lines.join(' · ')}${lastDay.length > 3 ? ` · and ${lastDay.length - 3} more` : ''}.` });
    }
  }
  return out;
}
