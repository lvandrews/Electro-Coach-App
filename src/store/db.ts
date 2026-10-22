import { openDB, type IDBPDatabase } from 'idb';
import type { Shot } from '../engine/schema';
import type { ImportReport } from '../engine/merge';
import { DEFAULT_RULES, type RuleConfig } from '../engine/rules';
import type { TallySession } from '../engine/tally';
import type { DiagramSpec, DrillDef } from '../engine/drills';
import type { Baseline, Note } from '../engine/progress';
import { DEFAULT_PLAN, type PlanSettings } from '../engine/plan';
import type { Game } from '../engine/games';
import type { RoutineEdits } from '../engine/routine';
import { EMPTY_FARGO, type FargoData } from '../engine/fargo';
import type { ResourceGroup } from '../engine/resources';

// IndexedDB inside the app's WebView. On Android this lives in the app's private
// data directory and is only cleared if the app is uninstalled or its data is
// cleared — use Backup regularly anyway.

const DB_NAME = 'electro-coach';
const VERSION = 3;

interface Schema {
  shots: { key: number; value: Shot };
  raw: { key: number; value: { shotId: number; row: Record<string, string> } };
  imports: { key: string; value: ImportReport };
  settings: { key: string; value: unknown };
  tallies: { key: string; value: TallySession };
  games: { key: string; value: Game };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;
function db() {
  dbp ??= openDB<Schema>(DB_NAME, VERSION, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore('shots', { keyPath: 'shotId' });
        d.createObjectStore('raw', { keyPath: 'shotId' });
        d.createObjectStore('imports', { keyPath: 'id' });
        d.createObjectStore('settings');
      }
      if (oldVersion < 2) d.createObjectStore('tallies', { keyPath: 'id' });
      if (oldVersion < 3) d.createObjectStore('games', { keyPath: 'id' });
    },
  });
  return dbp;
}

export async function loadShots(): Promise<Map<number, Shot>> {
  const all = await (await db()).getAll('shots');
  return new Map(all.map(s => [s.shotId, s]));
}

export async function saveImport(shots: Shot[], raw: Record<number, Record<string, string>>, report: ImportReport) {
  const d = await db();
  const tx = d.transaction(['shots', 'raw', 'imports'], 'readwrite');
  const ss = tx.objectStore('shots'), rs = tx.objectStore('raw');
  for (const s of shots) {
    ss.put(s);
    if (raw[s.shotId]) rs.put({ shotId: s.shotId, row: raw[s.shotId] });
  }
  tx.objectStore('imports').put(report);
  await tx.done;
}

export async function loadImports(): Promise<ImportReport[]> {
  const all = await (await db()).getAll('imports');
  return all.sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1));
}

export async function loadRules(): Promise<RuleConfig> {
  const r = (await (await db()).get('settings', 'rules')) as RuleConfig | undefined;
  return r ? { ...DEFAULT_RULES, ...r, enabled: { ...DEFAULT_RULES.enabled, ...r.enabled } } : DEFAULT_RULES;
}

export async function saveRules(r: RuleConfig) {
  await (await db()).put('settings', r, 'rules');
}

export async function getRaw(shotId: number) {
  return (await (await db()).get('raw', shotId))?.row ?? null;
}

export interface Backup {
  app: 'electro-coach';
  version: 1;
  exportedAt: string;
  shots: Shot[];
  raw: { shotId: number; row: Record<string, string> }[];
  imports: ImportReport[];
  rules: RuleConfig;
  tallies?: TallySession[];
  layouts?: Record<string, DiagramSpec>;
  customDrills?: DrillDef[];
  baseline?: Baseline | null;
  notes?: Note[];
  pins?: string[] | null;
  plan?: PlanSettings;
  games?: Game[];
  routine?: RoutineEdits | null;
  fargo?: FargoData | null;
  resources?: ResourceGroup[] | null;
}

export async function makeBackup(): Promise<Backup> {
  const d = await db();
  return {
    app: 'electro-coach', version: 1, exportedAt: new Date().toISOString(),
    shots: await d.getAll('shots'), raw: await d.getAll('raw'), imports: await d.getAll('imports'), rules: await loadRules(),
    tallies: await d.getAll('tallies'), layouts: await loadLayouts(), customDrills: await loadCustomDrills(),
    baseline: await loadBaseline(), notes: await loadNotes(), pins: await loadPins(), plan: await loadPlan(), games: await d.getAll('games'), routine: await loadRoutine(),
    fargo: await loadFargo(), resources: await loadResources(),
  };
}

export async function restoreBackup(b: Backup) {
  if (b.app !== 'electro-coach') throw new Error('This file is not an Electro-Coach backup.');
  const d = await db();
  const tx = d.transaction(['shots', 'raw', 'imports', 'settings', 'tallies', 'games'], 'readwrite');
  await Promise.all(['shots', 'raw', 'imports', 'tallies', 'games'].map(n => tx.objectStore(n as 'shots').clear()));
  for (const s of b.shots) tx.objectStore('shots').put(s);
  for (const r of b.raw) tx.objectStore('raw').put(r);
  for (const i of b.imports) tx.objectStore('imports').put(i);
  for (const t of b.tallies ?? []) tx.objectStore('tallies').put(t);
  for (const g of b.games ?? []) tx.objectStore('games').put(g);
  tx.objectStore('settings').put(b.rules, 'rules');
  if (b.layouts) tx.objectStore('settings').put(b.layouts, 'layouts');
  if (b.customDrills) tx.objectStore('settings').put(b.customDrills, 'customDrills');
  if (b.baseline) tx.objectStore('settings').put(b.baseline, 'baseline');
  if (b.notes) tx.objectStore('settings').put(b.notes, 'notes');
  if (b.pins) tx.objectStore('settings').put(b.pins, 'pins');
  if (b.plan) tx.objectStore('settings').put(b.plan, 'plan');
  if (b.routine) tx.objectStore('settings').put(b.routine, 'routine');
  if (b.fargo) tx.objectStore('settings').put(b.fargo, 'fargo');
  if (b.resources) tx.objectStore('settings').put(b.resources, 'resources');
  await tx.done;
}

export async function eraseAll() {
  const d = await db();
  const tx = d.transaction(['shots', 'raw', 'imports', 'settings', 'tallies', 'games'], 'readwrite');
  for (const n of ['shots', 'raw', 'imports', 'settings', 'tallies', 'games'] as const) tx.objectStore(n).clear();
  await tx.done;
}

// ---------- tallies, drill layouts, custom drills ----------

export async function loadTallies(): Promise<TallySession[]> {
  const all = await (await db()).getAll('tallies');
  return all.sort((a, b) => (a.started < b.started ? 1 : -1));
}
export async function saveTally(t: TallySession) { await (await db()).put('tallies', t); }
export async function deleteTally(id: string) { await (await db()).delete('tallies', id); }
export async function saveTallies(ts: TallySession[]) {
  const tx = (await db()).transaction('tallies', 'readwrite');
  for (const t of ts) tx.store.put(t);
  await tx.done;
}

export async function loadLayouts(): Promise<Record<string, DiagramSpec>> {
  return ((await (await db()).get('settings', 'layouts')) as Record<string, DiagramSpec> | undefined) ?? {};
}
export async function saveLayouts(l: Record<string, DiagramSpec>) { await (await db()).put('settings', l, 'layouts'); }

export async function loadCustomDrills(): Promise<DrillDef[]> {
  return ((await (await db()).get('settings', 'customDrills')) as DrillDef[] | undefined) ?? [];
}
export async function saveCustomDrills(d: DrillDef[]) { await (await db()).put('settings', d, 'customDrills'); }

export async function loadDeviceName(): Promise<string> {
  const d = await db();
  let n = (await d.get('settings', 'deviceName')) as string | undefined;
  if (!n) {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    n = /Android/i.test(ua) ? 'Android device' : /Windows/i.test(ua) ? 'Windows laptop' : /Mac/i.test(ua) ? 'Mac' : 'This device';
    await d.put('settings', n, 'deviceName');
  }
  return n;
}
export async function saveDeviceName(n: string) { await (await db()).put('settings', n, 'deviceName'); }

// ---------- progress: frozen yardstick, dated notes, pinned segments ----------

export async function loadBaseline(): Promise<Baseline | null> { return ((await (await db()).get('settings', 'baseline')) as Baseline | undefined) ?? null; }
export async function saveBaseline(b: Baseline) { await (await db()).put('settings', b, 'baseline'); }
export async function loadNotes(): Promise<Note[]> { return ((await (await db()).get('settings', 'notes')) as Note[] | undefined) ?? []; }
export async function saveNotes(n: Note[]) { await (await db()).put('settings', n, 'notes'); }
/** null = never chosen (the screen suggests pins); [] = chosen to pin nothing. */
export async function loadPins(): Promise<string[] | null> { return ((await (await db()).get('settings', 'pins')) as string[] | undefined) ?? null; }
export async function savePins(p: string[]) { await (await db()).put('settings', p, 'pins'); }
export async function loadPlan(): Promise<PlanSettings> { return { ...DEFAULT_PLAN, ...(((await (await db()).get('settings', 'plan')) as PlanSettings | undefined) ?? {}) }; }
export async function savePlan(p: PlanSettings) { await (await db()).put('settings', p, 'plan'); }

// ---------- scored games: 10-ball bowling, straight pool ----------

export async function loadGames(): Promise<Game[]> { return (await (await db()).getAll('games')).sort((a, b) => (a.date < b.date ? 1 : -1)); }
export async function saveGame(g: Game) { await (await db()).put('games', g); }
export async function deleteGame(id: string) { await (await db()).delete('games', id); }

// ---------- pre-shot routine edits; housekeeping ----------

export async function loadRoutine(): Promise<RoutineEdits | null> { return ((await (await db()).get('settings', 'routine')) as RoutineEdits | undefined) ?? null; }
export async function saveRoutine(r: RoutineEdits | null) { const d = await db(); if (r) await d.put('settings', r, 'routine'); else await d.delete('settings', 'routine'); }
export async function loadLastBackup(): Promise<string | null> { return ((await (await db()).get('settings', 'lastBackup')) as string | undefined) ?? null; }
export async function saveLastBackup(iso: string) { await (await db()).put('settings', iso, 'lastBackup'); }

// ---------- FargoRate entries; resource links ----------

export async function loadFargo(): Promise<FargoData> { return ((await (await db()).get('settings', 'fargo')) as FargoData | undefined) ?? EMPTY_FARGO; }
export async function saveFargo(f: FargoData) { await (await db()).put('settings', f, 'fargo'); }
/** null = the built-in starter list. */
export async function loadResources(): Promise<ResourceGroup[] | null> { return ((await (await db()).get('settings', 'resources')) as ResourceGroup[] | undefined) ?? null; }
export async function saveResources(r: ResourceGroup[] | null) { const d = await db(); if (r) await d.put('settings', r, 'resources'); else await d.delete('settings', 'resources'); }
