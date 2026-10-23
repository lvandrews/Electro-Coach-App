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

export interface PlannedNote { id: number; at: Date; title: string; body: string; largeBody?: string; open?: string }
export interface DayActivity {
  title: string; detail: string;
  made?: number; attempts?: number;          // shots made / taken, where the activity counts them
  verdict?: 'good' | 'poor' | 'neither';     // stroke drills: against the move-up / move-down bars
}

const MIN_SHOTS = 5;   // an activity needs at least this many shots to be called a best or a weak spot
const rate = (a: DayActivity) => (a.attempts ? (a.made ?? 0) / a.attempts : 0);
const pctOf = (m: number, n: number) => `${Math.round((100 * m) / n)}%`;
const shotsText = (a: DayActivity) => (a.attempts! > 20 ? `${pctOf(a.made ?? 0, a.attempts!)} of ${a.attempts}` : `${a.made ?? 0} of ${a.attempts}`);

/**
 * The morning-after recap, short enough for a collapsed notification: the day's make rate,
 * one thing that went well, and one thing being worked on (the practice plan's top target
 * when there is one, otherwise the day's weakest drill). Expanding shows everything.
 */
export function recapNote(day: DayActivity[], focus: string | null): { title: string; body: string; largeBody: string } {
  const counted = day.filter(a => (a.attempts ?? 0) > 0);
  const made = counted.reduce((s, a) => s + (a.made ?? 0), 0), shots = counted.reduce((s, a) => s + a.attempts!, 0);
  const title = shots ? `Yesterday: ${pctOf(made, shots)} made, ${shots} shot${shots === 1 ? '' : 's'}` : 'Yesterday at the table';
  const ranked = counted.filter(a => a.attempts! >= MIN_SHOTS)
    .sort((a, b) => Number(b.verdict === 'good') - Number(a.verdict === 'good') || rate(b) - rate(a) || b.attempts! - a.attempts!);
  const best = ranked[0] ?? null;
  const uncounted = day.find(a => !a.attempts && a.detail);
  const well = best ? `${best.title}, ${shotsText(best)}` : uncounted ? `${uncounted.title}, ${uncounted.detail}` : null;
  const weak = ranked.length > 1 ? [...ranked].reverse().find(a => a !== best && (a.verdict === 'poor' || rate(a) < rate(best!))) ?? null : null;
  const work = focus ?? (weak ? `${weak.title}, ${shotsText(weak)}` : null);
  const parts = [well && `Went well: ${well}.`, work && `Working on: ${work}.`].filter(Boolean) as string[];
  const body = parts.length ? parts.join(' ') : `${day.slice(0, 2).map(a => a.title).join(' and ')}${day.length > 2 ? ` and ${day.length - 2} more` : ''}.`;
  const lines = day.map(a => `• ${a.detail ? `${a.title}: ${a.detail}` : a.title}`);
  return { title, body, largeBody: `${body}\n\n${lines.join('\n')}` };
}

/** Local date at a given hour, `days` after the calendar day of `from`. */
export function dayAt(from: Date, days: number, hour: number): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days, hour, 0, 0, 0);
  return d;
}

/**
 * The notifications to schedule now. `last` is when you last logged practice (a tally,
 * game, match, timed session or Railbird session); `lastDay` is what you did on that day.
 */
export function planReminders(prefs: ReminderPrefs, last: Date | null, lastDay: DayActivity[], now = new Date(), focus: string | null = null): PlannedNote[] {
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
    if (r > now) out.push({ id: REMINDER_IDS.recap, at: r, open: 'history', ...recapNote(lastDay, focus) });
  }
  return out;
}
