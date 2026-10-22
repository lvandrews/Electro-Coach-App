import { describe, it, expect } from 'vitest';
import { DEFAULT_REMINDERS, planReminders, REMINDER_IDS } from '../src/engine/reminders';

describe('practice reminders', () => {
  const last = new Date(2026, 9, 20, 19, 30);          // Tue 20 Oct, 7:30 pm
  const day = [{ title: 'Transitions-1', detail: '3 of 8 racks run out' }, { title: 'Spot shot', detail: '41 kept shots, made 78%' }];
  it('nudges at 3 and 7 days and recaps the next morning', () => {
    const p = planReminders(DEFAULT_REMINDERS, last, day, new Date(2026, 9, 20, 20, 0));
    expect(p.map(n => n.id)).toEqual([REMINDER_IDS.nudge3, REMINDER_IDS.nudge7, REMINDER_IDS.recap]);
    expect(p[0].at).toEqual(new Date(2026, 9, 23, 18, 0));
    expect(p[1].at).toEqual(new Date(2026, 9, 27, 18, 0));
    expect(p[2].at).toEqual(new Date(2026, 9, 21, 9, 0));
    expect(p[2].body).toBe('Transitions-1: 3 of 8 racks run out · Spot shot: 41 kept shots, made 78%.');
  });
  it('drops reminders already past, honors the switches, and stays quiet with nothing logged', () => {
    expect(planReminders(DEFAULT_REMINDERS, last, day, new Date(2026, 9, 24)).map(n => n.id)).toEqual([REMINDER_IDS.nudge7]);
    expect(planReminders({ ...DEFAULT_REMINDERS, nudges: false }, last, day, new Date(2026, 9, 20, 20)).map(n => n.id)).toEqual([REMINDER_IDS.recap]);
    expect(planReminders(DEFAULT_REMINDERS, null, [], new Date())).toEqual([]);
  });
});
