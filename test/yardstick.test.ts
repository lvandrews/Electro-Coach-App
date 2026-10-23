import { describe, it, expect } from 'vitest';
import { defaultCutoff, isOldDefault, recentRule, type Baseline } from '../src/engine/progress';
import type { ModelRow } from '../src/engine/model';

const DAY = 86400000;
const now = Date.parse('2026-10-23T20:00:00Z');
/** Sessions as [days ago, shots]. */
function rows(sessions: [number, number][]): ModelRow[] {
  const out: ModelRow[] = [];
  sessions.forEach(([ago, n], i) => {
    const start = new Date(now - ago * DAY).toISOString();
    for (let k = 0; k < n; k++) out.push({ shot: { sessionStart: start, sessionId: i } as ModelRow['shot'], x: [], y: 1 });
  });
  return out;
}
const iso = (ago: number) => new Date(now - ago * DAY).toISOString();

describe('default yardstick cutoff', () => {
  it('the last 30 days, when they hold 100+ shots', () => {
    const r = rows([[200, 400], [60, 200], [20, 60], [5, 50]]);
    expect(defaultCutoff(r, now)).toBe(iso(60));
    expect(recentRule(r, iso(60), now)).toBe('days');
  });
  it('fewer than 100 shots in 30 days: the latest whole sessions adding up to 100+', () => {
    // 3 sessions in the last week hold 97 shots, so the 4th (89 shots, 40 days ago) joins them: 186
    const r = rows([[300, 500], [100, 90], [40, 89], [6, 30], [3, 35], [1, 32]]);
    expect(defaultCutoff(r, now)).toBe(iso(100));
    expect(recentRule(r, iso(100), now)).toBe('sessions');
  });
  it('no play in the last 30 days: the most recent 100+ shots', () => {
    const r = rows([[400, 500], [90, 60], [70, 60]]);
    expect(defaultCutoff(r, now)).toBe(iso(400));
  });
  it('too little earlier play for a steady yardstick: everything so far', () => {
    const r = rows([[90, 150], [10, 120]]);
    expect(defaultCutoff(r, now)).toBe(iso(10));
    expect(recentRule(r, iso(10), now)).toBe('all');
  });
  it('moves an older "everything so far" yardstick, but not one chosen by hand', () => {
    const r = rows([[300, 500], [60, 100], [2, 85]]);
    const old = { cutoff: iso(60), createdAt: iso(10) } as Baseline;          // nothing between cutoff and freezing
    expect(isOldDefault(old, r)).toBe(true);
    const chosen = { cutoff: iso(300), createdAt: iso(10) } as Baseline;      // a session sits between: picked by hand
    expect(isOldDefault(chosen, r)).toBe(false);
    expect(isOldDefault({ ...old, auto: true }, r)).toBe(false);
  });
});
