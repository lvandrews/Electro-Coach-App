import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AppData, Tab } from '../app';
import { modelRows, type ModelRow } from '../engine/model';
import type { DrillDef } from '../engine/drills';
import type { TallySession } from '../engine/tally';
import type { Game } from '../engine/games';
import {
  defaultCutoff, drillMeters, drillShotSessions, fitBaseline, latestStart, recentRule, periodSummary, progressNow, rollingSeries,
  segmentByLabel, segmentMeter, sessionPoints, suggestedPins, timelineNotes, TRACKABLE,
  type Baseline, type DiffStat, type DrillMeter, type Note, type SegmentMeter, type SessionPoint, type WindowStat,
} from '../engine/progress';
import { TimeChart, type TMarker } from './TimeChart';
import { useWidth } from './useWidth';
import { Empty } from './SessionsScreen';
import { fmtDate, int, localYmd, pct, plural } from './format';

// ---------- helpers ----------

let rowCache: { key: unknown; rows: ModelRow[] } | null = null;
export function rowsFor(data: AppData) {
  if (rowCache?.key !== data.exclusions) rowCache = { key: data.exclusions, rows: modelRows(data.shotList, data.exclusions) };
  return rowCache.rows;
}
const pts = (x: number, d = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(100 * x).toFixed(d)}`;
const tone = (lo: number, hi: number) => (lo > 0 ? 'good' : hi < 0 ? 'bad' : '');
const ms = (iso: string) => Date.parse(iso);
const DAY = 86400000;
/** Local noon of a YYYY-MM-DD date, so markers sit on the right day. */
const ymdMs = (ymd: string) => Date.parse(`${ymd}T12:00:00`);

type Props = {
  data: AppData; drills: DrillDef[]; tallies: TallySession[]; games: Game[];
  baseline: Baseline | null; notes: Note[]; pins: string[] | null;
  onBaseline: (b: Baseline) => Promise<void>; onNotes: (n: Note[]) => Promise<void>; onPins: (p: string[]) => Promise<void>;
  onGo: (t: Tab) => void;
};

// ---------- screen ----------

export function ProgressScreen(p: Props) {
  const { data, baseline } = p;
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setReady(false); const t = setTimeout(() => setReady(true), 30); return () => clearTimeout(t); }, [data.exclusions]);
  const rows = useMemo(() => (ready ? rowsFor(data) : null), [ready, data.exclusions]);

  // First visit: freeze the yardstick at the default cutoff (everything before your recent play).
  useEffect(() => {
    if (!rows || baseline || rows.length < 50) return;
    try { p.onBaseline(fitBaseline(rows, defaultCutoff(rows), new Date(), true)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [rows, baseline]);

  const timeline = useMemo(() => timelineNotes(p.notes, p.tallies), [p.notes, p.tallies]);
  const markers: TMarker[] = timeline.map(n => ({ t: ymdMs(n.date), n: n.n, title: `${n.n}. ${fmtDate(`${n.date}T12:00:00`)}: ${n.text}` }));

  if (!data.shots.size) return <Empty onGo={p.onGo} />;
  if (err) return <section><h2>Progress</h2><div class="notice bad">The yardstick could not be fitted: {err}.</div></section>;
  if (!rows || !baseline) return <section><h2>Progress</h2><p class="muted">Setting up the yardstick…</p></section>;

  return (
    <section>
      <h2>Progress</h2>
      <p class="lede">Every session measured against your frozen yardstick: zero is your baseline level, above zero is better.</p>
      <Yardstick rows={rows} baseline={baseline} onBaseline={p.onBaseline} />
      <Overall rows={rows} baseline={baseline} markers={markers} />
      <Segments rows={rows} baseline={baseline} pins={p.pins} onPins={p.onPins} markers={markers} />
      <Drills drills={p.drills} rows={rows} tallies={p.tallies} games={p.games} markers={markers} onGo={p.onGo} />
      <div class="card">
        <div class="row"><h3 style={{ margin: 0 }}>Journal</h3><span class="spacer" /><button class="btn btn-s" onClick={() => p.onGo('journal')}>Open the Journal</button></div>
        <p class="small muted" style={{ margin: '6px 0 0' }}>The numbered flags on these charts are your journal entries ({timeline.length} so far): changes to technique or equipment, coach notes, and tally notes.</p>
      </div>
    </section>
  );
}

// ---------- yardstick ----------

function Yardstick({ rows, baseline, onBaseline }: { rows: ModelRow[]; baseline: Baseline; onBaseline: (b: Baseline) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const latest = latestStart(rows);
  const [date, setDate] = useState(localYmd(new Date(baseline.cutoff)));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const after = rows.filter(r => r.shot.sessionStart > baseline.cutoff);
  const afterSessions = new Set(after.map(r => r.shot.sessionId)).size;
  const cutoffFor = (ymd: string) => (ymd >= localYmd(new Date(latest)) ? latest : new Date(`${ymd}T23:59:59`).toISOString());
  const preview = rows.filter(r => r.shot.sessionStart <= cutoffFor(date));

  async function refreeze(useDefault = false) {
    setBusy(true); setMsg(null);
    try { await onBaseline(useDefault ? fitBaseline(rows, defaultCutoff(rows), new Date(), true) : fitBaseline(rows, cutoffFor(date))); setOpen(false); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const rule = baseline.auto ? recentRule(rows, baseline.cutoff, Date.parse(baseline.createdAt)) : null;

  return (
    <div class="card">
      <div class="row" style={{ alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Yardstick</h3>
        <span class="spacer" />
        {!open && <button class="btn btn-s" onClick={() => { setDate(localYmd(new Date(baseline.cutoff))); setOpen(true); }}>Change</button>}
      </div>
      <p class="small" style={{ margin: '6px 0 0' }}>
        Frozen {fmtDate(baseline.createdAt)} on <b class="num">{int(baseline.n)}</b> shots from {baseline.sessions} sessions,
        {' '}{fmtDate(baseline.from, { month: 'short', year: 'numeric' })} to {fmtDate(baseline.to)}. Make rate then: <b class="num">{pct(baseline.makeRate, 1)}</b>.
        {after.length ? <> Since then: <b class="num">{int(after.length)}</b> shots in {plural(afterSessions, 'session')}, measured out of sample.</> : <> No shots since; new imports are measured against it.</>}
      </p>
      <p class="small muted" style={{ margin: '6px 0 0' }}>
        {rule === 'days' ? 'The default: everything before your last 30 days, so those 30 days are measured against it.'
          : rule === 'sessions' ? 'The default: everything before your most recent sessions adding up to 100 or more shots (the last 30 days held fewer), so those sessions are measured against it.'
          : rule === 'all' ? 'Frozen on everything so far: there wasn’t enough earlier play to set recent sessions apart.'
          : 'You chose this cutoff.'}
        {' '}Each new session adds to the comparison, so it gets more telling the more you record.
      </p>
      {open && (
        <div class="subcard" style={{ marginTop: '10px' }}>
          <label class="small" style={{ display: 'grid', gap: '4px', maxWidth: '260px' }}>
            Baseline covers sessions up to
            <input type="date" value={date} max={localYmd(new Date(latest))} onInput={e => setDate((e.target as HTMLInputElement).value)} />
          </label>
          <p class="small muted" style={{ margin: '8px 0' }}>
            {int(preview.length)} shots would go into the new yardstick. An earlier date measures everything after it out of sample: the end of 2025, say, to see how 2026 compares with 2025.
            Refreezing replaces the current yardstick, and every chart here is redrawn against the new one. <b>Use the default</b> sets it to everything before your recent play: the last 30 days, or your latest sessions adding up to 100+ shots.
          </p>
          {preview.length < 300 && <div class="notice">Too few shots for a steady yardstick; pick a later date (300 or more shots).</div>}
          {msg && <div class="notice bad">{msg}</div>}
          <div class="row" style={{ gap: '8px' }}>
            <button class="btn primary" disabled={busy || preview.length < 300} onClick={() => refreeze()}>{busy ? 'Fitting…' : 'Refreeze'}</button>
            <button class="btn" disabled={busy} onClick={() => refreeze(true)}>Use the default</button>
            <button class="btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- overall trend ----------

function Tile({ title, w, d, note }: { title: string; w?: WindowStat | null; d?: DiffStat | null; note?: string }) {
  if (d) return (
    <div class={`tile ${tone(d.lo, d.hi)}`}>
      <div class="tile-title">{title}</div>
      <div class="tile-big num">{pts(d.diff)} <span class="small">pts</span></div>
      <div class="small muted num">range {pts(d.lo)} to {pts(d.hi)}</div>
      {note && <div class="small muted">{note}</div>}
    </div>
  );
  if (!w) return <div class="tile"><div class="tile-title">{title}</div><div class="tile-big muted">—</div><div class="small muted">No shots</div></div>;
  const ok = Number.isFinite(w.se);
  return (
    <div class={`tile ${ok ? tone(w.lo, w.hi) : ''}`}>
      <div class="tile-title">{title}</div>
      <div class="tile-big num">{pts(w.oe)} <span class="small">pts</span></div>
      <div class="small muted num">{ok ? `range ${pts(w.lo)} to ${pts(w.hi)}` : 'one session: no range'}</div>
      <div class="small muted num">{int(w.n)} shots · {plural(w.sessions, 'session')} · made {pct(w.makeRate)}</div>
    </div>
  );
}

type TableFilter = 'all' | '9ft' | '7ft';
function Overall({ rows, baseline, markers }: { rows: ModelRow[]; baseline: Baseline; markers: TMarker[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [mode, setMode] = useState<'oe' | 'made'>('oe');
  const [win, setWin] = useState(30);
  const [table, setTable] = useState<TableFilter>('all');
  const [sel, setSel] = useState<number | null>(null);
  const points = useMemo(() => sessionPoints(baseline, rows, table === 'all' ? undefined : s => s.tableSize === table), [rows, baseline, table]);
  const roll = useMemo(() => rollingSeries(points, win), [points, win]);
  if (!points.length) return <div class="card"><h3>Over time</h3><p class="muted">No shots on this table size.</p></div>;
  const now = progressNow(points);
  const sum = periodSummary(points, baseline, now);
  const t0 = ms(points[0].start) - 10 * DAY, t1 = now + 10 * DAY;
  const r = (p: SessionPoint) => (1.4 + Math.sqrt(p.n) * 0.5) * Math.min(1, Math.max(0.6, width / 700));
  const selP = points.find(x => x.sessionId === sel) ?? null;

  let chart;
  if (mode === 'oe') {
    const vals = points.map(p => (100 * (p.made - p.expected)) / p.n).map(Math.abs).sort((a, b) => a - b);
    const lim = Math.min(40, Math.max(15, Math.ceil((vals[Math.floor(vals.length * 0.9)] ?? 15) / 5) * 5));
    chart = (
      <TimeChart width={width} t0={t0} t1={t1} y0={-lim} y1={lim} yTicks={[-lim, -lim / 2, 0, lim / 2, lim].map(Math.round)} yFmt={v => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0')}
        refY={0} freeze={ms(baseline.cutoff)} markers={markers} selected={sel} onPick={k => setSel(k as number)}
        label="Made minus expected per session, with a rolling average"
        dots={points.map(p => ({ key: p.sessionId, t: ms(p.start), y: (100 * (p.made - p.expected)) / p.n, r: r(p), hollow: p.n < 20 }))}
        band={roll.map(x => ({ t: ms(x.t), lo: x.stat && Number.isFinite(x.stat.se) ? 100 * x.stat.lo : null, hi: x.stat && Number.isFinite(x.stat.se) ? 100 * x.stat.hi : null }))}
        line={roll.map(x => ({ t: ms(x.t), y: x.stat ? 100 * x.stat.oe : null }))} />
    );
  } else {
    chart = (
      <TimeChart width={width} t0={t0} t1={t1} y0={30} y1={100} yTicks={[40, 60, 80, 100]} yFmt={v => `${v}%`}
        freeze={ms(baseline.cutoff)} markers={markers} selected={sel} onPick={k => setSel(k as number)}
        label="Make rate per session, with rolling actual and expected make rates"
        dots={points.map(p => ({ key: p.sessionId, t: ms(p.start), y: (100 * p.made) / p.n, r: r(p), hollow: p.n < 20 }))}
        line2={roll.map(x => ({ t: ms(x.t), y: x.stat ? 100 * x.stat.expRate : null }))}
        line={roll.map(x => ({ t: ms(x.t), y: x.stat ? 100 * x.stat.makeRate : null }))} />
    );
  }

  return (
    <>
      <div class="tiles">
        <Tile title="Last 30 days" w={sum.last30} />
        <Tile title="Last 90 days" w={sum.last90} />
        <Tile title="The 90 days before" w={sum.prev90} />
        <Tile title="Change, 90 vs 90" d={sum.change} note={sum.change ? (sum.change.lo > 0 ? 'Clearly better' : sum.change.hi < 0 ? 'Clearly worse' : 'Not clear yet') : undefined} />
        {sum.sinceFrozen && <Tile title="Since the yardstick froze" w={sum.sinceFrozen} />}
      </div>
      <p class="small muted" style={{ margin: '-4px 0 12px' }}>
        Windows end at your latest session ({fmtDate(new Date(now).toISOString())}). The range is a 95% interval clustered by session; green or red means it clears zero.
      </p>
      <div class="card">
        <div class="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <h3 style={{ margin: 0 }}>Over time</h3>
          <span class="spacer" />
          <div class="seg" role="group" aria-label="Chart">
            <button aria-pressed={mode === 'oe'} onClick={() => setMode('oe')}>Against the yardstick</button>
            <button aria-pressed={mode === 'made'} onClick={() => setMode('made')}>Made vs expected</button>
          </div>
        </div>
        <div class="controls" style={{ marginTop: '10px' }}>
          <label>Rolling window<select value={String(win)} onChange={e => setWin(Number((e.target as HTMLSelectElement).value))}>
            <option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option></select></label>
          <label>Tables<select value={table} onChange={e => { setTable((e.target as HTMLSelectElement).value as TableFilter); setSel(null); }}>
            <option value="all">All tables</option><option value="9ft">9-ft only</option><option value="7ft">7-ft only</option></select></label>
        </div>
        <div ref={ref}>{chart}</div>
        <p class="small muted" style={{ margin: '4px 0 0' }}>
          {mode === 'oe'
            ? <>Dots: one session, made minus expected in points (bigger = more shots; hollow = under 20). Line: the rolling {win}-day average with its 95% band, drawn where the window holds 60+ shots.</>
            : <>Dots: session make rate. Solid line: rolling {win}-day make rate. Dashed: what the yardstick expected for those shots. The gap between them is the other view.</>}
          {' '}Numbered flags are your notes; the dashed amber line is where the yardstick was frozen. Tap a dot for the session.
        </p>
        {selP && (
          <div class="readout small">
            <b>{fmtDate(selP.start)}</b> · {selP.sessionType === 'Free play' ? selP.name || 'Free play' : selP.sessionType} · {int(selP.n)} shots ·
            made <b class="num">{pct(selP.made / selP.n)}</b>, expected <span class="num">{pct(selP.expected / selP.n)}</span> →{' '}
            <b class="num">{pts((selP.made - selP.expected) / selP.n)} pts</b>
          </div>
        )}
      </div>
    </>
  );
}

// ---------- segment meters ----------

function Segments({ rows, baseline, pins, onPins, markers }: { rows: ModelRow[]; baseline: Baseline; pins: string[] | null; onPins: (p: string[]) => Promise<void>; markers: TMarker[] }) {
  const suggested = useMemo(() => (pins ? [] : suggestedPins(baseline, rows)), [pins, baseline, rows]);
  const list = (pins ?? suggested).filter(l => segmentByLabel(l));
  const meters = useMemo(() => list.map(l => segmentMeter(baseline, rows, segmentByLabel(l)!)), [list.join('|'), baseline, rows]);
  const groups = [...new Set(TRACKABLE.map(s => s.group))];
  return (
    <div class="card">
      <h3 style={{ marginTop: 0 }}>Segments you're tracking</h3>
      <p class="small muted" style={{ marginTop: '-4px' }}>
        {pins ? 'Made minus expected for the kinds of shot you pinned, over the last 90 days, against the same yardstick.'
          : 'Suggested to start: segments whose all-time range clears zero, biggest makes lost or gained first. Remove or add any; the practice plan (step 5) will add its targets here.'}
      </p>
      <div class="meter-grid">
        {meters.map(m => <SegmentCard key={m.label} m={m} markers={markers} onRemove={() => onPins(list.filter(x => x !== m.label))} />)}
      </div>
      <label class="small" style={{ display: 'grid', gap: '4px', maxWidth: '360px', marginTop: '10px' }}>
        Track another segment
        <select value="" onChange={e => { const v = (e.target as HTMLSelectElement).value; if (v && !list.includes(v)) onPins([...list, v]); }}>
          <option value="">Choose…</option>
          {groups.map(g => <optgroup key={g} label={g}>{TRACKABLE.filter(s => s.group === g && !list.includes(s.label)).map(s => <option key={s.label} value={s.label}>{s.label}</option>)}</optgroup>)}
        </select>
      </label>
    </div>
  );
}

function SegmentCard({ m, markers, onRemove }: { m: SegmentMeter; markers: TMarker[]; onRemove: () => void }) {
  const [ref, width] = useWidth<HTMLDivElement>(240);
  const w = m.last90, a = m.allTime;
  const t0 = m.points.length ? ms(m.points[0].start) : 0, t1 = m.points.length ? ms(m.points[m.points.length - 1].start) : 1;
  const ok = w && Number.isFinite(w.se);
  return (
    <div class={`pmeter ${ok ? tone(w!.lo, w!.hi) : ''}`}>
      <div class="row" style={{ alignItems: 'start', gap: '6px' }}>
        <div class="meter-title">{m.label}</div>
        <span class="spacer" />
        <button class="x-btn" title="Stop tracking" aria-label={`Stop tracking ${m.label}`} onClick={onRemove}>×</button>
      </div>
      {w ? <>
        <div class="tile-big num">{pts(w.oe)} <span class="small">pts</span></div>
        <div class="small muted num">last 90 days · {ok ? `range ${pts(w.lo)} to ${pts(w.hi)}` : 'one session'} · {int(w.n)} shots</div>
      </> : <div class="small muted">No shots in the last 90 days.</div>}
      {a && <div class="small num" style={{ marginTop: '4px' }}>All time {pts(a.oe)} ({int(a.n)} shots){m.change ? <> · change vs the 90 days before {pts(m.change.diff)}{m.change.lo > 0 || m.change.hi < 0 ? '' : ' (not clear)'}</> : null}</div>}
      <div ref={ref} style={{ marginTop: '6px' }}>
        {m.points.length > 1 && <TimeChart compact width={width} t0={t0} t1={t1} y0={-25} y1={25} refY={0}
          label={`${m.label}: rolling 90-day made minus expected`} markers={markers.filter(x => x.t >= t0 && x.t <= t1)}
          band={m.rolling.map(x => ({ t: ms(x.t), lo: x.stat && Number.isFinite(x.stat.se) ? 100 * x.stat.lo : null, hi: x.stat && Number.isFinite(x.stat.se) ? 100 * x.stat.hi : null }))}
          line={m.rolling.map(x => ({ t: ms(x.t), y: x.stat ? 100 * x.stat.oe : null }))} />}
      </div>
    </div>
  );
}

// ---------- drill meters ----------

function Drills({ drills, rows, tallies, games, markers, onGo }: { drills: DrillDef[]; rows: ModelRow[]; tallies: TallySession[]; games: Game[]; markers: TMarker[]; onGo: (t: Tab) => void }) {
  const meters = useMemo(() => drillMeters(drills, drillShotSessions(rows), tallies, games), [drills, rows, tallies, games]);
  return (
    <div class="card">
      <h3 style={{ marginTop: 0 }}>Drills</h3>
      <p class="small muted" style={{ marginTop: '-4px' }}>
        Last five sessions against everything before (with fewer than ten sessions, the later half against the earlier). Rep drills use Railbird's record; Transitions use your tapped completions; diagnostic drills use your taps.
        A drill appears once Railbird sessions with its tag, or tallies, exist.
      </p>
      {meters.length ? <div class="meter-grid">{meters.map(m => <DrillCard key={m.drill.id} m={m} markers={markers} />)}</div>
        : <p class="muted">No drill sessions yet. <button class="btn btn-s" onClick={() => onGo('drills')}>Open the drill library</button></p>}
    </div>
  );
}

function DrillCard({ m, markers }: { m: DrillMeter; markers: TMarker[] }) {
  const [ref, width] = useWidth<HTMLDivElement>(240);
  const r = m.recent, e = m.earlier;
  const t0 = m.points.length ? ms(m.points[0].date) - 3 * DAY : 0, t1 = m.points.length ? ms(m.points[m.points.length - 1].date) + 3 * DAY : 1;
  const unitN = m.kind === 'completion' ? 'racks' : m.kind === 'score' ? 'games' : 'shots';
  const show = (v: number) => (m.kind === 'score' ? v.toFixed(0) : pct(v));
  const plot = (v: number) => (m.max === 1 ? 100 * v : v);
  const delta = r && e ? r.value - e.value : null;
  const vals = m.points.map(p => plot(p.value)), top = plot(m.max), step = m.max === 1 ? 10 : 25;
  const y0 = Math.max(0, Math.floor((Math.min(...vals) - step * 0.8) / step) * step), y1 = Math.min(top, Math.ceil((Math.max(...vals) + step * 0.8) / step) * step);
  const rbAll = m.kind !== 'reps' && m.railbird.length ? m.railbird.reduce((s, p) => s + p.value * p.n, 0) / m.railbird.reduce((s, p) => s + p.n, 0) : null;
  return (
    <div class="pmeter">
      <div class="meter-title">{m.drill.name}</div>
      <div class="small muted">{m.unit}</div>
      {r ? <>
        <div class="tile-big num">{show(r.value)}</div>
        <div class="small muted num">{m.kind === 'score' ? `average of the last ${plural(r.sessions, 'game')}` : <>last {plural(r.sessions, 'session')} · {plural(r.n, unitN.slice(0, -1))}</>}</div>
        <div class="bar-meter" aria-hidden="true">
          <div class="fill" style={{ width: `${(100 * r.value) / m.max}%` }} />
          {e && <div class="tick" style={{ left: `${(100 * e.value) / m.max}%` }} />}
        </div>
        <div class="small num">
          {e ? <>Earlier: {show(e.value)} over {plural(e.sessions, m.kind === 'score' ? 'game' : 'session')} · {delta! >= 0 ? '+' : '−'}{Math.abs(m.max === 1 ? 100 * delta! : delta!).toFixed(0)}{m.max === 1 ? ' pts' : ''}</> : 'Nothing earlier to compare with yet.'}
        </div>
      </> : <div class="small muted">No {m.kind === 'completion' ? 'tapped racks' : 'sessions'} yet.</div>}
      <div ref={ref} style={{ marginTop: '6px' }}>
        {m.points.length > 1 && <TimeChart compact width={width} t0={t0} t1={t1} y0={y0} y1={y1} refY={r ? plot(r.value) : undefined}
          label={`${m.drill.name}: ${m.unit} per session`} markers={markers.filter(x => x.t >= t0 && x.t <= t1)}
          dots={m.points.map((p, i) => ({ key: i, t: ms(p.date), y: plot(p.value), r: 2.5, hollow: p.n < m.target }))}
          line={m.points.map((p, i, a) => { const s = a.slice(Math.max(0, i - 2), i + 1); const n = s.reduce((x, q) => x + q.n, 0); return { t: ms(p.date), y: n ? plot(s.reduce((x, q) => x + q.value * q.n, 0) / n) : null }; })} />}
      </div>
      {m.extra.map((x, i) => <div key={i} class="small" style={{ marginTop: '4px' }}>{x}</div>)}
      {rbAll != null && <div class="small muted" style={{ marginTop: '4px' }}>Railbird make rate in these sessions: {pct(rbAll)} ({plural(m.railbird.length, 'session')}).</div>}
      {m.points.some(p => p.n < m.target) && <div class="small muted" style={{ marginTop: '4px' }}>Hollow dots: under {m.target} {unitN}, too few to read alone.</div>}
    </div>
  );
}
