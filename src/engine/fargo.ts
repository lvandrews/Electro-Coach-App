// FargoRate rating over time. FargoRate has no documented public API; the lookup
// uses the same search endpoint as the open-source `fargo` CLI (rgstephens/fargo-skill),
// which may change without notice. Manual entry always works.

export interface FargoEntry { date: string; rating: number; robustness?: number; provisional?: boolean; source: 'lookup' | 'manual' }
export interface FargoData { id?: string; name?: string; location?: string; entries: FargoEntry[] }
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
