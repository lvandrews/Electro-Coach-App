import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AppData } from '../app';
import type { DrillDef } from '../engine/drills';
import type { TallySession } from '../engine/tally';
import { newGameId, type Game } from '../engine/games';
import { buildPlan, sessionBlocks, type PlanSettings } from '../engine/plan';
import type { Baseline } from '../engine/progress';
import {
  blockDue, buildRun, changeover, countSoFar, fitMinutes, MODE_LABEL, msLeft, plannedTotal,
  type BlockMode, type CountUnit, type EndRule, type PracticeSession, type RunBlock,
} from '../engine/session';
import { askExactAlarms, cancelBlockEnd, prepareNotifications, scheduleBlockEnd } from '../notify';
import { isNative } from '../platform';
import { sounds, unlockAudio } from './sound';
import { useWakeLock } from './TallyScreen';
import { TableDiagram } from './TableDiagram';
import { rowsFor } from './ProgressScreen';
import { fmtTime } from './format';

const NOTE_ID = 7100;
const clock = (ms: number) => { const s = Math.round(Math.abs(ms) / 1000); return `${ms < 0 ? '+' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export function useNow(ms = 500) { const [n, setN] = useState(Date.now()); useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]); return n; }

type Props = {
  data: AppData; baseline: Baseline | null; plan: PlanSettings; drills: DrillDef[]; tallies: TallySession[]; games: Game[];
  session: PracticeSession | null; device: string;
  onSave: (s: PracticeSession) => Promise<void>; onDelete: (id: string) => Promise<void>;
  onStartTally: (d: DrillDef) => Promise<string>; onOpenTally: () => void; onEndTally: (id: string) => Promise<void>;
  onOpenScorer: () => void; onAddNote: (text: string) => Promise<void>; onDone: () => void; onGoPlan: () => void;
};

export function SessionScreen(p: Props) {
  if (p.session && !p.session.ended) {
    return p.session.current >= p.session.blocks.length ? <Summary {...p} s={p.session} /> : <Runner {...p} s={p.session} />;
  }
  return <Review {...p} />;
}

// ---------- 1. review the plan's blocks ----------

function Review(p: Props) {
  const rows = rowsFor(p.data);
  const planned = useMemo(() => {
    if (!p.baseline || !rows.length) return null;
    const plan = buildPlan(p.baseline, rows, p.plan.period);
    return buildRun(sessionBlocks(plan, p.plan.hidden, p.plan.minutes), p.drills, p.plan.minutes);
  }, [p.baseline, p.data.exclusions, p.plan, p.drills]);
  const [run, setRun] = useState<RunBlock[] | null>(planned);
  useEffect(() => setRun(planned), [planned]);
  const [perm, setPerm] = useState<{ ok: boolean; exact: boolean } | null>(null);
  if (!run) return <section><h2>Practice session</h2><p class="muted">The session is built from your practice plan, which needs imported Railbird data first.</p></section>;

  const byId = new Map(p.drills.map(d => [d.id, d]));
  const set = (i: number, patch: Partial<RunBlock>) => setRun(run.map((b, k) => (k === i ? { ...b, ...patch } : b)));
  const move = (i: number, d: -1 | 1) => { const r = [...run]; [r[i], r[i + d]] = [r[i + d], r[i]]; setRun(r); };
  const total = plannedTotal(run);

  async function start() {
    unlockAudio();
    const pr = await prepareNotifications(); setPerm(pr);
    const now = new Date().toISOString();
    const s: PracticeSession = { id: newGameId(), kind: 'practice', date: now, updated: now, minutes: total, blocks: run!.map((b, i) => (i === 0 ? { ...b, setupAt: now } : b)), current: 0, device: p.device };
    await p.onSave(s);
  }

  return (
    <section>
      <h2>Practice session</h2>
      <p class="lede">Your next session, block by block; each block waits for your tap before its timer starts.</p>
      <ol class="run-list">
        {run.map((b, i) => {
          const d = b.drillId ? byId.get(b.drillId) : undefined;
          return (
            <li key={i} class="card run-item">
              <div class="row" style={{ alignItems: 'baseline', gap: '8px' }}>
                <b class="grow">{i + 1}. {b.title}</b>
                {changeover(run[i - 1], b) > 0 && <span class="small muted">+{changeover(run[i - 1], b)}′ changeover</span>}
              </div>
              <div class="run-fields">
                <label>Drill<select value={b.drillId ?? ''} onChange={e => set(i, { drillId: (e.target as HTMLSelectElement).value || null })}>
                  {[...new Set([...b.drills, ...(b.drillId ? [b.drillId] : [])])].map(id => <option key={id} value={id}>{byId.get(id)?.name ?? id}</option>)}
                  {p.drills.filter(x => !b.drills.includes(x.id)).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  <option value="">No drill (free practice)</option></select></label>
                <label>Minutes<span class="stepper">
                  <button class="btn btn-s" onClick={() => set(i, { minutes: Math.max(3, b.minutes - 1) })} aria-label="One minute less">−</button>
                  <b class="num">{b.minutes}</b>
                  <button class="btn btn-s" onClick={() => set(i, { minutes: b.minutes + 1 })} aria-label="One minute more">+</button></span></label>
                <label>Recording<select value={b.mode} onChange={e => { const m = (e.target as HTMLSelectElement).value as BlockMode; set(i, { mode: m, end: m === 'tap' ? b.end : 'time' }); }}>
                  {(Object.keys(MODE_LABEL) as BlockMode[]).filter(m => m !== 'tap' || (d && (d.counters !== 'none' || d.scorer))).map(m => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</select></label>
                {b.mode === 'tap' && <EndFields b={b} onChange={patch => set(i, patch)} />}
              </div>
              <div class="row" style={{ gap: '6px', marginTop: '6px' }}>
                <button class="btn btn-s" disabled={i === 0} onClick={() => move(i, -1)}>Move up</button>
                <button class="btn btn-s" disabled={i === run.length - 1} onClick={() => move(i, 1)}>Move down</button>
                <button class="btn btn-s" disabled={run.length < 2} onClick={() => setRun(run.filter((_, k) => k !== i))}>Remove</button>
              </div>
            </li>
          );
        })}
      </ol>
      <div class="card">
        <div class="row" style={{ alignItems: 'baseline' }}>
          <div><b class="num" style={{ fontSize: '1.4rem' }}>{total} minutes</b> <span class="small muted">including changeovers{total !== p.plan.minutes ? ` (plan: ${p.plan.minutes})` : ''}</span></div>
          <span class="spacer" />
          {total !== p.plan.minutes && <button class="btn btn-s" onClick={() => setRun(fitMinutes(run.map(b => ({ ...b })), p.plan.minutes))}>Fit to {p.plan.minutes}</button>}
        </div>
        {isNative()
          ? <p class="small muted">Filmed blocks: put the phone on its stand and start Railbird; when time is up the phone and your watch alert you. Tap blocks: keep the phone with you; the tally opens when the block starts.</p>
          : <p class="small muted">In the web version the end of a block sounds only while Electro-Coach is on screen, so with Railbird in front, keep an eye on the time (or set a phone timer). Tap blocks: the tally opens when the block starts.</p>}
        <div class="row" style={{ gap: '8px' }}>
          <button class="btn primary" onClick={start}>Start session</button>
          <button class="btn" onClick={p.onGoPlan}>Change the plan</button>
        </div>
        {perm && isNative() && !perm.ok && <div class="notice" style={{ marginTop: '8px' }}>Notifications are off for Electro-Coach, so filmed blocks can't alert you while Railbird is in front. Turn them on in Android settings → Apps → Electro-Coach → Notifications.</div>}
      </div>
    </section>
  );
}

function EndFields({ b, onChange }: { b: RunBlock; onChange: (p: Partial<RunBlock>) => void }) {
  return <>
    <label>Ends<select value={b.end} onChange={e => onChange({ end: (e.target as HTMLSelectElement).value as EndRule })}>
      <option value="time">On time</option><option value="count">At a count</option><option value="either">Whichever comes first</option></select></label>
    {b.end !== 'time' && <label>Count<span class="stepper">
      <input type="number" min={1} value={b.count ?? 5} onInput={e => onChange({ count: Math.max(1, Number((e.target as HTMLInputElement).value) || 1) })} style={{ width: '70px' }} />
      <select value={b.unit ?? 'racks'} onChange={e => onChange({ unit: (e.target as HTMLSelectElement).value as CountUnit })}>
        <option value="racks">racks</option><option value="shots">shots</option><option value="makes">makes</option><option value="games">games</option></select></span></label>}
  </>;
}

// ---------- 2. run it ----------

function Runner(p: Props & { s: PracticeSession }) {
  useWakeLock();
  const now = useNow(250);
  const { s } = p;
  const b = s.blocks[s.current];
  const next = s.blocks[s.current + 1];
  const drill = b.drillId ? p.drills.find(d => d.id === b.drillId) : undefined;
  const left = msLeft(s, now);
  const counted = countSoFar(b, p.tallies, p.games, drill);
  const due = b.startedAt ? blockDue(b, left, counted) : false;
  const [perm, setPerm] = useState<{ ok: boolean; exact: boolean } | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  useEffect(() => { prepareNotifications().then(setPerm); }, []);

  const save = (patch: Partial<PracticeSession>) => p.onSave({ ...s, ...patch, updated: new Date().toISOString() });
  const setBlock = (patch: Partial<RunBlock>, extra: Partial<PracticeSession> = {}) => save({ ...extra, blocks: s.blocks.map((x, i) => (i === s.current ? { ...x, ...patch } : x)) });
  const notify = (endMs: number) => b.end !== 'count' && scheduleBlockEnd(NOTE_ID + s.current, new Date(endMs), `Time: ${b.title}`, next ? `Next: ${next.title}. Open Electro-Coach to continue.` : 'Last block done. Open Electro-Coach to finish.');

  async function startBlock() {
    unlockAudio(); sounds.start();
    const t = Date.now();
    let tallyId = b.tallyId;
    if (b.mode === 'tap' && drill && drill.counters !== 'none' && !tallyId) tallyId = await p.onStartTally(drill);
    await setBlock({ startedAt: new Date(t).toISOString(), tallyId });
    notify(t + b.minutes * 60000);
    if (b.mode === 'tap' && drill?.scorer) p.onOpenScorer();
  }
  async function pause() {
    if (s.paused) {
      const started = Date.now() - (b.minutes * 60000 - s.paused.remainingMs);
      await setBlock({ startedAt: new Date(started).toISOString() }, { paused: null });
      notify(started + b.minutes * 60000);
    } else {
      await save({ paused: { at: new Date().toISOString(), remainingMs: left ?? 0 } });
      cancelBlockEnd(NOTE_ID + s.current);
    }
  }
  async function addMinute() {
    await setBlock({ minutes: b.minutes + 1 });
    if (b.startedAt && !s.paused) notify(Date.parse(b.startedAt) + (b.minutes + 1) * 60000);
  }
  async function nextBlock() {
    unlockAudio();
    cancelBlockEnd(NOTE_ID + s.current);
    if (b.tallyId) await p.onEndTally(b.tallyId);
    const t = new Date().toISOString();
    const blocks = s.blocks.map((x, i) => (i === s.current ? { ...x, endedAt: t, counted: x.unit ? counted : undefined, startedAt: x.startedAt ?? t } : i === s.current + 1 ? { ...x, setupAt: t } : x));
    await p.onSave({ ...s, blocks, current: s.current + 1, paused: null, updated: t });
  }
  async function endEarly() {
    cancelBlockEnd(NOTE_ID + s.current);
    if (b.tallyId) await p.onEndTally(b.tallyId);
    const t = new Date().toISOString();
    await p.onSave({ ...s, blocks: s.blocks.map((x, i) => (i === s.current && x.startedAt ? { ...x, endedAt: t, counted: x.unit ? counted : undefined } : x)), current: s.blocks.length, paused: null, updated: t });
  }

  const tags = drill ? (drill.railbirdBuiltIn ? [] : drill.tags.map(t => t.value)) : [];
  return (
    <section class="runner">
      <div class="row" style={{ alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>Block {s.current + 1} of {s.blocks.length}</h2>
        <span class="spacer" />
        <span class="small muted">{s.minutes}-minute session · started {fmtTime(s.date)}</span>
      </div>
      <div class="run-dots" aria-hidden="true">{s.blocks.map((x, i) => <span key={i} class={i < s.current ? 'done' : i === s.current ? 'now' : ''} style={{ flexGrow: x.minutes }} />)}</div>

      {!b.startedAt ? (
        <div class="card setup-card">
          <div class="small muted">Set up</div>
          <h3 style={{ margin: '2px 0 4px' }}>{b.title}</h3>
          <p class="small muted" style={{ margin: 0 }}>{b.why}</p>
          {drill && <div class="setup-grid">
            <div style={{ maxWidth: '200px' }}>{drill.diagram && <TableDiagram spec={drill.diagram} title={`${drill.name} layout`} maxWidth={200} />}</div>
            <div>
              <div class="panel-title" style={{ marginTop: 0 }}>{drill.name}</div>
              <ul class="setup small">{drill.setup.slice(0, 3).map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          </div>}
          <div class={`mode-box m-${b.mode}`}>
            <b>{MODE_LABEL[b.mode]}</b>
            {b.mode === 'record' && <>
              <div class="small">Put the phone on its stand and start Railbird{drill?.railbirdBuiltIn ? ` in its ${drill.railbirdBuiltIn === 'drillx-shot' ? 'X-shot' : 'spot-shot'} drill mode` : tags.length ? ' with this tag' : ''}.</div>
              {tags.map(t => <button key={t} class="btn btn-s tag-copy" onClick={() => navigator.clipboard?.writeText(t)}>{t} · copy</button>)}
              <div class="small">Your phone and watch will alert you after {b.minutes} minutes.</div>
            </>}
            {b.mode === 'tap' && <div class="small">Keep the phone with you. {drill?.scorer ? 'The scorer opens when you start.' : 'The tally opens when you start.'} {b.end === 'time' ? `Ends after ${b.minutes} minutes.` : b.end === 'count' ? `Ends at ${b.count} ${b.unit}.` : `Ends at ${b.count} ${b.unit} or ${b.minutes} minutes, whichever comes first.`}</div>}
            {b.mode === 'free' && <div class="small">No recording. Ends after {b.minutes} minutes.</div>}
          </div>
          {b.mode === 'tap' && <EndFields b={b} onChange={patch => setBlock(patch)} />}
          <button class="btn primary big-btn" onClick={startBlock}>Start block · {b.minutes} min</button>
        </div>
      ) : (
        <div class={`card timer-card ${due ? 'due' : left != null && left < 60000 ? 'soon' : ''}`}>
          <div class="small muted">{b.title}{drill ? ` · ${drill.name}` : ''}</div>
          {due ? <>
            <div class="timer-big">{b.end !== 'time' && b.count != null && counted >= b.count ? 'Done' : 'Time'}</div>
            <div class="small">{left != null && left < 0 ? `${clock(left)} over` : ''}{b.unit ? ` · ${counted} ${b.unit}` : ''}</div>
            <div class="next-up">{next ? <>Next: <b>{next.title}</b> · {MODE_LABEL[next.mode].toLowerCase()}</> : 'That was the last block.'}</div>
            <button class="btn primary big-btn" onClick={nextBlock}>{next ? 'Next block' : 'Finish the session'}</button>
          </> : <>
            <div class="timer-big num">{s.paused ? clock(s.paused.remainingMs) : left != null ? clock(left) : ''}</div>
            {b.end !== 'count' && <div class="clock-bar"><span style={{ width: `${Math.max(0, Math.min(1, (left ?? 0) / (b.minutes * 60000))) * 100}%` }} /></div>}
            {b.unit && b.end !== 'time' && <div class="count-line num">{counted} of {b.count} {b.unit}</div>}
            {s.paused && <div class="small" style={{ color: 'var(--warn)', fontWeight: 600 }}>Paused</div>}
            <div class="row" style={{ gap: '8px', justifyContent: 'center', marginTop: '10px' }}>
              {b.mode === 'tap' && drill && (drill.scorer
                ? <button class="btn primary" onClick={p.onOpenScorer}>Open the scorer</button>
                : <button class="btn primary" onClick={b.tallyId && p.tallies.some(t => t.id === b.tallyId && !t.ended) ? p.onOpenTally : async () => { const id = await p.onStartTally(drill); await setBlock({ tallyId: id }); }}>Open the tally</button>)}
              <button class="btn" onClick={pause}>{s.paused ? 'Resume' : 'Pause'}</button>
              <button class="btn" onClick={addMinute}>+1 min</button>
              <button class="btn" onClick={nextBlock}>End block now</button>
            </div>
          </>}
        </div>
      )}

      {perm && isNative() && perm.ok && !perm.exact && b.mode === 'record' && (
        <div class="notice small">Android may deliver the end-of-block alert a little late. For alerts on the second, allow “Alarms &amp; reminders” for Electro-Coach. <button class="btn btn-s" onClick={async () => { await askExactAlarms(); setPerm(await prepareNotifications()); }}>Allow</button></div>
      )}
      {perm && isNative() && !perm.ok && <div class="notice small">Notifications are off for Electro-Coach, so you won't get an alert while Railbird is in front.</div>}

      <div class="row" style={{ gap: '8px', marginTop: '10px' }}>
        {confirmEnd
          ? <><button class="btn btn-s danger" onClick={endEarly}>End the session here</button><button class="btn btn-s" onClick={() => setConfirmEnd(false)}>Keep going</button></>
          : <button class="btn btn-s" onClick={() => setConfirmEnd(true)}>End session early…</button>}
      </div>
    </section>
  );
}

// ---------- 3. summary and log ----------

function Summary(p: Props & { s: PracticeSession }) {
  const { s } = p;
  const [rating, setRating] = useState<number | undefined>(s.rating);
  const [note, setNote] = useState(s.note ?? '');
  const [toJournal, setToJournal] = useState(true);
  const mins = (b: RunBlock) => (b.startedAt && b.endedAt ? Math.round((Date.parse(b.endedAt) - Date.parse(b.startedAt)) / 60000) : null);
  async function finish() {
    const t = new Date().toISOString();
    await p.onSave({ ...s, rating, note: note.trim() || undefined, ended: t, updated: t });
    if (note.trim() && toJournal) await p.onAddNote(`Practice session (${s.minutes} min): ${note.trim()}`);
    p.onDone();
  }
  return (
    <section>
      <h2>Session done</h2>
      <div class="card">
        <table class="run-table">
          <thead><tr><th>Block</th><th class="num">Planned</th><th class="num">Actual</th><th class="num">Count</th></tr></thead>
          <tbody>{s.blocks.map((b, i) => (
            <tr key={i} class={b.endedAt ? '' : 'skipped'}>
              <td>{b.title}</td><td class="num">{b.minutes}′</td>
              <td class="num">{mins(b) != null ? `${mins(b)}′` : 'skipped'}</td>
              <td class="num">{b.counted != null ? `${b.counted} ${b.unit}` : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div class="card">
        <div class="pref-label">How did it feel?</div>
        <div class="seg wrap" role="group" aria-label="Rating" style={{ margin: '6px 0 12px' }}>
          {[1, 2, 3, 4, 5].map(r => <button key={r} aria-pressed={rating === r} onClick={() => setRating(r)}>{r}</button>)}
        </div>
        <label class="field">Note (optional)<textarea rows={3} value={note} placeholder="What clicked, what didn't, what to try next time…" onInput={e => setNote((e.target as HTMLTextAreaElement).value)} /></label>
        {note.trim() && <label class="small switch-row" style={{ marginBottom: '10px' }}><input type="checkbox" checked={toJournal} onChange={() => setToJournal(!toJournal)} /> Also add it to the Journal (flagged on the Progress charts)</label>}
        <button class="btn primary" onClick={finish}>Save the session</button>
      </div>
    </section>
  );
}

// ---------- alerts while the app is open (on any screen) ----------

/** Plays the end-of-block tone once when a running block becomes due, wherever you are in the app. */
export function useSessionAlerts(s: PracticeSession | null, tallies: TallySession[], games: Game[], drills: DrillDef[]) {
  const alerted = useRef<string>('');
  const now = useNow(500);
  if (!s || s.ended || s.paused) return;
  const b = s.blocks[s.current];
  if (!b?.startedAt) return;
  const key = `${s.id}:${s.current}:${b.startedAt}`;
  const drill = b.drillId ? drills.find(d => d.id === b.drillId) : undefined;
  if (alerted.current !== key && blockDue(b, msLeft(s, now), countSoFar(b, tallies, games, drill))) {
    alerted.current = key;
    sounds.expire();
    try { navigator.vibrate?.([400, 150, 400]); } catch { /* ignore */ }
  }
}

/** One-line status for the banner shown on other screens. */
export function sessionStatus(s: PracticeSession, tallies: TallySession[], games: Game[], drills: DrillDef[], now = Date.now()) {
  const b = s.blocks[s.current];
  if (!b) return { text: 'Practice session: finish and save', due: true };
  if (!b.startedAt) return { text: `Practice · block ${s.current + 1} of ${s.blocks.length}: set up ${b.title}`, due: false };
  const drill = b.drillId ? drills.find(d => d.id === b.drillId) : undefined;
  const left = msLeft(s, now), counted = countSoFar(b, tallies, games, drill);
  const due = blockDue(b, left, counted);
  const cnt = b.unit && b.end !== 'time' ? ` · ${counted}/${b.count} ${b.unit}` : '';
  return { text: due ? `Practice · ${b.title}: time. Tap to move on` : `Practice · ${b.title} · ${s.paused ? 'paused' : left != null ? `${clock(left)} left` : ''}${cnt}`, due };
}
