// Checking GitHub for a newer Android release. Only the Android app checks: the web
// version updates itself, and the single-file version is replaced by hand.
// The check is a plain request to GitHub's public API; it sends nothing about you.

import { getJson, isNative } from './platform';
import { CHECK_EVERY_MS, readRelease, SNOOZE_MS, type ReleaseInfo, type UpdateMemory } from './engine/update';
import { REPO } from './version';

const KEY = 'ec-update';
const load = (): UpdateMemory => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as UpdateMemory; } catch { return {}; } };
const save = (m: UpdateMemory) => { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* per-device only */ } };

export const canCheckForUpdates = () => isNative();
export const updateMemory = load;

/** Ask GitHub for the latest release. Throws when GitHub can't be reached. */
export async function fetchLatest(): Promise<ReleaseInfo | null> {
  const latest = readRelease(await getJson(`https://api.github.com/repos/${REPO}/releases/latest`));
  save({ ...load(), lastCheck: Date.now(), latest });
  return latest;
}

/** At launch: the release GitHub reported, rechecked when the last look is over 12 hours old. Null when offline. */
export async function launchCheck(): Promise<ReleaseInfo | null> {
  if (!canCheckForUpdates()) return null;
  const m = load();
  if (m.lastCheck && Date.now() - m.lastCheck < CHECK_EVERY_MS && m.latest !== undefined) return m.latest;
  try { return await fetchLatest(); } catch { return m.latest ?? null; }
}

export const snooze = () => save({ ...load(), snoozedUntil: Date.now() + SNOOZE_MS });
export const skipVersion = (v: string) => save({ ...load(), skipped: v });
