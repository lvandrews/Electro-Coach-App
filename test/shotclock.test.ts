import { describe, expect, it } from 'vitest';
import {
  RULE_SETS, callPush, canPassBack, canPush, expire, extend, extensionsLeft, migrateSettings, newRack, passBack, pause,
  remaining, restore, shotPlayed, snapshot, start, turnOver,
} from '../src/engine/shotclock';

const M = RULE_SETS.matchroom.rules;

describe('shot clock: Matchroom flow', () => {
  it('runs a rack with a push out passed back', () => {
    let s = newRack(M, 0);
    expect(s.stage).toBe('break'); expect(s.remainingMs).toBe(60_000);
    s = start(s, M, 0); expect(s.phase).toBe('running');
    expect(remaining(s, 10_000)).toBe(50_000);
    s = shotPlayed(s, M);                       // the break
    expect(s.stage).toBe('afterBreak'); expect(s.phase).toBe('played'); expect(s.remainingMs).toBe(60_000);
    s = turnOver(s, M);                          // nothing made on the break
    expect(s.shooter).toBe(1); expect(s.stage).toBe('afterBreak');
    expect(canPush(s)).toBe(true);
    s = start(s, M, 20_000); s = callPush(s); expect(s.pushCalled).toBe(true);
    s = shotPlayed(s, M);                        // the push out
    expect(s.stage).toBe('pushDecision'); expect(s.shooter).toBe(0); expect(s.remainingMs).toBe(60_000);
    expect(canPassBack(s)).toBe(true);
    s = start(s, M, 30_000);
    s = passBack(s, M, 35_000);
    expect(s.shooter).toBe(1); expect(s.stage).toBe('pushBack'); expect(s.phase).toBe('running');
    expect(remaining(s, 35_000)).toBe(30_000);
    s = shotPlayed(s, M); expect(s.stage).toBe('normal'); expect(s.remainingMs).toBe(30_000);
  });

  it('gives each player their own extension, and tapping yours makes you the shooter', () => {
    let s = start(shotPlayed(start(newRack(M, 0), M, 0), M), M, 1000);   // shooter 0 on the first shot after the break
    s = extend(s, M, 1);
    expect(s.shooter).toBe(1); expect(extensionsLeft(s, M, 1)).toBe(0); expect(extensionsLeft(s, M, 0)).toBe(1);
    expect(remaining(s, 1000)).toBe(90_000);
    expect(extend(s, M, 1)).toBe(s);            // none left
    s = extend(s, M, 0); expect(s.shooter).toBe(0); expect(extensionsLeft(s, M, 0)).toBe(0);
    expect(newRack(M, 1, s).extUsed).toEqual([0, 0]);
  });

  it('passes the table on a time foul', () => {
    let s = start(newRack(M, 0), M, 0);
    s = expire(s); expect(s.phase).toBe('expired');
    s = start(s, M, 70_000);
    expect(s.shooter).toBe(1); expect(s.stage).toBe('normal'); expect(remaining(s, 70_000)).toBe(30_000);
  });

  it('pauses and resumes without losing time', () => {
    let s = start(newRack(M, 0), M, 0);
    s = pause(s, 5000); expect(s.remainingMs).toBe(55_000);
    s = pause(s, 60_000); expect(remaining(s, 61_000)).toBe(54_000);
  });

  it('treats Turn over with the clock still running as a played shot', () => {
    let s = start(shotPlayed(start(newRack(M, 0), M, 0), M), M, 0);
    s = shotPlayed(s, M); s = start(s, M, 0);   // a normal shot by player 0
    s = turnOver(s, M);
    expect(s.phase).toBe('played'); expect(s.shooter).toBe(1); expect(s.stage).toBe('normal');
  });

  it('undo restores a running clock with the time it had left', () => {
    const s = start(newRack(M, 0), M, 0);
    const snap = snapshot(s, 12_000);
    const back = restore(snap, 50_000);
    expect(remaining(back, 50_000)).toBe(48_000);
  });

  it('skips the break clock when the rules do not time it', () => {
    const s = newRack(RULE_SETS.pbs.rules, 1);
    expect(s.stage).toBe('afterBreak'); expect(s.remainingMs).toBe(60_000); expect(s.shooter).toBe(1);
  });
});

describe('shot clock settings', () => {
  it('starts new users on Matchroom', () => {
    expect(migrateSettings(null).ruleSet).toBe('matchroom');
  });
  it('keeps old default settings on Matchroom and changed ones as Custom', () => {
    expect(migrateSettings({ shot: 30, firstShot: 60, extension: 30, extensionsPerRack: 1, warnAt: 10, volume: 0.5, names: ['Lela', 'Dean'] }))
      .toMatchObject({ ruleSet: 'matchroom', volume: 0.5, names: ['Lela', 'Dean'] });
    const c = migrateSettings({ shot: 45, firstShot: 60, extension: 30, extensionsPerRack: 1, warnAt: 10 });
    expect(c.ruleSet).toBe('custom'); expect(c.custom.shot).toBe(45); expect(c.custom.pushBack).toBe(30);
  });
  it('reads current settings back unchanged', () => {
    const cfg = { ruleSet: 'pbs', custom: { ...M, shot: 35 }, volume: 0.6, names: ['A', 'B'] };
    expect(migrateSettings(cfg)).toEqual(cfg);
  });
});
