import { useEffect, useRef, useState } from 'preact/hooks';
import { trackOnce } from '../usage';
import { setVolume, sounds, unlockAudio } from './sound';
import { useWakeLock } from './TallyScreen';

// Tournament-style shot clock. Tap the big clock (or press Space) when the balls stop
// to start the next shot. A chime at the warning mark, a beep for each of the last
// five seconds, a longer tone at zero. One extension per player per rack by default,
// and a longer first shot after the break.

interface ClockSettings {
  shot: number; firstShot: number; extension: number; extensionsPerRack: number; warnAt: number; volume: number; names: [string, string];
}
const DEFAULTS: ClockSettings = { shot: 30, firstShot: 60, extension: 30, extensionsPerRack: 1, warnAt: 10, volume: 0.7, names: ['Player A', 'Player B'] };
const KEY = 'ec-shotclock';
function loadSettings(): ClockSettings { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEFAULTS }; } }

export function ShotClock() {
  useWakeLock();
  const [cfg, setCfg] = useState<ClockSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [duration, setDuration] = useState(cfg.firstShot);      // seconds for the shot on the clock
  const [left, setLeft] = useState(cfg.firstShot * 1000);       // ms remaining
  const [running, setRunning] = useState(false);
  const [expired, setExpired] = useState(false);
  const [shooter, setShooter] = useState<0 | 1>(0);
  const [extUsed, setExtUsed] = useState<[number, number]>([0, 0]);
  const [rackStart, setRackStart] = useState(true);              // next shot is the first after the break
  const endAt = useRef(0);
  const lastSec = useRef<number | null>(null);

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ } setVolume(cfg.volume); }, [cfg]);

  // the tick loop
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const loop = () => {
      const ms = Math.max(0, endAt.current - performance.now());
      setLeft(ms);
      const sec = Math.ceil(ms / 1000);
      if (sec !== lastSec.current) {
        const prev = lastSec.current; lastSec.current = sec;
        if (prev != null && sec < prev) {
          if (sec === 0) { sounds.expire(); try { navigator.vibrate?.([300, 120, 300]); } catch { /* ignore */ } }
          else if (sec <= 5) sounds.tick();
          else if (sec === cfg.warnAt) sounds.warn();
        }
      }
      if (ms <= 0) { setRunning(false); setExpired(true); return; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, cfg.warnAt]);

  function startShot() {
    unlockAudio();
    const secs = rackStart ? cfg.firstShot : cfg.shot;
    setDuration(secs); endAt.current = performance.now() + secs * 1000; lastSec.current = secs;
    setLeft(secs * 1000); setExpired(false); setRunning(true); setRackStart(false);
    sounds.start();
    trackOnce('shot_clock_started');
  }
  function pause() {
    unlockAudio();
    if (running) { setRunning(false); }
    else if (left > 0 && !expired) { endAt.current = performance.now() + left; lastSec.current = Math.ceil(left / 1000); setRunning(true); }
  }
  function extend() {
    unlockAudio();
    if (extUsed[shooter] >= cfg.extensionsPerRack) return;
    const next: [number, number] = [...extUsed] as [number, number]; next[shooter]++; setExtUsed(next);
    const base = running ? Math.max(0, endAt.current - performance.now()) : left;
    const ms = base + cfg.extension * 1000;
    endAt.current = performance.now() + ms; lastSec.current = Math.ceil(ms / 1000);
    setDuration(d => d + cfg.extension); setLeft(ms); setExpired(false);
    if (!running) setRunning(true);
    sounds.extend();
  }
  function newRack() {
    setRunning(false); setExpired(false); setExtUsed([0, 0]); setRackStart(true);
    setDuration(cfg.firstShot); setLeft(cfg.firstShot * 1000);
  }
  function switchShooter() { setShooter(s => (s === 0 ? 1 : 0)); }

  // keyboard (laptop): Space = next shot, P = pause, E = extension, S = switch shooter, R = new rack
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea')) return;
      if (e.key === ' ') { e.preventDefault(); startShot(); }
      else if (e.key === 'p' || e.key === 'P') pause();
      else if (e.key === 'e' || e.key === 'E') extend();
      else if (e.key === 's' || e.key === 'S') switchShooter();
      else if (e.key === 'r' || e.key === 'R') newRack();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const secs = Math.ceil(left / 1000);
  const state = expired ? 'expired' : secs <= 5 && (running || left < duration * 1000) ? 'crit' : secs <= cfg.warnAt && (running || left < duration * 1000) ? 'warn' : '';
  const frac = duration ? left / (duration * 1000) : 0;
  const extLeft = (p: 0 | 1) => cfg.extensionsPerRack - extUsed[p];
  const name = (p: 0 | 1) => cfg.names[p].trim() || (p ? 'Player B' : 'Player A');

  return (
    <div class="clock">
      <button class={`clock-face ${state} ${running ? 'running' : ''}`} onClick={startShot} aria-label={running ? 'Next shot: restart the clock' : 'Start the shot clock'}>
        <div class="clock-who">{name(shooter)} at the table{rackStart && !running ? ' · first shot of the rack' : ''}</div>
        <div class="clock-num num" aria-live="off">{expired ? 'TIME' : secs}</div>
        <div class="clock-bar"><span style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%` }} /></div>
        <div class="clock-hint">{running ? 'Tap when the balls stop to start the next shot' : expired ? 'Tap to start the next shot' : 'Tap to start'}</div>
      </button>

      <div class="clock-controls">
        <button class="btn" onClick={pause} disabled={!running && (expired || left === duration * 1000)}>{running ? 'Pause' : 'Resume'}</button>
        <button class="btn primary" onClick={extend} disabled={extLeft(shooter) <= 0}>Extension +{cfg.extension}s ({extLeft(shooter)} left)</button>
        <button class="btn" onClick={switchShooter}>Switch to {name(shooter === 0 ? 1 : 0)}</button>
        <button class="btn" onClick={newRack}>New rack</button>
      </div>
      <p class="small muted" style={{ textAlign: 'center' }}>
        Extensions this rack: {name(0)} {extUsed[0]}/{cfg.extensionsPerRack} · {name(1)} {extUsed[1]}/{cfg.extensionsPerRack}.
        <span class="kbd-hint">{' '}On a laptop: Space next shot, P pause, E extension, S switch, R new rack.</span>
      </p>

      <div class="row" style={{ justifyContent: 'center', gap: '8px' }}>
        <button class="btn btn-s" onClick={() => setShowSettings(!showSettings)}>{showSettings ? 'Close settings' : 'Clock settings'}</button>
        <button class="btn btn-s" onClick={() => { unlockAudio(); sounds.warn(); setTimeout(sounds.tick, 700); setTimeout(sounds.tick, 1200); setTimeout(sounds.expire, 1800); }}>Test sounds</button>
      </div>

      {showSettings && (
        <div class="card" style={{ marginTop: '12px' }}>
          <div class="clock-settings">
            <label>Shot time<select value={String(cfg.shot)} onChange={e => setCfg({ ...cfg, shot: Number((e.target as HTMLSelectElement).value) })}>
              {[15, 20, 25, 30, 35, 40, 45, 60].map(s => <option key={s} value={s}>{s} seconds</option>)}</select></label>
            <label>First shot after the break<select value={String(cfg.firstShot)} onChange={e => setCfg({ ...cfg, firstShot: Number((e.target as HTMLSelectElement).value) })}>
              {[...new Set([cfg.shot, 30, 45, 60, 75, 90])].sort((a, b) => a - b).map(s => <option key={s} value={s}>{s} seconds</option>)}</select></label>
            <label>Extension<select value={String(cfg.extension)} onChange={e => setCfg({ ...cfg, extension: Number((e.target as HTMLSelectElement).value) })}>
              {[15, 20, 25, 30, 45, 60].map(s => <option key={s} value={s}>{s} seconds</option>)}</select></label>
            <label>Extensions per player per rack<select value={String(cfg.extensionsPerRack)} onChange={e => setCfg({ ...cfg, extensionsPerRack: Number((e.target as HTMLSelectElement).value) })}>
              {[0, 1, 2, 3].map(s => <option key={s} value={s}>{s}</option>)}</select></label>
            <label>Warning chime at<select value={String(cfg.warnAt)} onChange={e => setCfg({ ...cfg, warnAt: Number((e.target as HTMLSelectElement).value) })}>
              {[10, 15, 20].map(s => <option key={s} value={s}>{s} seconds left</option>)}</select></label>
            <label>Volume<input type="range" min={0} max={1} step={0.05} value={cfg.volume} onInput={e => setCfg({ ...cfg, volume: Number((e.target as HTMLInputElement).value) })}
              onChange={() => { unlockAudio(); sounds.tick(); }} /></label>
            <label>Player A<input type="text" value={cfg.names[0]} onInput={e => setCfg({ ...cfg, names: [(e.target as HTMLInputElement).value, cfg.names[1]] })} /></label>
            <label>Player B<input type="text" value={cfg.names[1]} onInput={e => setCfg({ ...cfg, names: [cfg.names[0], (e.target as HTMLInputElement).value] })} /></label>
          </div>
          <p class="small muted" style={{ marginBottom: 0 }}>The phone's own volume also applies. The screen stays on while this page is open.</p>
        </div>
      )}
    </div>
  );
}
