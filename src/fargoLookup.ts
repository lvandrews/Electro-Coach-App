import { FARGO_API, applyAutoCheck, autoCheckDue, parseFargo, type FargoData, type FargoPlayer } from './engine/fargo';
import { getJson } from './platform';

/** Search FargoRate by name or ID (the Android app asks FargoRate directly; the web version goes through its own site). */
export async function searchFargo(q: string): Promise<FargoPlayer[]> {
  const enc = encodeURIComponent(q.trim());
  return parseFargo(await getJson(`${FARGO_API}${enc}`, `/fargo-api/indexsearch?q=${enc}`));
}

/**
 * The daily check: if one is due, ask FargoRate for the linked player's rating and return
 * the updated data (null when nothing was due). Only the FargoRate ID is sent. At most one
 * request a day, whether it succeeds or not.
 */
export async function dailyFargoCheck(f: FargoData, now = new Date()): Promise<FargoData | null> {
  if (!autoCheckDue(f, now)) return null;
  let p: FargoPlayer | null = null;
  try { p = (await searchFargo(f.id!)).find(x => x.id === f.id) ?? null; } catch { p = null; }
  return applyAutoCheck(f, p, now);
}
