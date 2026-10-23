import { describe, it, expect } from 'vitest';
import { DEFAULT_REMINDERS, planReminders, recapNote, REMINDER_IDS } from '../src/engine/reminders';

describe('practice reminders', () => {
  const last = new Date(2026, 9, 20, 19, 30);          // Tue 20 Oct, 7:30 pm
  const day = [
    { title: 'Transitions-1', detail: '3 of 8 racks run out, 81% of shots made', made: 52, attempts: 64 },
    { title: 'Spot shot', detail: '41 kept shots, made 78%', made: 32, attempts: 41 },
  ];
  it('nudges at 3 and 7 days and recaps the next morning', () => {
    const p = planReminders(DEFAULT_REMINDERS, last, day, new Date(2026, 9, 20, 20, 0));
    expect(p.map(n => n.id)).toEqual([REMINDER_IDS.nudge3, REMINDER_IDS.nudge7, REMINDER_IDS.recap]);
    expect(p[0].at).toEqual(new Date(2026, 9, 23, 18, 0));
    expect(p[1].at).toEqual(new Date(2026, 9, 27, 18, 0));
    expect(p[2].at).toEqual(new Date(2026, 9, 21, 9, 0));
    expect(p[2].title).toBe('Yesterday: 80% made, 105 shots');
    expect(p[2].body).toBe('Went well: Transitions-1, 81% of 64. Working on: Spot shot, 78% of 41.');
    expect(p[2].largeBody).toContain('• Spot shot: 41 kept shots, made 78%');
    expect(p[2].open).toBe('history');
  });
  it('drops reminders already past, honors the switches, and stays quiet with nothing logged', () => {
    expect(planReminders(DEFAULT_REMINDERS, last, day, new Date(2026, 9, 24)).map(n => n.id)).toEqual([REMINDER_IDS.nudge7]);
    expect(planReminders({ ...DEFAULT_REMINDERS, nudges: false }, last, day, new Date(2026, 9, 20, 20)).map(n => n.id)).toEqual([REMINDER_IDS.recap]);
    expect(planReminders(DEFAULT_REMINDERS, null, [], new Date())).toEqual([]);
  });

  it('recap: a stroke set at the move-up bar beats a higher raw rate; the plan target is what you are working on', () => {
    const r = recapNote([
      { title: 'Free play', detail: '', made: 45, attempts: 50 },
      { title: 'X-drill', detail: '', made: 25, attempts: 30, verdict: 'good' },
      { title: 'Thin cuts 1', detail: '', made: 4, attempts: 10 },
    ], 'Center (tangent line), 20–45°');
    expect(r.body).toBe('Went well: X-drill, 83% of 30. Working on: Center (tangent line), 20–45°.');
  });
  it('recap without shot counts names what was done', () => {
    const r = recapNote([{ title: '10-ball bowling', detail: 'Score 142' }], null);
    expect(r.title).toBe('Yesterday at the table');
    expect(r.body).toBe('Went well: 10-ball bowling, Score 142.');
  });
});
