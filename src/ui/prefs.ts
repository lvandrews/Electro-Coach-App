import { useEffect, useState } from 'preact/hooks';

// Appearance preferences, kept per device (a phone can be dark while a laptop is
// light). Stored in localStorage so they apply before the database opens, with no
// flash of the wrong theme. Applied as data-* attributes on <html>; the colors
// themselves live in styles.css.

export type ThemePref = 'system' | 'dark' | 'light';
export type DataPalette = 'blue' | 'teal' | 'violet' | 'amber';
export type TierPalette = 'green-red' | 'blue-orange';
export type HeatPalette = 'green-red' | 'viridis';

export interface Prefs { theme: ThemePref; data: DataPalette; tiers: TierPalette; heat: HeatPalette; bar: string[] }
export const DEFAULT_PREFS: Prefs = { theme: 'system', data: 'blue', tiers: 'green-red', heat: 'green-red', bar: ['home', 'practice', 'play', 'progress'] };

const KEY = 'ec-appearance';
let current: Prefs = load();
const listeners = new Set<(p: Prefs) => void>();

function load(): Prefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEFAULT_PREFS }; }
}

export function applyPrefs(p: Prefs = current) {
  const el = document.documentElement;
  if (p.theme === 'system') delete el.dataset.theme; else el.dataset.theme = p.theme;
  el.dataset.palette = p.data;
  el.dataset.tiers = p.tiers;
}

export function getPrefs() { return current; }

export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private mode: keep for this session */ }
  applyPrefs(current);
  listeners.forEach(f => f(current));
}

export function usePrefs(): Prefs {
  const [p, setP] = useState(current);
  useEffect(() => { listeners.add(setP); return () => { listeners.delete(setP); }; }, []);
  return p;
}
