import { describe, it, expect } from 'vitest';
import { backAction, navStep, viewKey } from '../src/nav';

describe('back navigation', () => {
  const k = (tab: string, drill: string | null = null, tally = false) => viewKey({ tab, drillOpen: drill, tallyOpen: tally });
  it('adds an entry for a new screen, nothing for the same one', () => {
    expect(navStep([k('home')], 0, k('settings'))).toBe('push');
    expect(navStep([k('home'), k('settings')], 1, k('settings'))).toBe('none');
  });
  it('steps back instead of piling up when returning to the screen before', () => {
    // drill page → tally → tally finished (drill page again)
    expect(navStep([k('drills', 'xdrill'), k('drills', 'xdrill', true)], 1, k('drills', 'xdrill'))).toBe('back');
  });
  it('replaces when asked (Home from the top level)', () => {
    expect(navStep([k('settings')], 0, k('home'), true)).toBe('replace');
  });
  it('back gesture: drawer, then previous screen, then Home, then leave', () => {
    expect(backAction(true, 3, 'drills')).toBe('closeDrawer');
    expect(backAction(false, 2, 'drills')).toBe('back');
    expect(backAction(false, 0, 'settings')).toBe('home');
    expect(backAction(false, 0, 'home')).toBe('exit');
  });
});
