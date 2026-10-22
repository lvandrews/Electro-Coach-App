import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { DiagKey, DrillDef, Side } from '../engine/drills';
import { completionSummary, diagnosticCounts, type TallyEvent, type TallySession } from '../engine/tally';
import { int } from './format';

interface Props {
  drill: DrillDef;
  session: TallySession;
  onChange: (s: TallySession) => void;
  onFinish: (s: TallySession) => void;
  onDiscard: (id: string) => void;
  onMinimize: () => void;
  header?: ComponentChildren;   // e.g. the practice-session timer
}

const KEY_LABEL: Record<DiagKey, string> = { make: 'Make', thick: 'Thick miss', thin: 'Thin miss', rail: 'Cue ball to rail', pocket: 'Cue ball to pocket' };
const SIDE_LABEL: Record<Side, string> = { L: 'Left cut', R: 'Right cut' };

/** Keep the screen on while tallying, where the browser allows it. */
export function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const get = async () => { try { lock = await (navigator as any).wakeLock?.request('screen'); } catch { /* not allowed here */ } };
    get();
    const vis = () => { if (document.visibilityState === 'visible') get(); };
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); lock?.release().catch(() => {}); };
  }, []);
}

function useClock(start: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((now - Date.parse(start)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function TallyScreen({ drill, session, onChange, onFinish, onDiscard, onMinimize, header }: Props) {
  useWakeLock();
  const clock = useClock(session.started);
  const [ending, setEnding] = useState(false);
  const [armDiscard, setArmDiscard] = useState(false);
  const [note, setNote] = useState(session.note ?? '');
  const [flash, setFlash] = useState<string | null>(null);
  const flashT = useRef<number>();

  // Always build on the newest record, even if two taps land before a re-render.
  const latest = useRef(session);
  if (session.updated >= latest.current.updated || session.id !== latest.current.id) latest.current = session;
  const commit = (next: TallySession) => { latest.current = next; onChange(next); };

  const push = (e: Omit<TallyEvent, 't'>, msg: string) => {
    const now = new Date().toISOString();
    const cur = latest.current;
    commit({ ...cur, events: [...cur.events, { ...e, t: now }], updated: now });
    setFlash(msg); clearTimeout(flashT.current); flashT.current = window.setTimeout(() => setFlash(null), 1200);
  };
  const undo = () => {
    const cur = latest.current;
    if (!cur.events.length) return;
    commit({ ...cur, events: cur.events.slice(0, -1), updated: new Date().toISOString() });
    setFlash('Undone'); clearTimeout(flashT.current); flashT.current = window.setTimeout(() => setFlash(null), 1200);
  };
  const last = session.events[session.events.length - 1];
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && e.key.toLowerCase() === 'z' && !ending) undo();
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });
  const describe = (e: TallyEvent) =>
    e.key === 'complete' ? 'ran out' : e.key === 'missed' ? `missed the ${e.ball}` : e.key === 'outOfLine' ? `out of line on the ${e.ball}` : e.key === 'ended' ? `run ended at ${e.ball}`
      : `${e.side ? SIDE_LABEL[e.side].toLowerCase() + ' ' : ''}${KEY_LABEL[e.key as DiagKey].toLowerCase()}`;

  return (
    <section class="tally" aria-label={`${drill.name} tally`}>
      {header}
      <div class="tally-top">
        <div>
          <h2 style={{ margin: 0 }}>{drill.name}</h2>
          <div class="small muted num">Recording on {session.device} · {clock}</div>
        </div>
        <span class="spacer" />
        <button class="btn" onClick={() => (session.events.length ? onMinimize() : onDiscard(session.id))} title={session.events.length ? 'Hide the tally; it keeps running' : 'Nothing tapped yet: leaving drops it'}>{session.events.length ? 'Hide' : 'Close'}</button>
        <button class="btn primary" onClick={() => setEnding(true)}>Finish</button>
      </div>

      {ending ? (
        <div class="card" style={{ marginTop: '12px' }}>
          <h3>Finish this tally?</h3>
          {drill.category === 'transitions' && (
            <label class="small muted" style={{ display: 'grid', gap: '4px', marginBottom: '10px' }}>
              Note (optional): which transition was the focus?
              <textarea id="tally-note" rows={3} value={note} onInput={e => setNote((e.target as HTMLTextAreaElement).value)} />
            </label>
          )}
          {session.events.length === 0 && <p class="small muted" style={{ marginTop: 0 }}>Nothing has been tapped, so there is nothing to save.</p>}
          <div class="row">
            {session.events.length > 0
              ? <button class="btn primary" onClick={() => onFinish({ ...session, note: note || undefined, ended: new Date().toISOString(), updated: new Date().toISOString() })}>Save and finish</button>
              : <button class="btn primary" onClick={() => onDiscard(session.id)}>Close without saving</button>}
            <button class="btn" onClick={() => { setEnding(false); setArmDiscard(false); }}>Keep tallying</button>
            {session.events.length > 0 && (armDiscard
              ? <button class="btn danger" onClick={() => onDiscard(session.id)}>Yes, discard {session.events.length} tap{session.events.length === 1 ? '' : 's'}</button>
              : <button class="btn danger" onClick={() => setArmDiscard(true)}>Discard this tally…</button>)}
          </div>
        </div>
      ) : drill.counters === 'completion'
        ? <Completion drill={drill} session={session} push={push}
            onLearning={on => commit({ ...latest.current, learning: on, updated: new Date().toISOString() })} />
        : <Diagnostic drill={drill} session={session} push={push} />}

      {!ending && (
        <div class="undo-row">
          <button class="btn" disabled={!last} onClick={undo}>{last ? `Undo: ${describe(last)}` : 'Undo'}</button>
          <span class="flash" role="status" aria-live="polite">{flash ?? ''}</span>
        </div>
      )}
    </section>
  );
}

// ---------- completion (Transitions) ----------

function Completion({ drill, session, push, onLearning }: {
  drill: DrillDef; session: TallySession; push: (e: Omit<TallyEvent, 't'>, m: string) => void; onLearning: (on: boolean) => void;
}) {
  const n = drill.ballsPerRack ?? 9;
  const digit = useRef<{ d: number; t: number } | null>(null);
  const c = completionSummary(session, n);
  const learning = !!session.learning;
  const lr = learning ? { learning: true as const } : {};
  const tag = learning ? ' (learning)' : '';
  const racks = session.events.filter(e => e.key === 'complete' || e.key === 'missed' || e.key === 'outOfLine' || e.key === 'ended');
  const [ball, setBallState] = useState<number | null>(null);
  // Mirror in a ref so a quick key pair (e.g. "7" then "L") sees the pick before re-render.
  const ballRef = useRef<number | null>(null);
  const setBall = (b: number | null) => { ballRef.current = b; setBallState(b); };
  const rackNo = c.racks + c.learning + 1;

  const ranOut = () => { push({ key: 'complete', ...lr }, `Rack ${rackNo}${tag}: ran out`); setBall(null); };
  const end = (key: 'missed' | 'outOfLine') => {
    const ball = ballRef.current;
    if (ball == null) return;
    push({ key, ball, ...lr }, `Rack ${rackNo}${tag}: ${key === 'missed' ? 'missed' : 'out of line on'} the ${ball}`);
    setBall(null);
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'c' || e.key === 'Enter') { e.preventDefault(); ranOut(); return; }
      if (/^[0-9]$/.test(e.key)) {
        // Racks of more than nine balls: a second digit typed straight after the first makes 10–14.
        const d = Number(e.key), now = Date.now(), prev = digit.current;
        const two = prev && now - prev.t < 900 ? prev.d * 10 + d : null;
        if (two != null && two >= 1 && two <= n) { setBall(two); digit.current = null; return; }
        if (d >= 1 && d <= n) { setBall(d); digit.current = n > 9 ? { d, t: now } : null; }
        return;
      }
      if (k === 'm') end('missed'); else if (k === 'l') end('outOfLine');
      else if (e.key === 'Escape') setBall(null);
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });

  return (
    <div class="tally-body">
      <label class={`small switch-row ${learning ? 'learning-on' : ''}`}>
        <input type="checkbox" checked={learning} onChange={() => onLearning(!learning)} />
        <span><b>Learning mode (ball in hand)</b>: racks logged while this is on stay out of the drill's stats and Progress.</span>
      </label>
      <dl class="facts tally-facts">
        <div><dt>Racks</dt><dd>{c.racks}</dd></div>
        <div><dt>Ran out</dt><dd>{c.completed}</dd></div>
        <div><dt>Balls per rack</dt><dd>{c.racks ? c.ballsPerRack.toFixed(1) : '—'}</dd></div>
        {c.learning > 0 && <div><dt>Learning racks</dt><dd>{c.learning}</dd></div>}
      </dl>
      <button class="tap tap-make tap-wide" onClick={ranOut}>Ran out<small class="kbd-hint">C or Enter</small></button>

      <div class="panel-title">Or: the ball the rack ended on</div>
      <div class="ball-grid" style={{ gridTemplateColumns: `repeat(${Math.min(n, 5)}, 1fr)` }} role="group" aria-label="Ball the rack ended on">
        {Array.from({ length: n }, (_, i) => i + 1).map(b => (
          <button key={b} class={`tap tap-ball ${ball === b ? 'picked' : ''}`} aria-pressed={ball === b} onClick={() => setBall(ball === b ? null : b)}>{b}</button>
        ))}
      </div>
      <div class="tap-pair">
        <button class="tap tap-miss" disabled={ball == null} onClick={() => end('missed')}>
          {ball == null ? 'Missed' : `Missed the ${ball}`}<small class="kbd-hint">M</small>
        </button>
        <button class="tap tap-line" disabled={ball == null} onClick={() => end('outOfLine')}>
          {ball == null ? 'Out of line' : `Out of line on the ${ball}`}<small>abandoned, not shot<span class="kbd-hint"> · L</span></small>
        </button>
      </div>

      {racks.length > 0 && <>
        <div class="rack-strip" aria-label="Racks so far">
          {racks.map((e, i) => (
            <span key={i} class={`rack ${e.key === 'complete' ? 'done' : e.key === 'outOfLine' ? 'line' : ''} ${e.learning ? 'learn' : ''}`}
              title={`${e.key === 'complete' ? 'Ran out' : e.key === 'outOfLine' ? `Out of line on the ${e.ball}` : `Missed the ${e.ball}`}${e.learning ? ' (learning)' : ''}`}>
              {e.key === 'complete' ? '✓' : e.ball}
            </span>
          ))}
        </div>
        <div class="legend small" style={{ margin: 0 }}>
          <span><i class="rack done mini">✓</i>ran out</span>
          <span><i class="rack mini">4</i>missed</span>
          <span><i class="rack line mini">4</i>out of line</span>
          {c.learning > 0 && <span><i class="rack learn mini">4</i>learning</span>}
        </div>
      </>}
    </div>
  );
}

// ---------- diagnostic (D2, mirror set) ----------

function Diagnostic({ drill, session, push }: { drill: DrillDef; session: TallySession; push: (e: Omit<TallyEvent, 't'>, m: string) => void }) {
  const blocks = drill.blocks ?? [{ id: 'M', name: drill.name, keys: ['make', 'thick', 'thin'] as DiagKey[] }];
  const sides = drill.sides ?? ['L', 'R'];
  const lastEv = [...session.events].reverse().find(e => e.block);
  const [blockId, setBlockId] = useState(lastEv?.block ?? blocks[0].id);
  const [side, setSide] = useState<Side>(lastEv?.side ?? sides[0]);
  const [autoSwitch, setAutoSwitch] = useState(!!drill.alternateMakes);
  // After an undo, return to the side (and block) of the shot that is now last, so an
  // undone make with alternate-makes on puts you back where you were.
  const prevLen = useRef(session.events.length);
  const prevLast = useRef<TallyEvent | undefined>(session.events[session.events.length - 1]);
  useEffect(() => {
    if (session.events.length < prevLen.current && prevLast.current?.side) {
      setSide(prevLast.current.side);
      if (prevLast.current.block) setBlockId(prevLast.current.block);
    }
    prevLen.current = session.events.length;
    prevLast.current = session.events[session.events.length - 1];
  }, [session.events.length]);
  const block = blocks.find(b => b.id === blockId) ?? blocks[0];
  const counts = diagnosticCounts(session)[block.id] ?? { L: blank(), R: blank() };
  const target = drill.target?.perCell;

  const tap = (k: DiagKey) => {
    push({ key: k, block: block.id, side }, `${SIDE_LABEL[side]}: ${KEY_LABEL[k].toLowerCase()}`);
    if (k === 'make' && autoSwitch && sides.length > 1) setSide(side === 'L' ? 'R' : 'L');
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if (k === 'm') tap('make'); else if (k === 'k') tap('thick'); else if (k === 'n') tap('thin');
      else if (k === 'r' && block.keys.includes('rail')) tap('rail'); else if (k === 'p' && block.keys.includes('pocket')) tap('pocket');
      else if (k === ' ' || k === 's') { e.preventDefault(); setSide(side === 'L' ? 'R' : 'L'); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });

  const misses = (c: { thick: number; thin: number }) => c.thick + c.thin;

  return (
    <div class="tally-body">
      {blocks.length > 1 && (
        <div class="seg seg-big" role="group" aria-label="Block">
          {blocks.map(b => <button key={b.id} aria-pressed={b.id === block.id} onClick={() => setBlockId(b.id)}>{b.name}</button>)}
        </div>
      )}

      <div class="side-pick" role="group" aria-label="Side">
        {sides.map(s => (
          <button key={s} aria-pressed={side === s} onClick={() => setSide(s)}>
            {SIDE_LABEL[s]}
            <small class="num">{counts[s].make} made · {misses(counts[s])} missed</small>
          </button>
        ))}
      </div>
      {sides.length > 1 && (
        <label class="small switch-row">
          <input type="checkbox" checked={autoSwitch} onChange={() => setAutoSwitch(!autoSwitch)} />
          Switch side after a make (alternate makes)
        </label>
      )}

      <button class="tap tap-make tap-wide" onClick={() => tap('make')}>Make<small class="kbd-hint">M</small></button>
      <div class="tap-pair">
        <button class="tap tap-miss" onClick={() => tap('thick')}>Thick miss<small>head-rail side<span class="kbd-hint"> · K</span></small></button>
        <button class="tap tap-miss" onClick={() => tap('thin')}>Thin miss<small>long-rail side<span class="kbd-hint"> · N</span></small></button>
      </div>
      {block.keys.includes('rail') && (
        <div class="tap-pair">
          <button class="tap tap-cb" onClick={() => tap('rail')}>Cue ball to rail<small>true stun<span class="kbd-hint"> · R</span></small></button>
          <button class="tap tap-cb" onClick={() => tap('pocket')}>Cue ball to pocket<small>carried roll<span class="kbd-hint"> · P</span></small></button>
        </div>
      )}

      <div class="scroll-x" style={{ marginTop: '12px' }}>
        <table class="tally-table">
          <thead><tr><th>{block.name}</th>{sides.map(s => <th key={s} class="n">{SIDE_LABEL[s]}</th>)}</tr></thead>
          <tbody>
            {block.keys.map(k => <tr key={k}><td>{KEY_LABEL[k]}</td>{sides.map(s => <td key={s} class="n">{int(counts[s][k])}</td>)}</tr>)}
            {target && <tr><td>Misses toward {target}</td>{sides.map(s => <td key={s} class="n"><Meter v={misses(counts[s])} max={target} /></td>)}</tr>}
          </tbody>
        </table>
      </div>
      <p class="small muted kbd-hint" style={{ margin: '6px 0 0' }}>With a keyboard: M make, K thick, N thin, Space switch side, Z undo.</p>
    </div>
  );
}

const blank = () => ({ make: 0, thick: 0, thin: 0, rail: 0, pocket: 0 });

function Meter({ v, max }: { v: number; max: number }) {
  return (
    <span class="mini-meter" title={`${v} of ${max}`}>
      <span style={{ width: `${Math.min(100, (100 * v) / max)}%` }} />
      <b class="num">{v}</b>
    </span>
  );
}
