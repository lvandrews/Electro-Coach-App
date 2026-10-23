// Checking GitHub for a newer Android release. Only the Android app checks: the web
// version updates itself, and the single-file version is replaced by hand.
// The check is a plain request to GitHub's public API; it sends nothing about you.

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { getJson, isNative } from './platform';
import { CHECK_EVERY_MS, readRelease, SNOOZE_MS, type ReleaseInfo, type UpdateMemory } from './engine/update';
import { REPO } from './version';

/** The release page's stable link to the newest APK (the build uploads it as electro-coach.apk on every release). */
export const LATEST_APK_URL = `https://github.com/${REPO}/releases/latest/download/electro-coach.apk`;

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

/** "Later" on one version: quiet for a day, but a newer version is still offered straight away. */
export const snooze = (version: string) => save({ ...load(), snoozedUntil: Date.now() + SNOOZE_MS, snoozedVersion: version });
export const skipVersion = (v: string) => save({ ...load(), skipped: v });

// ---------- downloading and installing inside the app (Android; AppUpdatePlugin.java) ----------

interface AppUpdatePlugin {
  download(o: { url: string; version: string }): Promise<{ path: string; bytes: number }>;
  install(o: { path: string }): Promise<{ started?: boolean; needsPermission?: boolean }>;
  addListener(event: 'progress', fn: (p: { received: number; total: number }) => void): Promise<PluginListenerHandle>;
}
const AppUpdate = registerPlugin<AppUpdatePlugin>('AppUpdate');

/** Download the release's APK into the app (progress as a 0–1 fraction, or null when the size is unknown). Returns the file path. */
export async function downloadUpdate(rel: ReleaseInfo, onProgress: (frac: number | null, received: number) => void): Promise<string> {
  const url = rel.apkUrl ?? LATEST_APK_URL;
  const h = await AppUpdate.addListener('progress', p => onProgress(p.total > 0 ? p.received / p.total : null, p.received));
  try { return (await AppUpdate.download({ url, version: rel.version })).path; }
  finally { void h.remove(); }
}

/** Open Android's installer. 'permission' when the user must first allow Electro-Coach to install apps (the setting has been opened). */
export async function installUpdate(path: string): Promise<'started' | 'permission'> {
  const r = await AppUpdate.install({ path });
  return r.needsPermission ? 'permission' : 'started';
}
