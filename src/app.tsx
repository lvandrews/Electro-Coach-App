import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Shot } from './engine/schema';
import { evaluate, DEFAULT_RULES, type RuleConfig } from './engine/rules';
import { parseExport } from './engine/parse';
import { mergeImport, type ImportReport } from './engine/merge';
import { BUILTIN_DRILLS, sessionLabel, type DiagramSpec, type DrillDef } from './engine/drills';
import { captureCheck, mergeTallies, newTallyId, type TallySession } from './engine/tally';
import * as store from './store/db';
import { readFileText } from './platform';
import { ImportScreen } from './ui/ImportScreen';
import { SessionsScreen } from './ui/SessionsScreen';
import { DataScreen } from './ui/DataScreen';
import { SettingsScreen } from './ui/SettingsScreen';
import { DrillsScreen } from './ui/DrillsScreen';
import { TallyScreen } from './ui/TallyScreen';
import { ModelScreen } from './ui/ModelScreen';
import { TableScreen } from './ui/TableScreen';
import { ProgressScreen } from './ui/ProgressScreen';
import { PlanScreen } from './ui/PlanScreen';
import { PlayScreen, type PlayMode } from './ui/PlayScreen';
import { BowlingScreen } from './ui/BowlingScreen';
import type { Game } from './engine/games';
import { DEFAULT_PLAN, type PlanSettings } from './engine/plan';
import { fitBaseline, latestStart, type Baseline, type Note } from './engine/progress';
import { rowsFor } from './ui/ProgressScreen';
import { int, plural } from './ui/format';
import { HomeScreen } from './ui/HomeScreen';
import { HistoryScreen, type Activity } from './ui/HistoryScreen';
import { JournalScreen } from './ui/JournalScreen';
import { RoutineScreen } from './ui/RoutineScreen';
import { SessionScreen, sessionStatus, useNow, useSessionAlerts } from './ui/SessionScreen';
import { Drawer, type DrawerPick } from './ui/Drawer';
import { DESTS, slotById, type Tab } from './ui/nav';
import { usePrefs } from './ui/prefs';
import type { PracticeSession } from './engine/session';
import type { RoutineEdits } from './engine/routine';
import { localYmd } from './ui/format';
import { FargoScreen } from './ui/FargoScreen';
import { ResourcesScreen } from './ui/ResourcesScreen';
import { EMPTY_FARGO, type FargoData } from './engine/fargo';
import { STARTER_RESOURCES, type ResourceGroup } from './engine/resources';
import { listenForSharedFiles, type IncomingFile } from './incoming';
import { listenForWidgetOpen, syncWidget } from './widget';
import { onReminderPrefs, useReminders } from './ui/reminders';
import { startUsage, track, trackOnce, trackScreen } from './usage';
import { drillLabel, shotBand } from './engine/usage';
import { UsageNotice } from './ui/Usage';
import { drillLevel } from './ui/progPrefs';
import { AboutScreen, UpdateBanner } from './ui/AboutScreen';
import { bowlingCard } from './engine/games';

const BUILTIN_IDS = new Set(BUILTIN_DRILLS.map(d => d.id));

export type { Tab } from './ui/nav';

export interface AppData {
  shots: Map<number, Shot>;
  shotList: Shot[];
  exclusions: ReturnType<typeof evaluate>;
  rules: RuleConfig;
  imports: ImportReport[];
}

/** Usage counts for games: started, and finished (a full bowling card, an ended match or session). */
function trackGame(before: Game | undefined, g: Game) {
  if (g.kind === 'bowling') {
    if (g.source !== 'scored') { if (!before) trackOnce('bowling_games_added'); return; }   // past games, added in a batch
    const done = (x?: Game) => !!x && x.kind === 'bowling' && !!x.frames && bowlingCard(x.frames).complete;
    if (!before) track('bowling_game_started');
    if (done(g) && !done(before)) track('bowling_game_finished');
  } else if (g.kind === 'straight-pool') {
    if (!before) track('straight_pool_started');
    if (g.ended && !(before && 'ended' in before && before.ended)) track('straight_pool_finished');
  } else if (g.kind === 'practice') {
    if (!before) track('session_started', { minutes: g.minutes });
    if (g.ended && !(before && 'ended' in before && before.ended)) track('session_finished');
  }
}

export function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [drawer, setDrawer] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [routine, setRoutine] = useState<RoutineEdits | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [armDiscard, setArmDiscard] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [shots, setShots] = useState<Map<number, Shot>>(new Map());
  const [rules, setRules] = useState<RuleConfig>(DEFAULT_RULES);
  const [imports, setImports] = useState<ImportReport[]>([]);
  const [lastReport, setLastReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tallies, setTallies] = useState<TallySession[]>([]);
  const [layouts, setLayouts] = useState<Record<string, DiagramSpec>>({});
  const [custom, setCustom] = useState<DrillDef[]>([]);
  const [device, setDevice] = useState('This device');
  const [activeTallyId, setActiveTallyId] = useState<string | null>(null);
  const [tallyOpen, setTallyOpen] = useState(false);
  const [drillOpen, setDrillOpen] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [pins, setPins] = useState<string[] | null>(null);
  const [plan, setPlan] = useState<PlanSettings>(DEFAULT_PLAN);
  const [games, setGames] = useState<Game[]>([]);
  const [fargo, setFargo] = useState<FargoData>(EMPTY_FARGO);
  const [resources, setResources] = useState<ResourceGroup[] | null>(null);
  const [playMode, setPlayMode] = useState<PlayMode>(() => { try { return localStorage.getItem('ec-play') === 'straight' ? 'straight' : 'clock'; } catch { return 'clock'; } });

  const reload = async () => {
    const [s, r, i, t, l, c, dn, bl, nt, pn, pl, gm, rt, lb, fg, rs] = await Promise.all([
      store.loadShots(), store.loadRules(), store.loadImports(), store.loadTallies(), store.loadLayouts(), store.loadCustomDrills(), store.loadDeviceName(),
      store.loadBaseline(), store.loadNotes(), store.loadPins(), store.loadPlan(), store.loadGames(), store.loadRoutine(), store.loadLastBackup(),
      store.loadFargo(), store.loadResources(),
    ]);
    setShots(s); setRules(r); setImports(i); setTallies(t); setLayouts(l); setCustom(c); setDevice(dn);
    setBaseline(bl); setNotes(nt); setPins(pn); setPlan(pl); setGames(gm); setRoutine(rt); setLastBackup(lb); setFargo(fg); setResources(rs);
    const open = t.find(x => !x.ended);
    setActiveTallyId(open?.id ?? null);
    setLoaded(true);
  };
  useEffect(() => { reload().catch(e => { setError(String(e)); setLoaded(true); }); startUsage(); }, []);
  useEffect(() => { trackScreen(tab); }, [tab]);

  // Drill library = built-ins + custom drills, with any saved layouts applied.
  const drills = useMemo<DrillDef[]>(() => [...BUILTIN_DRILLS, ...custom].map(d => (layouts[d.id] ? { ...d, diagram: layouts[d.id] } : d)), [custom, layouts]);

  // Session labels come from the full drill library (custom drills included).
  const shotList = useMemo(() => [...shots.values()].map(s => {
    const label = sessionLabel(drills, s.tags, s.gameTypes, s.sessionName);
    return label === s.sessionType ? s : { ...s, sessionType: label };
  }), [shots, drills]);
  const exclusions = useMemo(() => evaluate(shotList, rules), [shotList, rules]);
  const data: AppData = { shots, shotList, exclusions, rules, imports };
  const kept = shots.size - exclusions.size;
  const activeTally = tallies.find(t => t.id === activeTallyId) ?? null;
  const activeDrill = activeTally ? drills.find(d => d.id === activeTally.drillId) ?? null : null;

  async function importFiles(files: File[]) {
    setError(null);
    let current = shots;
    let report: ImportReport | null = null;
    try {
      for (const f of files) {
        setBusy(`Reading ${f.name}…`);
        const parsed = parseExport(await readFileText(f), f.name);
        const res = mergeImport(current, parsed, rules);
        report = res.report;
        if (!report.refused) {
          setBusy(`Saving ${int(report.newShots + report.updatedShots)} shots…`);
          const changed = [...report.newShotIds, ...parsed.shots.filter(s => current.has(s.shotId)).map(s => s.shotId)]
            .map(id => res.shots.get(id)!).filter(Boolean);
          await store.saveImport(changed, parsed.raw, report);
          current = res.shots;
        }
      }
      setShots(current);
      setImports(await store.loadImports());
      setLastReport(report);
      if (report && !report.refused) track('csv_imported', { shots: shotBand(report.newShots + report.updatedShots) });
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(null); }
  }

  // A Railbird CSV shared to the app (Android): import it once the stored data has loaded.
  const importRef = useRef(importFiles); importRef.current = importFiles;
  const [shared, setShared] = useState<IncomingFile | null>(null);
  useEffect(() => listenForSharedFiles(f => setShared(f)), []);
  // The home-screen widget: keep its text current, and open the routine when it's tapped.
  useEffect(() => { if (loaded) void syncWidget(routine); }, [loaded]);
  useEffect(() => listenForWidgetOpen(page => { if (page === 'routine') { setTab('routine'); setDrawer(false); setTallyOpen(false); window.scrollTo(0, 0); } }), []);
  useEffect(() => {
    if (!loaded || !shared) return;
    const f = shared; setShared(null);
    setTab('import'); setDrawer(false); setTallyOpen(false);
    if (f.error || !f.text) { setError(f.error ?? 'The shared file was empty.'); return; }
    importRef.current([new File([f.text], f.name || 'shared.csv', { type: 'text/csv' })]);
  }, [loaded, shared]);

  async function updateRules(r: RuleConfig) { setRules(r); await store.saveRules(r); }

  // ----- tallies -----
  async function startTally(d: DrillDef, opts: { level?: number; variant?: string; target?: number } = {}): Promise<string> {
    // Only one tally runs at a time: an empty one left open is dropped, a used one is saved.
    const open = tallies.find(x => x.id === activeTallyId && !x.ended);
    if (open) { if (open.events.length) await finishTally({ ...open, ended: new Date().toISOString(), updated: new Date().toISOString() }); else await discardTally(open.id); }
    const now = new Date().toISOString();
    const t: TallySession = { id: newTallyId(), drillId: d.id, drillName: d.name, device, started: now, updated: now, events: [],
      ...(d.prog?.progressive ? { level: opts.level ?? drillLevel(d, tallies).level } : {}),
      ...(opts.variant ? { variant: opts.variant } : {}), ...(opts.target ? { target: opts.target } : {}) };
    await store.saveTally(t);
    setTallies(ts => [t, ...ts]); setActiveTallyId(t.id); setDrillOpen(d.id); setTallyOpen(true); setTab('drills');
    track('tally_started', { drill: drillLabel(d.id, BUILTIN_IDS) });
    return t.id;
  }
  async function discardTally(id: string) {
    await store.deleteTally(id); setTallies(ts => ts.filter(x => x.id !== id));
    if (activeTallyId === id) { setActiveTallyId(null); setTallyOpen(false); }
    setArmDiscard(false);
  }
  async function endTally(id: string) {
    const t = tallies.find(x => x.id === id);
    if (!t || t.ended) return;
    if (!t.events.length) await discardTally(id);
    else await finishTally({ ...t, ended: new Date().toISOString(), updated: new Date().toISOString() });
  }
  async function changeTally(t: TallySession) {
    setTallies(ts => ts.map(x => (x.id === t.id ? t : x)));
    await store.saveTally(t);
  }
  async function finishTally(t: TallySession) {
    if (!t.events.length) { await discardTally(t.id); return; }
    await changeTally(t); setActiveTallyId(null); setTallyOpen(false);
    track('tally_finished', { drill: drillLabel(t.drillId, BUILTIN_IDS) });
  }
  async function deleteTally(id: string) {
    await store.deleteTally(id); setTallies(ts => ts.filter(x => x.id !== id));
  }
  async function importTallies(incoming: TallySession[]) {
    const r = mergeTallies(tallies, incoming);
    await store.saveTallies(r.sessions);
    setTallies(r.sessions.sort((a, b) => (a.started < b.started ? 1 : -1)));
    return r;
  }
  async function saveLayout(id: string, spec: DiagramSpec | null) {
    const next = { ...layouts }; if (spec) next[id] = spec; else delete next[id];
    setLayouts(next); await store.saveLayouts(next);
  }
  async function saveCustom(d: DrillDef) {
    if (!custom.some(x => x.id === d.id)) track('drill_created');
    const next = custom.some(x => x.id === d.id) ? custom.map(x => (x.id === d.id ? d : x)) : [...custom, d];
    setCustom(next); await store.saveCustomDrills(next);
  }
  async function deleteCustom(id: string) {
    const next = custom.filter(x => x.id !== id); setCustom(next); await store.saveCustomDrills(next);
    await saveLayout(id, null);
  }
  async function renameDevice(n: string) { setDevice(n); await store.saveDeviceName(n); }
  async function updateBaseline(b: Baseline) { setBaseline(b); await store.saveBaseline(b); }
  async function updateNotes(n: Note[]) { if (n.length > notes.length) track('journal_note_added'); setNotes(n); await store.saveNotes(n); }
  async function updatePins(p: string[]) { setPins(p); await store.savePins(p); }
  async function updatePlan(p: PlanSettings) { setPlan(p); await store.savePlan(p); }
  async function saveGame(g: Game) { trackGame(games.find(x => x.id === g.id), g); setGames(gs => [g, ...gs.filter(x => x.id !== g.id)]); await store.saveGame(g); }
  async function deleteGame(id: string) { setGames(gs => gs.filter(x => x.id !== id)); await store.deleteGame(id); }
  const pickPlay = (m: PlayMode) => { setPlayMode(m); try { localStorage.setItem('ec-play', m); } catch { /* ignore */ } };
  const openScorer = (m: PlayMode) => { pickPlay(m); setTab('play'); window.scrollTo(0, 0); };
  const openDrill = (id: string) => { setDrillOpen(id); setTallyOpen(false); setTab('drills'); window.scrollTo(0, 0); };
  async function saveRoutine(r: RoutineEdits | null) { setRoutine(r); await store.saveRoutine(r); track('routine_edited'); void syncWidget(r); }
  async function saveFargo(f: FargoData) { setFargo(f); await store.saveFargo(f); }
  async function saveResources(r: ResourceGroup[] | null) { setResources(r); await store.saveResources(r); }
  async function addNote(text: string) { await updateNotes([...notes, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, date: localYmd(new Date()), kind: 'other', text }]); }
  const session = (games.find(g => g.kind === 'practice' && !g.ended) as PracticeSession | undefined) ?? null;
  useSessionAlerts(session, tallies, games, drills);
  // Practice reminders: rescheduled whenever something is logged or the settings change.
  const [remindersVersion, setRemindersVersion] = useState(0);
  useEffect(() => onReminderPrefs(() => setRemindersVersion(v => v + 1)), []);
  useReminders(loaded, data, tallies, games, drills, remindersVersion);
  // Freeze the yardstick as soon as there is data, so Home, Plan and Progress all have it.
  useEffect(() => {
    if (!loaded || baseline || shots.size < 50) return;
    const t = setTimeout(() => { try { const rows = rowsFor(data); if (rows.length >= 50) updateBaseline(fitBaseline(rows, latestStart(rows))); } catch { /* Progress shows the error */ } }, 50);
    return () => clearTimeout(t);
  }, [loaded, baseline, exclusions]);
  function openActivity(a: Activity) {
    if (a.kind === 'railbird') go('sessions');
    else if (a.kind === 'tally') { if (a.live) { setDrillOpen(a.ref); setTallyOpen(true); setTab('drills'); } else openDrill(a.ref); }
    else if (a.kind === 'bowling') go('bowling');
    else if (a.kind === 'straight') openScorer('straight');
    else go(a.live ? 'session' : 'history');
  }
  function pick(p: DrawerPick) {
    setDrawer(false);
    if (p.kind === 'dest') { if (p.dest.play) openScorer(p.dest.play); else go(p.dest.tab); }
    else if (p.kind === 'drill') openDrill(p.id);
    else if (p.kind === 'note') goFocus('journal', p.id);
    else if (p.kind === 'resource') goFocus('resources', p.id);
    else goFocus('routine', p.id);
  }

  const capture = useMemo(() => captureCheck(tallies, shotList, exclusions, drills), [tallies, shotList, exclusions, drills]);

  const go = (t: Tab) => { setTab(t); setDrawer(false); if (t !== 'drills') setTallyOpen(false); setFocus(null); window.scrollTo(0, 0); };
  /** Go to a screen and open or scroll to one part of it. */
  const goFocus = (t: Tab, f: string) => { go(t); setFocus(f); };
  const showTally = tab === 'drills' && tallyOpen && activeTally && activeDrill;
  const now = useNow(1000);
  const status = session ? sessionStatus(session, tallies, games, drills, now) : null;

  // swipe in from the left edge to open the drawer
  const edge = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => { const t = e.touches[0]; edge.current = t.clientX < 24 && !drawer ? { x: t.clientX, y: t.clientY } : null; };
  const onTouchEnd = (e: TouchEvent) => {
    const st = edge.current; edge.current = null; if (!st) return;
    const t = e.changedTouches[0];
    if (t.clientX - st.x > 60 && Math.abs(t.clientY - st.y) < 50) setDrawer(true);
  };
  const tallyAge = activeTally ? (Date.now() - Date.parse(activeTally.started)) / 3600000 : 0;
  const practiceTabs: Tab[] = ['plan', 'drills', 'history', 'session', 'bowling'];

  return (
    <div class="app" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header class="top">
        <button class="icon-btn menu-btn" aria-label="All sections" onClick={() => setDrawer(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h16M4 12h16M4 17.5h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" /></svg>
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1>Electro-Coach</h1>
          <div class="status num">
            {!loaded ? 'Opening…' : shots.size ? `${int(kept)} shots kept of ${int(shots.size)}` : 'No shots imported yet'}
          </div>
        </div>
        <div class="row" style={{ gap: '8px', flexWrap: 'nowrap' }}>
          <button class={`btn btn-s ${tab === 'import' ? 'primary' : ''}`} onClick={() => go('import')}>Import</button>
          <button class="icon-btn" aria-label="Settings and backup" onClick={() => go('settings')}>
            {/* Machined spur gear: ten trapezoid teeth, keyed bore, five lightening holes. */}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M10.34,3.56L10.74,0.87L13.26,0.87L13.66,3.56A8.6,8.6 0 0 1 15.61,4.20L15.61,4.20L17.52,2.25L19.56,3.74L18.31,6.15A8.6,8.6 0 0 1 19.51,7.81L19.51,7.81L22.19,7.36L22.97,9.76L20.54,10.98A8.6,8.6 0 0 1 20.54,13.02L20.54,13.02L22.97,14.24L22.19,16.64L19.51,16.19A8.6,8.6 0 0 1 18.31,17.85L18.31,17.85L19.56,20.26L17.52,21.75L15.61,19.80A8.6,8.6 0 0 1 13.66,20.44L13.66,20.44L13.26,23.13L10.74,23.13L10.34,20.44A8.6,8.6 0 0 1 8.39,19.80L8.39,19.80L6.48,21.75L4.44,20.26L5.69,17.85A8.6,8.6 0 0 1 4.49,16.19L4.49,16.19L1.81,16.64L1.03,14.24L3.46,13.02A8.6,8.6 0 0 1 3.46,10.98L3.46,10.98L1.03,9.76L1.81,7.36L4.49,7.81A8.6,8.6 0 0 1 5.69,6.15L5.69,6.15L4.44,3.74L6.48,2.25L8.39,4.20A8.6,8.6 0 0 1 10.34,3.56ZM12.65,8.97A3.1,3.1 0 1 1 11.35,8.97L11.35,8.07L12.65,8.07ZM16.43,7.35a1.05,1.05 0 1 0 -2.10,0a1.05,1.05 0 1 0 2.10,0ZM18.52,13.78a1.05,1.05 0 1 0 -2.10,0a1.05,1.05 0 1 0 2.10,0ZM13.05,17.75a1.05,1.05 0 1 0 -2.10,0a1.05,1.05 0 1 0 2.10,0ZM7.58,13.78a1.05,1.05 0 1 0 -2.10,0a1.05,1.05 0 1 0 2.10,0ZM9.67,7.35a1.05,1.05 0 1 0 -2.10,0a1.05,1.05 0 1 0 2.10,0Z" /></svg>
          </button>
        </div>
      </header>

      <main>
        <UsageNotice />
        <UpdateBanner />
        {error && <div class="notice bad" role="alert">{error}</div>}
        {status && tab !== 'session' && tab !== 'home' && (
          <button class={`session-banner ${status.due ? 'due' : ''}`} onClick={() => go('session')}>{status.text}</button>
        )}
        {activeTally && !showTally && (
          <div class="tally-banner">
            <button class="grow" onClick={() => { setTab('drills'); setDrillOpen(activeTally.drillId); setTallyOpen(true); }}>
              {activeTally.drillName} tally {tallyAge > 3 ? `started ${tallyAge > 20 ? 'yesterday or earlier' : `${Math.floor(tallyAge)} hours ago`}` : 'in progress'} · {plural(activeTally.events.length, 'tap')} · return
            </button>
            {armDiscard
              ? <><button class="tb-btn" onClick={() => discardTally(activeTally.id)}>Discard</button><button class="tb-btn" onClick={() => setArmDiscard(false)}>Keep</button></>
              : <button class="tb-btn" onClick={() => (activeTally.events.length ? setArmDiscard(true) : discardTally(activeTally.id))}>{activeTally.events.length ? 'Discard…' : 'Close'}</button>}
          </div>
        )}
        {practiceTabs.includes(tab) && !showTally && (
          <div class="chips practice-chips" role="group" aria-label="Practice">
            <button aria-pressed={tab === 'plan'} onClick={() => go('plan')}>Plan</button>
            {session && <button aria-pressed={tab === 'session'} onClick={() => go('session')}>Session</button>}
            <button aria-pressed={tab === 'drills' || tab === 'bowling'} onClick={() => go('drills')}>Drills</button>
            <button aria-pressed={tab === 'history'} onClick={() => go('history')}>History</button>
          </div>
        )}
        {!loaded ? null
          : showTally ? <TallyScreen drill={activeDrill!} session={activeTally!} tallies={tallies} onChange={changeTally} onFinish={finishTally} onDiscard={discardTally} onMinimize={() => setTallyOpen(false)}
              header={status ? <button class={`session-banner ${status.due ? 'due' : ''}`} onClick={() => go('session')}>{status.text}</button> : undefined} />
          : tab === 'home' ? <HomeScreen data={data} baseline={baseline} plan={plan} drills={drills} tallies={tallies} games={games} notes={notes} imports={imports}
              lastBackup={lastBackup} activeTally={activeTally} session={session} onGo={go} onPlay={openScorer}
              onResumeTally={() => { if (activeTally) { setTab('drills'); setDrillOpen(activeTally.drillId); setTallyOpen(true); } }}
              onDiscardTally={discardTally} onOpenActivity={openActivity} onNotes={updateNotes} onGoFocus={goFocus} fargo={fargo} onOpenDrill={openDrill} />
          : tab === 'history' ? <HistoryScreen data={data} tallies={tallies} games={games} drills={drills} onOpen={openActivity} />
          : tab === 'session' ? <SessionScreen data={data} baseline={baseline} plan={plan} drills={drills} tallies={tallies} games={games} session={session} device={device}
              onSave={g => saveGame(g)} onDelete={deleteGame} onStartTally={startTally}
              onOpenTally={() => { if (activeTally) { setTab('drills'); setDrillOpen(activeTally.drillId); setTallyOpen(true); } }}
              onEndTally={endTally} onOpenScorer={() => go('bowling')} onAddNote={addNote} onDone={() => go('history')} onGoPlan={() => go('plan')} />
          : tab === 'journal' ? <JournalScreen data={data} notes={notes} tallies={tallies} games={games} drills={drills} baseline={baseline} onNotes={updateNotes} focus={focus} />
          : tab === 'routine' ? <RoutineScreen data={data} edits={routine} onEdits={saveRoutine} onGo={go} onGoFocus={goFocus} focus={focus} />
          : tab === 'drills' ? <DrillsScreen data={data} drills={drills} tallies={tallies} device={device} activeTallyId={activeTallyId}
              onStartTally={startTally} onResumeTally={() => setTallyOpen(true)} onSaveLayout={saveLayout} onSaveCustom={saveCustom}
              onDeleteCustom={deleteCustom} onDeleteTally={deleteTally} onImportTallies={importTallies} onGo={go}
              openId={drillOpen} onOpen={setDrillOpen} onOpenScorer={() => go('bowling')} />
          : tab === 'fargo' ? <FargoScreen fargo={fargo} onFargo={saveFargo} notes={notes} tallies={tallies} />
          : tab === 'resources' ? <ResourcesScreen groups={resources} onGroups={saveResources} focus={focus} />
          : tab === 'import' ? <ImportScreen data={data} busy={busy} lastReport={lastReport} capture={capture} onFiles={importFiles} onGo={go} />
          : tab === 'sessions' ? <SessionsScreen data={data} onGo={go} />
          : tab === 'data' ? <DataScreen data={data} onGo={go} />
          : tab === 'model' ? <ModelScreen data={data} onGo={go} onOpenDrill={openDrill} focus={focus} />
          : tab === 'table' ? <TableScreen data={data} onGo={go} />
          : tab === 'progress' ? <ProgressScreen data={data} drills={drills} tallies={tallies} games={games} baseline={baseline} notes={notes} pins={pins}
              onBaseline={updateBaseline} onNotes={updateNotes} onPins={updatePins} onGo={go} />
          : tab === 'bowling' ? <section>
              <button class="btn btn-s" onClick={() => openDrill('bowling-10')}>The drill: set-up and rules</button>
              <h2 style={{ marginTop: '10px' }}>10-ball bowling drill</h2>
              <BowlingScreen games={games} device={device} onSave={saveGame} onDelete={deleteGame} />
            </section>
          : tab === 'play' ? <PlayScreen mode={playMode} onMode={pickPlay} games={games} device={device} onSaveGame={saveGame} onDeleteGame={deleteGame} />
          : tab === 'plan' ? <PlanScreen data={data} drills={drills} tallies={tallies} games={games} baseline={baseline} pins={pins} plan={plan}
              onBaseline={updateBaseline} onPlan={updatePlan} onPins={updatePins} onOpenDrill={openDrill} onGo={go} />
          : tab === 'settings' ? <SettingsScreen data={data} drills={drills} tallies={tallies} device={device} onDevice={renameDevice} onRules={updateRules} onRestored={reload} onBackedUp={setLastBackup} onGo={go} />
          : tab === 'about' ? <AboutScreen onGo={go} />
          : null}
      </main>

      <Rail tab={tab} onGo={go} onMore={() => setDrawer(true)} />
      <Drawer open={drawer} current={tab} drills={drills} notes={notes} resources={resources ?? STARTER_RESOURCES} onPick={pick} onClose={() => setDrawer(false)} />
    </div>
  );
}

/** Bottom navigation: four destinations of your choice plus More (the drawer). Items size to their text; with large system text the rail scrolls sideways. */
function Rail({ tab, onGo, onMore }: { tab: Tab; onGo: (t: Tab) => void; onMore: () => void }) {
  const prefs = usePrefs();
  const slots = prefs.bar.map(slotById).filter((x): x is NonNullable<ReturnType<typeof slotById>> => !!x);
  const ul = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = () => {
    const el = ul.current; if (!el) return;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  };
  useEffect(() => {
    const el = ul.current; if (!el) return;
    const ro = new ResizeObserver(measure); ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);   // items grow with the system text size
    el.addEventListener('scroll', measure, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', measure); };
  }, [slots.length]);
  useEffect(() => {
    const el = ul.current?.querySelector('[aria-current="page"]') as HTMLElement | null;
    el?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    measure();
  }, [tab]);
  const inBar = slots.some(sl => sl.tabs.includes(tab));
  return (
    <nav class={`rail ${edges.left ? 'fade-l' : ''} ${edges.right ? 'fade-r' : ''}`} aria-label="Sections">
      <ul ref={ul}>
        {slots.map(sl => (
          <li key={sl.id}>
            <button aria-current={sl.tabs.includes(tab) ? 'page' : undefined} onClick={() => onGo(sl.tabs.includes(tab) && sl.id === 'practice' ? tab : sl.go)}>
              <span class="diamond" aria-hidden="true" />
              {sl.label}
            </button>
          </li>
        ))}
        <li>
          <button aria-current={!inBar ? 'page' : undefined} onClick={onMore} aria-label={`More: ${inBar ? 'all sections' : DESTS.find(d => d.tab === tab)?.label ?? ''}`}>
            <span class="diamond more" aria-hidden="true" />
            {inBar ? 'More' : DESTS.find(d => d.tab === tab)?.short ?? 'More'}
          </button>
        </li>
      </ul>
    </nav>
  );
}
