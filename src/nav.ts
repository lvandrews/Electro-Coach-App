// Back navigation. Every screen change becomes a browser history entry, so the Android back
// gesture (and a browser's Back button on the laptop version) returns to the previous screen
// instead of closing the app. Pure decision logic here; app.tsx wires it to history and the
// Capacitor back-button event.

export interface View { tab: string; drillOpen: string | null; tallyOpen: boolean }
export const viewKey = (v: View) => `${v.tab}|${v.drillOpen ?? ''}|${v.tallyOpen ? 1 : 0}`;

export type Step = 'none' | 'push' | 'replace' | 'back';

/**
 * What to do with history when the screen changes.
 * - same screen as the current entry: nothing (this is also what happens after Back);
 * - the screen just before this one (finishing a tally, a "back to the list" button): step back,
 *   so the trail doesn't fill with duplicates;
 * - `replace`: going Home from the top level, so Back from Home closes the app;
 * - anything else: a new entry.
 */
export function navStep(keys: string[], idx: number, next: string, replace = false): Step {
  if (keys[idx] === next) return 'none';
  if (replace) return 'replace';
  if (idx > 0 && keys[idx - 1] === next) return 'back';
  return 'push';
}

export type BackAction = 'closeDrawer' | 'back' | 'home' | 'exit';
/** The Android back gesture: close the drawer, else the previous screen, else Home, else leave the app. */
export function backAction(drawerOpen: boolean, idx: number, tab: string): BackAction {
  if (drawerOpen) return 'closeDrawer';
  if (idx > 0) return 'back';
  if (tab !== 'home') return 'home';
  return 'exit';
}
