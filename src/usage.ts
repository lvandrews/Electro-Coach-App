// Sending anonymous usage counts (see engine/usage.ts for exactly what is sent).
//
// On by default, with a one-time notice and a switch in Settings. Until the notice has been
// seen and either accepted or left in place for a minute, events wait in memory; turning the
// switch off drops them and stops sending. With no app key set, nothing is ever sent.

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { buildEvent, endpointFor, nextSession, type AptabaseEvent, type UsageEvent, type UsageProps } from './engine/usage';

/**
 * The Aptabase app key, from the Aptabase dashboard (Settings → Instructions). It isn't a
 * secret: every app that uses Aptabase ships its key inside the app.
 */
export const APTABASE_APP_KEY = 'A-US-3054736082';

declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

const K_ON = 'ec-usage', K_NOTICE = 'ec-usage-notice', K_FIRST = 'ec-first-open';
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };

export const usageConfigured = () => endpointFor(APTABASE_APP_KEY) != null;
export const usageOn = () => get(K_ON) !== 'off';
export const noticeAnswered = () => get(K_NOTICE) === 'done';

const listeners = new Set<() => void>();
export const onUsageChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const changed = () => listeners.forEach(fn => fn());

let session: { id: string; last: number } | null = null;
let held: AptabaseEvent[] = [];
let released = false;
let holdTimer: ReturnType<typeof setTimeout> | null = null;
const seenScreens = new Set<string>();

/** Where this copy of the app is running: android, ios (a future native app), iphone-web, web-installed, web-file or web. */
export function platformName(): string {
  if (Capacitor.isNativePlatform()) return Capacitor.getPlatform();
  if (typeof location !== 'undefined' && location.protocol === 'file:') return 'web-file';
  const standalone = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
  const ios = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
  return ios ? (standalone ? 'iphone-home-screen' : 'iphone-web') : standalone ? 'web-installed' : 'web';
}

async function send(ev: AptabaseEvent) {
  const url = endpointFor(APTABASE_APP_KEY);
  if (!url) return;
  if (ev.eventName === 'first_open') set(K_FIRST, '1');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'App-Key': APTABASE_APP_KEY.trim() };
  try {
    if (Capacitor.isNativePlatform()) {
      // Native HTTP: no browser cross-site limits. The browser's user agent lets Aptabase show the OS.
      headers['User-Agent'] = navigator.userAgent;
      await CapacitorHttp.post({ url, headers, data: ev });
    } else {
      await fetch(url, { method: 'POST', headers, credentials: 'omit', keepalive: true, body: JSON.stringify(ev) });
    }
  } catch { /* offline or blocked: usage counts are never worth an error */ }
}

function release() {
  if (released) return;
  released = true;
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  const q = held; held = [];
  if (usageOn()) q.forEach(send);
}

/** Count one use of a feature. Does nothing when switched off or not configured. */
export function track(name: UsageEvent, props?: UsageProps) {
  if (!usageConfigured() || !usageOn()) return;
  const now = Date.now();
  session = nextSession(session, now);
  const ev = buildEvent(name, props, {
    sessionId: session.id, now: new Date(now),
    locale: (typeof navigator !== 'undefined' && navigator.language) || 'en-US',
    appVersion: APP_VERSION, isDebug: !!import.meta.env.DEV,
  });
  if (released) send(ev); else held.push(ev);
}

/** A screen counts once per launch, so the numbers show what gets used rather than how much people tap around. */
export function trackScreen(screen: string) {
  if (seenScreens.has(screen)) return;
  seenScreens.add(screen);
  track('screen', { screen });
}

/** Count a feature at most once per launch (the shot clock, say, which restarts every shot). */
const seenOnce = new Set<string>();
export function trackOnce(name: UsageEvent, props?: UsageProps) {
  if (seenOnce.has(name)) return;
  seenOnce.add(name);
  track(name, props);
}

/** Call once at launch. */
export function startUsage() {
  if (!usageConfigured()) return;
  const platform = platformName();
  if (!get(K_FIRST)) track('first_open', { platform });   // marked done once actually sent
  track('app_started', { platform });
  if (noticeAnswered()) release();
  else holdTimer = setTimeout(release, 60_000);   // the notice has been on screen for a minute
}

/** The notice's "OK". */
export function acceptNotice() { set(K_NOTICE, 'done'); release(); changed(); }

/** The notice's "Turn off", or the Settings switch. */
export function setUsageOn(on: boolean) {
  set(K_ON, on ? 'on' : 'off');
  set(K_NOTICE, 'done');
  if (!on) { held = []; released = true; if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } }
  else release();
  changed();
}
