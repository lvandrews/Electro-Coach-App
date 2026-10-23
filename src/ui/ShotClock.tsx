import { useEffect, useRef, useState } from 'preact/hooks';
import { trackOnce } from '../usage';
import { setVolume, sounds, unlockAudio } from './sound';
import { useWakeLock } from './TallyScreen';
import {
  RULE_SETS, callPush, canPassBack, canPush, expire, extend, extensionsLeft, migrateSettings, newRack, passBack, pause,
  remaining, restore, rulesFor, shotPlayed, snapshot, stageLabel, start, turnOver,
  type ClockRules, type ClockSettings, type ClockState, type Player, type RuleSetId, type Snapshot,
} from '../engine/shotclock';

// Tournament-style shot clock, laid out to be read and tapped at arm's length (large
// controls, each player color-coded). Tap the clock when the balls stop to start the shot;
// tap Shot played when the cue ball is struck. Rules come from the chosen rule set
// (Matchroom by default); the logic lives in engine/shotclock.ts.

const KEY = 'ec-shotclock';
const STATE_KEY = 'ec-shotclock-state';
function loadSettings(): ClockSettings { try { return migrateSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return migrateSettings(null); } }
/** The clock survives leaving the page: it comes back paused with the time it had. */
function loadState(rules: ClockRules): ClockState {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null') as { state: ClockState; leftMs: number } | null;
    if (raw?.state) { const s = raw.state; return s.phase === 'running' ? { ...s, phase: 'paused', remainingMs: raw.leftMs, endAt: 0 } : s; }
  } catch { /* start fresh */ }
  return newRack(rules, 0);
}
const vibrate = (ms: number | number[]) => { try { navigator.vibrate?.(ms); } catch { /* not supported */ } };

export function ShotClock() {
  useWakeLock();
  const [cfg, setCfg] = useState<ClockSettings>(loadSettings);
  const rules = rulesFor(cfg);
  const [s, setS] = useState<ClockState>(() => loadState(rulesFor(loadSettings())));
  const [, setTick] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [pickBreaker, setPickBreaker] = useState(false);
  const undo = useRef<Snapshot[]>([]);
  const lastSec = useRef<number | null>(null);
  const now = () => performance.now();

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ } setVolume(cfg.volume); }, [cfg]);
  useEffect(() => { try { localStorage.setItem(STATE_KEY, JSON.stringify(snapshot(s, now()))); } catch { /* ignore */ } }, [s]);

  /** Apply an action, keeping the previous state for Undo. */
  function act(next: ClockState, feedback: 'tap' | 'none' = 'tap') {
    if (next === s) return;
    undo.current.push(snapshot(s, now())); if (undo.current.length > 40) undo.current.shift();
    if (next.phase === 'running') lastSec.current = Math.ceil(remaining(next, now()) / 1000);
    setS(next);
    if (feedback === 'tap') { sounds.tap(); vibrate(12); }
  }

  // The tick loop: redraw, and sound the warning, the last five seconds and time.
  useEffect(() => {
    if (s.phase !== 'running') return;
    let raf = 0;
    const loop = () => {
      const ms = remaining(s, now());
      const sec = Math.ceil(ms / 1000);
      if (sec !== lastSec.current) {
        const prev = lastSec.current; lastSec.current = sec;
        if (prev != null && sec < prev) {
          if (sec === 0) { sounds.expire(); vibrate([300, 120, 300]); }
          else if (sec <= 5) sounds.tick();
          else if (sec === rules.warnAt) sounds.warn();
        }
      }
      if (ms <= 0) { setS(cur => expire(cur)); return; }
      setTick(t => t + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [s, rules.warnAt]);

  const running = s.phase === 'running' || s.phase === 'paused';
  function face() {
    unlockAudio();
    if (s.phase === 'running') { act(shotPlayed(s, rules)); return; }
    if (s.phase === 'paused') { act(pause(s, now())); return; }
    act(start(s, rules, now()), 'none'); sounds.start(); trackOnce('shot_clock_started');
  }
  const doPlayed = () => { unlockAudio(); act(shotPlayed(s, rules)); };
  const doPause = () => { unlockAudio(); act(pause(s, now())); };
  const doTurn = () => { unlockAudio(); act(turnOver(s, rules)); };
  const doExtend = (p: Player) => { unlockAudio(); const n = extend(s, rules, p); if (n !== s) { act(n, 'none'); sounds.extend(); vibrate(20); } };
  const doPush = () => { unlockAudio(); act(callPush(s)); };
  const doPassBack = () => { unlockAudio(); act(passBack(s, rules, now()), 'none'); sounds.start(); };
  const doUndo = () => { unlockAudio(); const snap = undo.current.pop(); if (!snap) return; const back = restore(snap, now()); lastSec.current = Math.ceil(remaining(back, now()) / 1000); setS(back); sounds.tap(); };
  const doNewRack = (p: Player) => { unlockAudio(); act(newRack(rules, p, s)); setPickBreaker(false); };

  // Laptop keys: Space start / shot played, P pause, E extension (shooter), T turn over, U undo, R new rack.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea')) return;
      if (e.key === ' ') { e.preventDefault(); face(); }
      else if (e.key === 'p' || e.key === 'P') doPause();
      else if (e.key === 'e' || e.key === 'E') doExtend(s.shooter);
      else if ('tTsS'.includes(e.key)) doTurn();
      else if (e.key === 'u' || e.key === 'U') doUndo();
      else if (e.key === 'r' || e.key === 'R') setPickBreaker(true);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const ms = remaining(s, now());
  const secs = Math.ceil(ms / 1000);
  const started = running || ms < s.duration * 1000;
  const state = s.phase === 'expired' ? 'expired' : started && secs <= 5 ? 'crit' : started && secs <= rules.warnAt ? 'warn' : '';
  const frac = s.duration ? ms / (s.duration * 1000) : 0;
  const name = (p: Player) => cfg.names[p].trim() || (p ? 'Player B' : 'Player A');
  const stage = stageLabel(s);
  const hint = s.phase === 'running' ? 'Tap when the cue ball is struck'
    : s.phase === 'paused' ? 'Paused · tap to resume'
    : s.phase === 'expired' ? `Tap to start ${name(s.shooter === 0 ? 1 : 0)}'s shot`
    : 'Tap when the balls stop to start';
  const setName = cfg.ruleSet === 'custom' ? 'Custom' : RULE_SETS[cfg.ruleSet].short;

  return (
    <div class="clock">
      <div class="clock-top">
        <span class="small muted">{setName} rules · rack {s.rack}</span>
        <button class="btn btn-s clock-pause" onClick={doPause} disabled={!running}>{s.phase === 'paused' ? '▶ Resume' : '❚❚ Pause'}</button>
      </div>

      <button class={`clock-face p${s.shooter} ${state} ${s.phase === 'running' ? 'running' : ''}`} onClick={face}
        aria-label={s.phase === 'running' ? 'Shot played: stop the clock' : 'Start the shot clock'}>
        <div class="clock-who">{name(s.shooter)}</div>
        {stage && <div class="clock-stage">{stage}</div>}
        <div class="clock-num num" aria-live="off">{s.phase === 'expired' ? 'TIME' : secs}</div>
        <div class="clock-bar"><span style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%` }} /></div>
        <div class="clock-hint">{hint}</div>
      </button>

      {running && <button class="btn primary clock-big" onClick={doPlayed}>✓ Shot played</button>}
      {(canPush(s) || canPassBack(s)) && (
        <div class="clock-row">
          {canPush(s) && <button class={`btn clock-big ${s.pushCalled ? 'primary' : ''}`} aria-pressed={s.pushCalled} onClick={doPush}>
            {s.pushCalled ? '✓ Push out called' : '⤳ Push out'}</button>}
          {canPassBack(s) && <button class="btn clock-big" onClick={doPassBack}>↩ Pass it back · {rules.pushBack} s</button>}
        </div>
      )}

      <div class="clock-players">
        {([0, 1] as Player[]).map(p => {
          const left = extensionsLeft(s, rules, p);
          return (
            <div key={p} class={`clock-player p${p} ${s.shooter === p ? 'at-table' : ''}`}>
              <div class="cp-name">{name(p)}</div>
              <div class="cp-tag">{s.shooter === p ? '● At the table' : ' '}</div>
              <button class="btn cp-ext" disabled={left <= 0 || s.phase === 'expired' || rules.extensionsPerRack === 0} onClick={() => doExtend(p)}
                aria-label={`Extension for ${name(p)}: ${left} left`}>
                <span class="cp-ext-main">＋{rules.extension} s</span>
                <span class="cp-ext-sub">{rules.extensionsPerRack === 0 ? 'no extensions' : `extension · ${left} left`}</span>
              </button>
            </div>
          );
        })}
      </div>

      <div class="clock-row">
        <button class="btn clock-big" onClick={doTurn}>⇄ Turn over</button>
        <button class="btn clock-big" onClick={doUndo} disabled={!undo.current.length}>↶ Undo</button>
      </div>

      {pickBreaker
        ? <div class="card clock-newrack">
            <div class="cp-name" style={{ textAlign: 'center' }}>New rack: who breaks?</div>
            <div class="clock-row">
              {([0, 1] as Player[]).map(p => <button key={p} class={`btn clock-big breaker p${p} ${p !== s.breaker ? 'suggest' : ''}`} onClick={() => doNewRack(p)}>{name(p)}</button>)}
            </div>
            <button class="btn btn-s" style={{ justifySelf: 'center' }} onClick={() => setPickBreaker(false)}>Cancel</button>
          </div>
        : <button class="btn clock-wide" onClick={() => setPickBreaker(true)}>New rack</button>}

      <details class="card clock-usage">
        <summary>Usage</summary>
        <Usage rules={rules} ruleSet={cfg.ruleSet} />
      </details>

      <div class="row" style={{ justifyContent: 'center', gap: '8px' }}>
        <button class="btn btn-s" onClick={() => setShowSettings(!showSettings)}>{showSettings ? 'Close settings' : 'Clock settings'}</button>
        <button class="btn btn-s" onClick={() => { unlockAudio(); sounds.warn(); setTimeout(sounds.tick, 700); setTimeout(sounds.tick, 1200); setTimeout(sounds.expire, 1800); }}>Test sounds</button>
      </div>

      {showSettings && <Settings cfg={cfg} onCfg={setCfg} />}
    </div>
  );
}

const secsLabel = (n: number) => `${n} seconds`;

function Settings({ cfg, onCfg }: { cfg: ClockSettings; onCfg: (c: ClockSettings) => void }) {
  const r = rulesFor(cfg);
  const custom = cfg.ruleSet === 'custom';
  const setRule = (k: keyof ClockRules) => (e: Event) => onCfg({ ...cfg, ruleSet: 'custom', custom: { ...r, [k]: Number((e.target as HTMLSelectElement).value) } });
  const pick = (k: keyof ClockRules, label: string, opts: number[], fmt: (n: number) => string = secsLabel) => (
    <label>{label}<select value={String(r[k])} disabled={!custom} onChange={setRule(k)}>
      {[...new Set([...opts, r[k]])].sort((a, b) => a - b).map(n => <option key={n} value={n}>{fmt(n)}</option>)}</select></label>
  );
  return (
    <div class="card" style={{ marginTop: '12px' }}>
      <label class="field">Rules
        <select value={cfg.ruleSet} onChange={e => {
          const id = (e.target as HTMLSelectElement).value as RuleSetId;
          onCfg({ ...cfg, ruleSet: id, custom: id === 'custom' && cfg.ruleSet !== 'custom' ? { ...r } : cfg.custom });
        }}>
          <option value="matchroom">{RULE_SETS.matchroom.label}</option>
          <option value="pbs">{RULE_SETS.pbs.label}</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      {!custom && <p class="small muted" style={{ margin: '4px 0 8px' }}>To change a time, choose Custom: it starts from these values.</p>}
      <div class="clock-settings">
        {pick('shot', 'Shot time', [15, 20, 25, 30, 35, 40, 45, 60])}
        {pick('breakOff', 'Break', [0, 30, 45, 60, 75, 90], n => (n ? secsLabel(n) : 'Not timed'))}
        {pick('afterBreak', 'First shot after the break', [30, 45, 60, 75, 90])}
        {pick('pushIncoming', 'After a push out', [30, 45, 60, 75, 90])}
        {pick('pushBack', 'Push passed back', [15, 20, 25, 30, 45, 60])}
        {pick('extension', 'Extension', [15, 20, 25, 30, 45, 60])}
        {pick('extensionsPerRack', 'Extensions per player per rack', [0, 1, 2, 3], n => String(n))}
        {pick('warnAt', 'Warning chime at', [10, 15, 20], n => `${n} seconds left`)}
        <label>Volume<input type="range" min={0} max={1} step={0.05} value={cfg.volume} onInput={e => onCfg({ ...cfg, volume: Number((e.target as HTMLInputElement).value) })}
          onChange={() => { unlockAudio(); sounds.tick(); }} /></label>
        <label>Player A<input type="text" value={cfg.names[0]} onInput={e => onCfg({ ...cfg, names: [(e.target as HTMLInputElement).value, cfg.names[1]] })} /></label>
        <label>Player B<input type="text" value={cfg.names[1]} onInput={e => onCfg({ ...cfg, names: [cfg.names[0], (e.target as HTMLInputElement).value] })} /></label>
      </div>
      <p class="small muted" style={{ marginBottom: 0 }}>The phone's own volume also applies. The screen stays on while this page is open.</p>
    </div>
  );
}

function Usage({ rules: r, ruleSet }: { rules: ClockRules; ruleSet: RuleSetId }) {
  return (
    <div class="small">
      <h4 style={{ margin: '8px 0 4px' }}>How to use it</h4>
      <ul class="usage-list">
        <li><b>Tap the clock</b> when the balls stop to start the shot. Tap <b>Shot played</b> (or the clock) when the cue ball is struck.</li>
        <li><b>Turn over</b> when the other player comes to the table. After a time foul the table passes to the other player automatically.</li>
        <li><b>Extensions:</b> each player has their own button. Tapping yours adds {r.extension} seconds and makes you the shooter, so a missed turn over never blocks it.</li>
        <li><b>Push out</b> appears on the first shot after the break: tap it before you push. The other player then gets {r.pushIncoming} seconds to take it or <b>Pass it back</b>, which gives the player who pushed {r.pushBack} seconds.</li>
        <li><b>Undo</b> reverses the last tap. <b>Pause</b> (top right) is for interruptions such as cleaning the cue ball or waiting for a referee.</li>
        <li><b>New rack</b> asks who breaks and resets the extensions. The clock keeps its place if you leave this page; it comes back paused.</li>
        <li class="kbd-hint">On a laptop: Space start / shot played, P pause, E extension, T turn over, U undo, R new rack.</li>
      </ul>
      <h4 style={{ margin: '10px 0 4px' }}>{ruleSet === 'custom' ? 'Your custom rules' : RULE_SETS[ruleSet].label}</h4>
      <ul class="usage-list">
        <li>Shot: {r.shot} s. {r.breakOff ? `Break: ${r.breakOff} s.` : 'The break isn’t timed.'} First shot after the break: {r.afterBreak} s.</li>
        <li>Push out: the incoming player has {r.pushIncoming} s to accept and shoot; passed back, the player who pushed has {r.pushBack} s.</li>
        <li>{r.extensionsPerRack === 0 ? 'No extensions.' : `${r.extensionsPerRack === 1 ? 'One' : r.extensionsPerRack} ${r.extension}-second extension${r.extensionsPerRack === 1 ? '' : 's'} per player per rack.`}</li>
        <li>The clock starts when the last ball stops and stops when the cue ball is struck. Warning chime at {r.warnAt} s, a beep each of the last 5 s.</li>
        {ruleSet === 'matchroom' && <>
          <li>An extension must be called within the first 30 seconds of the shot.</li>
          <li>Running out of time is a standard foul: ball in hand to the opponent.</li>
          <li>Where there are no sound warnings, the official calls out 10 and 5 seconds.</li>
        </>}
        {ruleSet === 'pbs' && <>
          <li>The first shot after the break gets an extra 30 seconds; the clock isn't paused for bridge or cue ball cleaning.</li>
          <li>The event protocol doesn't state push-out times; the clock uses Matchroom's 60 and 30 seconds.</li>
        </>}
      </ul>
      <p class="muted" style={{ margin: '6px 0 0' }}>Event rules vary; check the rules for your event or league.</p>
    </div>
  );
}
