// FargoRate rating over time. FargoRate has no documented public API; the lookup
// uses the same search endpoint as the open-source `fargo` CLI (rgstephens/fargo-skill),
// which may change without notice. Manual entry always works.

export interface FargoEntry { date: string; rating: number; robustness?: number; provisional?: boolean; source: 'lookup' | 'manual' }
export interface FargoData {
  id?: string; name?: string; location?: string; entries: FargoEntry[];
  auto?: boolean;                                          // daily check when the app opens; on unless switched off
  notify?: boolean;                                        // notification when the daily check finds a change; on unless switched off
  lastCheck?: { at: string; ok: boolean; rating?: number; robustness?: number }; // the last check (ISO time)
}
export const EMPTY_FARGO: FargoData = { entries: [] };

export interface FargoPlayer { id: string; name: string; location: string; rating: number | null; provisional: boolean; robustness: number | null }

export const FARGO_SITE = 'https://fargorate.com/';
export const FARGO_API = 'https://dashboard.fargorate.com/api/indexsearch?q=';
/** FargoRate treats ratings built on fewer than 200 games as not yet established. */
export const ESTABLISHED = 200;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/** Read the search response defensively: an array of players, or an object holding one. */
export function parseFargo(json: unknown): FargoPlayer[] {
  let list: unknown[] = [];
  if (Array.isArray(json)) list = json;
  else if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    const k = ['value', 'results', 'players', 'data', 'items'].find(x => Array.isArray(o[x])) ?? Object.keys(o).find(x => Array.isArray(o[x]));
    if (k) list = o[k] as unknown[];
    else if ('readableId' in o || 'firstName' in o) list = [o];
  }
  const out: FargoPlayer[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, unknown>;
    const id = String(p.readableId ?? p.id ?? '').trim();
    if (!id) continue;
    const eff = num(p.effectiveRating), rat = num(p.rating), prov = num(p.provisionalRating);
    const rating = eff && eff > 0 ? eff : rat && rat > 0 ? rat : prov && prov > 0 ? prov : null;
    const usedProvisional = !(eff && eff > 0) && !(rat && rat > 0) && rating != null;
    out.push({
      id,
      name: [p.firstName, p.lastName].filter(x => typeof x === 'string' && x.trim()).join(' ') || String(p.name ?? id),
      location: typeof p.location === 'string' ? p.location : '',
      rating, provisional: usedProvisional, robustness: num(p.robustness),
    });
  }
  return out;
}

/** Add or replace the entry for a date (one per day; the newest reading wins). */
export function addEntry(f: FargoData, e: FargoEntry): FargoData {
  const entries = [...f.entries.filter(x => x.date !== e.date), e].sort((a, b) => (a.date < b.date ? -1 : 1));
  return { ...f, entries };
}

export const latestEntry = (f: FargoData | null) => (f?.entries.length ? f.entries[f.entries.length - 1] : null);

/** Change since the first entry at least `days` before the latest one. */
export function changeOver(f: FargoData, days: number): { from: FargoEntry; diff: number } | null {
  const last = latestEntry(f);
  if (!last) return null;
  const cut = Date.parse(`${last.date}T12:00:00`) - days * 86400000;
  const from = [...f.entries].reverse().find(e => Date.parse(`${e.date}T12:00:00`) <= cut);
  return from ? { from, diff: last.rating - from.rating } : null;
}

// ---------- the daily automatic check ----------

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Days between automatic entries when the rating hasn't moved, so the chart's line stays current. */
export const REFRESH_DAYS = 30;

/** Is an automatic check due? Linked, not switched off, and not already tried today (local date). */
export function autoCheckDue(f: FargoData, now: Date): boolean {
  if (!f.id || f.auto === false) return false;
  return !f.lastCheck || ymd(new Date(f.lastCheck.at)) !== ymd(now);
}

/**
 * Record an automatic check. A rating goes on the chart when it differs from the last
 * recorded one (or its provisional status changed, or the last entry is a month old);
 * otherwise only the check itself is noted. A rating entered by hand today is never replaced.
 */
export function applyAutoCheck(f: FargoData, p: FargoPlayer | null, now: Date): FargoData {
  const at = now.toISOString();
  if (!p || p.rating == null) return { ...f, lastCheck: { at, ok: false } };
  const today = ymd(now);
  const last = latestEntry(f);
  const base: FargoData = { ...f, name: p.name || f.name, location: p.location || f.location,
    lastCheck: { at, ok: true, rating: p.rating, ...(p.robustness != null ? { robustness: p.robustness } : {}) } };
  if (f.entries.some(e => e.date === today && e.source === 'manual')) return base;
  const stale = !last || Date.parse(`${today}T12:00:00`) - Date.parse(`${last.date}T12:00:00`) >= REFRESH_DAYS * 86400000;
  const moved = !last || last.rating !== p.rating || !!last.provisional !== p.provisional;
  if (!moved && !stale) return base;
  return addEntry(base, { date: today, rating: p.rating, robustness: p.robustness ?? undefined, provisional: p.provisional, source: 'lookup' });
}

/**
 * The notification for a daily check that found a new rating, e.g. "You added 4 games to
 * FargoRate and your rating changed by +1 to 523." Null when nothing changed (or nothing to
 * compare with). Games are the change in robustness, the number of games behind the rating.
 */
export function changeNotice(before: FargoData, after: FargoData): { title: string; body: string } | null {
  const now = after.lastCheck;
  if (!now?.ok || now.rating == null) return null;
  const was = before.lastCheck?.ok && before.lastCheck.rating != null ? before.lastCheck.rating : latestEntry(before)?.rating;
  if (was == null || was === now.rating) return null;
  const diff = now.rating - was;
  const sign = diff > 0 ? `+${diff}` : `−${Math.abs(diff)}`;
  const robWas = before.lastCheck?.robustness ?? latestEntry(before)?.robustness;
  const games = now.robustness != null && robWas != null ? now.robustness - robWas : 0;
  const lead = games > 0 ? `You added ${games} game${games === 1 ? '' : 's'} to FargoRate and your rating` : 'Your FargoRate rating';
  return { title: `FargoRate: ${now.rating} (${sign})`, body: `${lead} changed by ${sign} to ${now.rating}.` };
}
