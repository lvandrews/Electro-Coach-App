import { useMemo, useState } from 'preact/hooks';
import type { AppData } from '../app';
import type { DrillDef } from '../engine/drills';
import type { TallySession } from '../engine/tally';
import type { ImportReport } from '../engine/merge';
import { bowlingStats, bowlingTotal, bpi, spState, type BowlingGame, type Game, type StraightPoolMatch } from '../engine/games';
import { buildPlan, type PlanSettings } from '../engine/plan';
import { composeFor } from './sessionPlan';
import { periodSummary, progressNow, sessionPoints, type Baseline, type Note } from '../engine/progress';
import type { PracticeSession } from '../engine/session';
import { activities, ActivityRow, type Activity } from './HistoryScreen';
import { NoteForm } from './JournalScreen';
import { rowsFor } from './ProgressScreen';
import { sessionStatus, useNow } from './SessionScreen';
import type { Tab } from './nav';
import type { PlayMode } from './PlayScreen';
import { fmtDate, int } from './format';
import { useSpeedProfile } from './SpeedProfile';
import { useBestShots } from './BestShots';
import { describeShot } from '../engine/best';
import { mphRange } from '../engine/speed';
import { changeOver, latestEntry, type FargoData } from '../engine/fargo';

type Props = {
  data: AppData; baseline: Baseline | null; plan: PlanSettings; drills: DrillDef[]; tallies: TallySession[]; games: Game[]; notes: Note[];
  imports: ImportReport[]; lastBackup: string | null; activeTally: TallySession | null; session: PracticeSession | null;
  onGo: (t: Tab) => void; onPlay: (m: PlayMode) => void; onResumeTally: () => void; onDiscardTally: (id: string) => Promise<void>;
  onOpenActivity: (a: Activity) => void; onNotes: (n: Note[]) => Promise<void>; onGoFocus: (t: Tab, focus: string) => void; fargo: FargoData; onOpenDrill: (id: string) => void;
};

const DAY = 86400000;
const ago = (iso: string) => {
  const d = Math.floor((Date.now() - Date.parse(iso)) / DAY);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};
const pts = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(100 * x).toFixed(1)}`;

export function HomeScreen(p: Props) {
  const now = useNow(1000);
  const rows = useMemo(() => (p.data.shots.size ? rowsFor(p.data) : []), [p.data.exclusions]);
  const plan = useMemo(() => (p.baseline && rows.length ? buildPlan(p.baseline, rows, p.plan.period) : null), [p.baseline, rows, p.plan.period]);
  const blocks = useMemo(() => composeFor({ data: p.data, baseline: p.baseline, plan: p.plan, drills: p.drills, tallies: p.tallies, games: p.games }, 'planned').run, [p.baseline, p.data.exclusions, p.plan, p.drills, p.tallies.length, p.games.length]);
  const recent = useMemo(() => activities(p.data, p.tallies, p.games, p.drills).filter(a => !a.live).slice(0, 4), [p.data.exclusions, p.tallies, p.games, p.drills]);
  const summary = useMemo(() => { if (!p.baseline || !rows.length) return null; const pts0 = sessionPoints(p.baseline, rows); return periodSummary(pts0, p.baseline, progressNow(pts0)); }, [p.baseline, rows]);
  const bowl = p.games.filter((g): g is BowlingGame => g.kind === 'bowling' && bowlingTotal(g) != null).sort((a, b) => (a.date < b.date ? -1 : 1));
  const bowl5 = bowl.length ? bowlingStats(bowl.slice(-5)) : null;
  const sp = p.games.filter((g): g is StraightPoolMatch => g.kind === 'straight-pool' && !!g.ended);
  const spBpi = sp.map(m => bpi(spState(m), 0)).filter((x): x is number => x != null);
  const liveGames = p.games.filter(g => (g.kind === 'bowling' && g.source === 'scored' && bowlingTotal(g) == null) || (g.kind === 'straight-pool' && !g.ended));
  const [confirm, setConfirm] = useState(false);
  const [adding, setAdding] = useState(false);
  const lastImport = p.imports.map(i => i.importedAt).sort().pop() ?? null;
  const speed = useSpeedProfile(p.data);
  const best = useBestShots(p.data)?.[0];
  const med = speed?.bands.find(b => b.id === 'medium') ?? speed?.bands[0];
  const fargoNow = latestEntry(p.fargo), fargoCh = changeOver(p.fargo, 90);
  const now_ = p.session ? sessionStatus(p.session, p.tallies, p.games, p.drills, now) : null;

  return (
    <section>
      <h2>Home</h2>

      {(p.session || p.activeTally || liveGames.length > 0) && (
        <div class="card home-now">
          <div class="panel-title" style={{ marginTop: 0 }}>Now</div>
          {p.session && now_ && <div class="now-row"><div class="grow"><b>{now_.text}</b></div><button class="btn primary btn-s" onClick={() => p.onGo('session')}>Resume</button></div>}
          {p.activeTally && (
            <div class="now-row">
              <div class="grow"><b>{p.activeTally.drillName} tally</b> <span class="small muted">· {p.activeTally.events.length} taps · started {ago(p.activeTally.started)}</span></div>
              <button class="btn primary btn-s" onClick={p.onResumeTally}>Resume</button>
              {confirm
                ? <><button class="btn btn-s danger" onClick={async () => { await p.onDiscardTally(p.activeTally!.id); setConfirm(false); }}>Discard</button><button class="btn btn-s" onClick={() => setConfirm(false)}>Keep</button></>
                : <button class="btn btn-s" onClick={() => setConfirm(true)}>Discard…</button>}
            </div>
          )}
          {liveGames.map(g => (
            <div key={g.id} class="now-row">
              <div class="grow"><b>{g.kind === 'bowling' ? '10-ball bowling drill' : `Straight pool vs ${(g as StraightPoolMatch).players[1]}`}</b> <span class="small muted">· started {ago(g.date)}</span></div>
              <button class="btn primary btn-s" onClick={() => (g.kind === 'bowling' ? p.onGo('bowling') : p.onPlay('straight'))}>Resume</button>
            </div>
          ))}
        </div>
      )}

      <div class="card">
        <div class="row" style={{ alignItems: 'baseline' }}>
          <div class="panel-title" style={{ margin: 0 }}>Next session · {p.plan.minutes} minutes</div>
          <span class="spacer" />
          <button class="btn btn-s" onClick={() => p.onGo('plan')}>Plan</button>
        </div>
        {blocks.length ? <>
          <ol class="home-blocks">{blocks.map((b, i) => <li key={i}><span class="num">{b.minutes}′</span> {b.title}</li>)}</ol>
          <button class="btn primary" disabled={!!p.session} onClick={() => p.onGo('session')}>{p.session ? 'A session is running' : 'Start this session'}</button>
        </> : <p class="small muted" style={{ margin: '6px 0 0' }}>Building your plan…</p>}
        {!p.data.shots.size && <p class="small muted" style={{ margin: '6px 0 0' }}>Import Railbird data and the plan adds targets from your weakest shots.</p>}
      </div>

      {(summary || plan?.targets.length || bowl5 || spBpi.length > 0 || med || fargoNow || best) && (
        <div class="tiles">
          {summary?.last30 && <button class="tile tile-btn" onClick={() => p.onGo('progress')}><div class="tile-title">Last 30 days</div><div class="tile-big num">{pts(summary.last30.oe)} <span class="small">pts</span></div><div class="small muted">vs your yardstick · {int(summary.last30.n)} shots</div></button>}
          {best && <button class="tile tile-btn positive" onClick={() => p.onGoFocus('model', 'best-shots')}><div class="tile-title">Your best shot</div><div class="tile-big num">{Math.round(100 * best.rate)}%</div><div class="small">{describeShot(best)}</div><div class="small muted num">{best.made} of {best.n} made</div></button>}
          {plan?.targets[0] && <button class="tile tile-btn" onClick={() => (plan.targets[0].drills[0] ? p.onOpenDrill(plan.targets[0].drills[0]) : p.onGo('plan'))}><div class="tile-title">Top target</div><div class="tile-small">{plan.targets[0].label}</div><div class="small muted">{plan.targets[0].perHundred.toFixed(1)} makes lost / 100{plan.targets[0].drills[0] ? ' · tap for the drill' : ''}</div></button>}
          {med?.sweet && med.best != null && <button class="tile tile-btn" onClick={() => p.onGoFocus('model', 'speed-profile')}><div class="tile-title">Speed sweet spot</div><div class="tile-big num">{med.best.toFixed(1)} <span class="small">mph</span></div><div class="small muted">best at {med.label.toLowerCase()} distance (sweet spot {mphRange(med.sweet)}){speed!.bands.filter(b => b !== med && b.best != null).map(b => ` · ${b.label.toLowerCase()} ${b.best!.toFixed(1)}`).join('')}</div></button>}
          {fargoNow && <button class="tile tile-btn" onClick={() => p.onGo('fargo')}><div class="tile-title">FargoRate</div><div class="tile-big num">{fargoNow.rating}</div><div class="small muted">{fargoCh ? `${fargoCh.diff >= 0 ? '+' : '−'}${Math.abs(fargoCh.diff)} in 90 days` : `as of ${fmtDate(`${fargoNow.date}T12:00:00`)}`}</div></button>}
          {bowl5 && <button class="tile tile-btn" onClick={() => p.onGo('bowling')}><div class="tile-title">Bowling drill</div><div class="tile-big num">{bowl5.average!.toFixed(0)}</div><div class="small muted">average, last {bowl5.games}</div></button>}
          {spBpi.length > 0 && <button class="tile tile-btn" onClick={() => p.onPlay('straight')}><div class="tile-title">Straight pool</div><div class="tile-big num">{(spBpi.reduce((a, b) => a + b, 0) / spBpi.length).toFixed(2)}</div><div class="small muted">balls per inning</div></button>}
        </div>
      )}

      <div class="card">
        <div class="row" style={{ alignItems: 'baseline' }}>
          <div class="panel-title" style={{ margin: 0 }}>Last time</div>
          <span class="spacer" />
          <button class="btn btn-s" onClick={() => p.onGo('history')}>All history</button>
        </div>
        {recent.length ? <ul class="game-list" style={{ marginTop: '8px' }}>{recent.map(a => <ActivityRow key={a.id} a={a} onOpen={p.onOpenActivity} showDate />)}</ul>
          : <p class="small muted">Nothing yet.</p>}
      </div>

      <div class="card">
        <div class="row" style={{ alignItems: 'baseline' }}>
          <div class="panel-title" style={{ margin: 0 }}>Journal</div>
          <span class="spacer" />
          <button class="btn btn-s" onClick={() => setAdding(!adding)}>{adding ? 'Close' : 'Add an entry'}</button>
          <button class="btn btn-s" onClick={() => p.onGo('journal')}>Open</button>
        </div>
        {adding ? <div style={{ marginTop: '8px' }}><NoteForm compact notes={p.notes} onNotes={p.onNotes} onDone={() => setAdding(false)} /></div>
          : p.notes.length ? <p class="small" style={{ margin: '6px 0 0' }}>Latest: {fmtDate(`${[...p.notes].sort((a, b) => (a.date < b.date ? 1 : -1))[0].date}T12:00:00`)}: {[...p.notes].sort((a, b) => (a.date < b.date ? 1 : -1))[0].text.slice(0, 120)}</p>
          : <p class="small muted" style={{ margin: '6px 0 0' }}>Date changes to your game or equipment; they're flagged on the Progress charts.</p>}
      </div>

      <div class="card housekeeping">
        <div class="panel-title" style={{ marginTop: 0 }}>Housekeeping</div>
        <div class="small">{p.data.shots.size ? `${int(p.data.shots.size - p.data.exclusions.size)} shots kept.` : 'No shots yet.'} Last Railbird import: {lastImport ? ago(lastImport) : 'never'}. <button class="link-btn" onClick={() => p.onGo('import')}>Import</button></div>
        <div class={`small ${!p.lastBackup || Date.now() - Date.parse(p.lastBackup) > 14 * DAY ? 'warn-text' : ''}`}>
          Last backup: {p.lastBackup ? ago(p.lastBackup) : 'never on this device'}. <button class="link-btn" onClick={() => p.onGo('settings')}>Back up</button>
        </div>
      </div>
    </section>
  );
}
