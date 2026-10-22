import { describe, it, expect } from 'vitest';
import { addInning, bowlingCard, bowlingStats, undoInning, spBall, spBreakChoice, spEnd, spState, spUndo, bpi, type StraightPoolMatch, type BowlingGame } from '../src/engine/games';

const play = (rolls: number[]) => rolls.reduce((f, r) => addInning(f, r), [] as number[][]);

describe('10-ball bowling scoring', () => {
  it('scores a perfect game, all spares and a gutter game', () => {
    expect(bowlingCard(play(Array(12).fill(10))).total).toBe(300);
    expect(bowlingCard(play(Array(21).fill(5))).total).toBe(150);
    expect(bowlingCard(play(Array(20).fill(0))).total).toBe(0);
  });
  it('scores the classic example (167) with the right marks', () => {
    const f = play([10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1]);
    const c = bowlingCard(f);
    expect(c.total).toBe(167);
    expect(c.cumulative).toEqual([20, 39, 48, 66, 74, 84, 90, 120, 148, 167]);
    expect(c.marks[0]).toEqual(['X']);
    expect(c.marks[1]).toEqual(['7', '/']);
    expect(c.marks[2]).toEqual(['9', '–']);
    expect(c.marks[9]).toEqual(['X', '8', '1']);
  });
  it('refuses impossible counts, waits for bonus innings, and undoes', () => {
    let f = play([7]);
    expect(addInning(f, 4)).toEqual(f);            // only 3 left in the rack
    f = play([10]);
    expect(bowlingCard(f).cumulative[0]).toBeNull(); // strike waits for two innings
    f = play([...Array(18).fill(0), 7, 3]);
    expect(bowlingCard(f).next).toEqual({ frame: 9, inning: 2, max: 10 });   // tenth-frame spare earns a bonus
    f = addInning(f, 10);
    expect(bowlingCard(f).complete).toBe(true);
    expect(bowlingCard(f).marks[9]).toEqual(['7', '/', 'X']);
    expect(undoInning(f)).toEqual(play([...Array(18).fill(0), 7, 3]));
  });
  it('summarizes games, including total-only entries', () => {
    const g = (frames: number[][] | null, total?: number): BowlingGame => ({ id: String(Math.random()), kind: 'bowling', date: '', updated: '', frames, total, source: 'scored', device: '' });
    const s = bowlingStats([g(play(Array(12).fill(10))), g(null, 150)]);
    expect(s.games).toBe(2); expect(s.average).toBe(225); expect(s.best).toBe(300); expect(s.strikeRate).toBe(1);
  });
});

describe('straight pool scoring', () => {
  const m0: StraightPoolMatch = { id: 'm', kind: 'straight-pool', date: '', updated: '', players: ['Me', 'Them'], raceTo: 20, first: 0, innings: [], device: '' };
  const balls = (m: StraightPoolMatch, n: number) => { for (let i = 0; i < n; i++) m = spBall(m); return m; };
  it('counts runs, innings, high run, fouls and the rack', () => {
    let m = spEnd(m0, 'breakFoul');                 // −2, opponent to shoot
    expect(spState(m).score).toEqual([-2, 0]);
    expect(spState(m).shooter).toBe(1);
    m = spEnd(balls(m, 9), 'miss');                 // them: run of 9
    m = spEnd(balls(m, 6), 'safety');               // me: 6
    let s = spState(m);
    expect(s.score).toEqual([4, 9]); expect(s.highRun).toEqual([6, 9]); expect(s.innings).toEqual([2, 1]);
    expect(s.onTable).toBe(15 - (15 % 14));         // 15 made → one re-rack done, 14 left
    expect(bpi(s, 0)).toBe(3);
  });
  it('applies the three-foul penalty', () => {
    let m = spEnd(m0, 'safety');
    for (let k = 0; k < 3; k++) { m = spEnd(m, 'miss'); m = spEnd(m, 'foul'); }   // them: miss; me: foul — three times
    const s = spState(m);
    expect(s.score[0]).toBe(-18);                   // three fouls running: −3 and a further −15
    expect(s.consecutiveFouls[0]).toBe(0);          // the count starts again
    let m2 = spEnd(m0, 'foul'); m2 = spEnd(m2, 'miss'); m2 = spEnd(spBall(m2), 'foul'); m2 = spEnd(m2, 'miss'); m2 = spEnd(m2, 'foul');
    expect(spState(m2).score[0]).toBe(1 - 3);       // a ball made in between resets the run of fouls
  });
  it('after a third foul the offender breaks a full rack again', () => {
    let m = spEnd(m0, 'safety');
    for (let k = 0; k < 3; k++) { m = spEnd(m, 'miss'); m = spEnd(m, 'foul'); }
    const s = spState(m);
    expect(s.shooter).toBe(0); expect(s.opening).toBe(true); expect(s.onTable).toBe(15);
    expect(spState(spEnd(m, 'breakFoul')).consecutiveFouls[0]).toBe(0);   // breaking fouls don't count toward three
  });
  it('after a break foul the opponent accepts the table or makes the breaker break again', () => {
    let m = spEnd(m0, 'breakFoul');
    expect(spState(m).breakChoice).toBe(true);
    const accept = spBreakChoice(m, false);
    expect(spState(accept)).toMatchObject({ breakChoice: false, shooter: 1, opening: false });
    const again = spBreakChoice(m, true);
    expect(spState(again)).toMatchObject({ breakChoice: false, shooter: 0, opening: true, onTable: 15 });
    expect(spState(spEnd(again, 'breakFoul')).score[0]).toBe(-4);
    expect(spState(spUndo(again)).breakChoice).toBe(true);
  });
  it('re-racks at one ball, ends the match at the race, and undoes', () => {
    let m = balls(m0, 14);
    expect(spState(m).rerack).toBe(true);
    m = balls(m, 6);
    expect(spState(m).winner).toBe(0);
    expect(spBall(m)).toBe(m);                      // nothing after the win
    m = spUndo(m);
    expect(spState(m).winner).toBeNull();
    expect(spState(m).score[0]).toBe(19);
  });
});

import { drillMeters } from '../src/engine/progress';
import { BUILTIN_DRILLS } from '../src/engine/drills';
describe('bowling on the Progress drill meters', () => {
  it('shows game scores, last five against earlier', () => {
    const mk = (d: string, total: number): BowlingGame => ({ id: d, kind: 'bowling', date: `${d}T12:00:00Z`, updated: '', frames: null, total, source: 'imported', device: '' });
    const games = [140, 150, 160, 150, 170, 180, 175, 185, 190, 200, 195].map((t, i) => mk(`2026-09-${String(i + 1).padStart(2, '0')}`, t));
    const m = drillMeters(BUILTIN_DRILLS, [], [], games).find(x => x.drill.id === 'bowling-10')!;
    expect(m.kind).toBe('score'); expect(m.max).toBe(300);
    expect(m.recent!.sessions).toBe(5);
    expect(m.recent!.value).toBeCloseTo((185 + 190 + 200 + 195 + 175) / 5, 6);
    expect(m.earlier!.value).toBeCloseTo((140 + 150 + 160 + 150 + 170 + 180) / 6, 6);
  });
});
