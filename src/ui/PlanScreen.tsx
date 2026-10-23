import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AppData, Tab } from '../app';
import type { DrillDef } from '../engine/drills';
import { fitBaseline, latestStart, suggestedPins, type Baseline } from '../engine/progress';
import { buildPlan, PLAN_PERIODS, type PlanItem, type PlanPeriod, type PlanSettings } from '../engine/plan';
import type { Game } from '../engine/games';
import type { TallySession } from '../engine/tally';
import { estLabel } from '../engine/workout';
import { MODE_LABEL } from '../engine/session';
import { ADAPT_NOTE, composeFor, filmingStatus } from './sessionPlan';
import { RailbirdRole } from './RailbirdRole';
import type { Tier } from '../engine/ledger';
import { rowsFor } from './ProgressScreen';
import { Empty } from './SessionsScreen';
import { fmtDate, int, pct } from './format';

const TIER_CLASS: Record<Tier, string> = {
  'Established strength': 't-strong', 'Emerging strength': 't-emerging', Neutral: 't-neutral', Watch: 't-watch', 'Established weakness': 't-weak',
};
const pts = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(100 * x).toFixed(1)}`;

type Props = {
  data: AppData; drills: DrillDef[]; tallies: TallySession[]; games: Game[]; baseline: Baseline | null; pins: string[] | null; plan: PlanSettings;
  onBaseline: (b: Baseline) => Promise<void>; onPlan: (p: PlanSettings) => Promise<void>; onPins: (p: string[]) => Promise<void>;
  onOpenDrill: (id: string) => void; onGo: (t: Tab) => void;
};

export function PlanScreen(p: Props) {
  const { data, baseline, plan: settings } = p;
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(false); const t = setTimeout(() => setReady(true), 30); return () => clearTimeout(t); }, [data.exclusions]);
  const rows = useMemo(() => (ready ? rowsFor(data) : null), [ready, data.exclusions]);
  useEffect(() => { if (rows && !baseline && rows.length >= 50) p.onBaseline(fitBaseline(rows, latestStart(rows))); }, [rows, baseline]);
  const plan = useMemo(() => (rows && baseline ? buildPlan(baseline, rows, settings.period) : null), [rows, baseline, settings.period]);
  const pinList = useMemo(() => (rows && baseline ? p.pins ?? suggestedPins(baseline, rows) : []), [rows, baseline, p.pins]);

  const set = (patch: Partial<PlanSettings>) => p.onPlan({ ...settings, ...patch });
  if (!data.shots.size) return (
    <section>
      <h2>Practice plan</h2>
      <p class="lede">Stroke drills and tap drills work without any shot data. Import Railbird exports and the plan adds your weakest shots as targets.</p>
      <SessionSettings p={p} set={set} />
      <NextSession p={p} />
      <Empty onGo={p.onGo} />
    </section>
  );
  if (!plan) return <section><h2>Practice plan</h2><p class="muted">Ranking targets…</p></section>;

  const drillName = (id: string) => p.drills.find(d => d.id === id)?.name ?? id;
  const togglePin = (label: string) => p.onPins(pinList.includes(label) ? pinList.filter(x => x !== label) : [...pinList, label]);
  const toggleHidden = (label: string) => set({ hidden: settings.hidden.includes(label) ? settings.hidden.filter(x => x !== label) : [...settings.hidden, label] });

  return (
    <section>
      <h2>Practice plan</h2>
      <p class="lede">Your weakest shots, ranked by how many makes per 100 shots they cost you; strengths below.</p>

      <div class="controls">
        <label>Based on<select value={settings.period} onChange={e => set({ period: (e.target as HTMLSelectElement).value as PlanPeriod })}>
          {PLAN_PERIODS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
      </div>
      <p class="small muted" style={{ marginTop: '-4px' }}>
        {int(plan.shots)} kept shots from {plan.sessions} sessions{plan.from ? `, ${fmtDate(plan.from, { month: 'short', year: 'numeric' })} to ${fmtDate(plan.to)}` : ''}.
      </p>

      <SessionSettings p={p} set={set} />
      <NextSession p={p} />

      <div class="card">
        <h3 style={{ marginTop: 0 }}>Your plan notes</h3>
        <TextBox value={settings.general} placeholder="What this block of practice is for, what to watch, anything a coach said…" onSave={v => set({ general: v })} rows={3} />
      </div>

      <div class="card">
        <h3 style={{ marginTop: 0 }}>Targets</h3>
        {plan.targets.length ? plan.targets.map((t, i) => (
          <ItemCard key={t.label} item={t} rank={i + 1} settings={settings} pinned={pinList.includes(t.label)} hidden={settings.hidden.includes(t.label)}
            drillName={drillName} onOpenDrill={p.onOpenDrill} onText={v => set({ text: { ...settings.text, [t.label]: v } })}
            onPin={() => togglePin(t.label)} onHide={() => toggleHidden(t.label)} />
        )) : <p class="muted">No weaknesses stand out in this period.</p>}
        <p class="small muted">Segments overlap, so makes lost don't add up across targets. Established: the 95% range is below zero. Watch: at least 2 points below, range not clear yet.</p>
      </div>

      <div class="card">
        <h3 style={{ marginTop: 0 }}>Strengths to keep</h3>
        {plan.strengths.length ? plan.strengths.map(t => (
          <ItemCard key={t.label} item={t} settings={settings} pinned={pinList.includes(t.label)} drillName={drillName} onOpenDrill={p.onOpenDrill}
            onText={v => set({ text: { ...settings.text, [t.label]: v } })} onPin={() => togglePin(t.label)} />
        )) : <p class="muted">No strengths stand out in this period yet.</p>}
      </div>
    </section>
  );
}

function ItemCard({ item: t, rank, settings, pinned, hidden, drillName, onOpenDrill, onText, onPin, onHide }: {
  item: PlanItem; rank?: number; settings: PlanSettings; pinned: boolean; hidden?: boolean;
  drillName: (id: string) => string; onOpenDrill: (id: string) => void; onText: (v: string) => void; onPin: () => void; onHide?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const strength = t.perHundred < 0;
  const r = t.recent;
  return (
    <div class={`plan-item ${hidden ? 'is-hidden' : ''}`}>
      <div class="row" style={{ alignItems: 'baseline', gap: '8px', flexWrap: 'nowrap' }}>
        {rank != null && <span class="plan-rank num">{rank}</span>}
        <div class="grow" style={{ minWidth: 0 }}>
          <div class="block-title">{t.label}</div>
          <div class="small"><i class={`swatch ${TIER_CLASS[t.tier]}`} /> {t.tier}</div>
        </div>
        <div class="plan-cost num">
          <b>{Math.abs(t.perHundred).toFixed(1)}</b>
          <div class="small muted">{strength ? 'makes gained' : 'makes lost'} / 100</div>
        </div>
      </div>
      <div class="small num" style={{ marginTop: '6px' }}>
        {pts(t.stat.oe)} pts (range {pts(t.stat.lo)} to {pts(t.stat.hi)}) over {int(t.n)} shots, {pct(t.share)} of your shots · made {pct(t.stat.makeRate)}, expected {pct(t.stat.expRate)}.
        {r && <> Last 90 days: {pts(r.oe)} pts on {int(r.n)} shots.</>}
      </div>
      {t.overlap && <div class="small muted" style={{ marginTop: '4px' }}>{pct(t.overlap.frac)} of these shots are also “{t.overlap.label}”, so work on that one covers part of this.</div>}
      {settings.text[t.label]?.trim() && !open && <div class="small cue" style={{ marginTop: '6px' }}>“{settings.text[t.label].trim()}”</div>}
      <div class="row" style={{ gap: '6px', marginTop: '8px' }}>
        {t.drills.map(id => <button key={id} class="btn btn-s" onClick={() => onOpenDrill(id)}>{drillName(id)}</button>)}
        {!t.drills.length && <span class="small muted">No drill in the library for this yet.</span>}
      </div>
      <div class="row" style={{ gap: '6px', marginTop: '8px' }}>
        <button class="btn btn-s" onClick={() => setOpen(!open)}>{open ? 'Done' : settings.text[t.label]?.trim() ? 'Edit coaching text' : 'Add coaching text'}</button>
        <button class="btn btn-s" aria-pressed={pinned} onClick={onPin}>{pinned ? '✓ Tracked on Progress' : 'Track on Progress'}</button>
        {onHide && <button class="btn btn-s" onClick={onHide}>{hidden ? 'Bring back into sessions' : 'Leave out of sessions'}</button>}
      </div>
      {open && <div style={{ marginTop: '8px' }}><TextBox value={settings.text[t.label] ?? ''} placeholder="Your cues for this: what to feel, what to check before the shot…" onSave={onText} rows={3} /></div>}
    </div>
  );
}

/** Text area that saves when it loses focus (and on Ctrl+Enter). */
function TextBox({ value, placeholder, onSave, rows }: { value: string; placeholder: string; onSave: (v: string) => void; rows: number }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <textarea rows={rows} value={v} placeholder={placeholder}
      onInput={e => setV((e.target as HTMLTextAreaElement).value)}
      onBlur={() => { if (v !== value) onSave(v); }}
      onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSave(v); }} />
  );
}

/** How sessions are built: finishing drills vs keeping to time, and how often to film. */
function SessionSettings({ p, set }: { p: Props; set: (patch: Partial<PlanSettings>) => void }) {
  const s = p.plan;
  const f = filmingStatus(p);
  return (
    <div class="card">
      <h3 style={{ marginTop: 0 }}>How sessions run</h3>
      <div class="notice learn-note small" style={{ marginTop: 0 }}>{ADAPT_NOTE}</div>
      <div class="controls">
        <label>Tapped drills<select value={s.timing ?? 'finish'} onChange={e => set({ timing: (e.target as HTMLSelectElement).value as 'finish' | 'time' })}>
          <option value="finish">Finish each drill (time is a pace target)</option><option value="time">Keep to the time</option></select></label>
        <label>Film with Railbird<select value={String(s.filmPerWeek ?? 2)} onChange={e => set({ filmPerWeek: Number((e.target as HTMLSelectElement).value) })}>
          {[0, 1, 2, 3].map(n => <option key={n} value={n}>{n === 0 ? 'Never (tap only)' : `${n} session${n === 1 ? '' : 's'} a week`}</option>)}</select></label>
        <label>Filmed minutes<select value={String(s.filmMinutes ?? 30)} disabled={(s.filmPerWeek ?? 2) === 0} onChange={e => set({ filmMinutes: Number((e.target as HTMLSelectElement).value) })}>
          {[20, 30, 45].map(n => <option key={n} value={n}>{n} minutes</option>)}</select></label>
        <label>Session length<select value={String(s.minutes)} onChange={e => set({ minutes: Number((e.target as HTMLSelectElement).value) })}>
          {[30, 45, 60, 90, 120].map(m => <option key={m} value={m}>{m} minutes</option>)}</select></label>
      </div>
      <p class="small muted" style={{ margin: 0 }}>
        {(s.filmPerWeek ?? 2) === 0 ? 'All practice is tapped on the phone.' : `Filmed this week: ${f.done} of ${f.perWeek}. ${f.due ? `The next session films up to ${f.minutes} minutes with one Railbird recording and one tag; the rest is tapped.` : 'Done for the week: sessions are tap-only until Monday.'}`}
        {' '}With "Finish each drill", a soft chime marks the planned time and the block ends when the drill is done.
      </p>
      <RailbirdRole bare title="Why so little filming? How Railbird fits" />
    </div>
  );
}

function NextSession({ p }: { p: Props }) {
  const c = composeFor(p, 'planned');
  const drillName = (id: string) => p.drills.find(d => d.id === id)?.name ?? id;
  return (
    <div class="card">
      <h3 style={{ marginTop: 0 }}>Next session · {p.plan.minutes} minutes</h3>
      <ol class="blocks">
        {c.run.map((b, i) => (
          <li key={i}>
            <span class="block-min num">{b.minutes}′</span>
            <div class="grow">
              <div class="block-title">{b.title}</div>
              <div class="small muted">{b.why} · {MODE_LABEL[b.mode].toLowerCase()}{b.mode === 'tap' && b.end === 'count' && b.count ? `, until ${b.count} ${b.unit}` : ''}{estLabel(b) ? ` · minutes ${estLabel(b)}` : ''}</div>
              {b.label && p.plan.text[b.label]?.trim() && <div class="small cue">“{p.plan.text[b.label].trim()}”</div>}
              {b.drills.length > 0 && <div class="row" style={{ gap: '6px', marginTop: '6px' }}>
                {b.drills.map(id => <button key={id} class={`btn btn-s ${id === b.drillId ? 'primary' : ''}`} onClick={() => p.onOpenDrill(id)}>{drillName(id)}</button>)}
              </div>}
            </div>
          </li>
        ))}
      </ol>
      <div class="row" style={{ gap: '8px', marginTop: '12px' }}>
        <button class="btn primary" onClick={() => p.onGo('session')}>Start this session</button>
        <span class="small muted">You review the blocks first; Tournament warm-up and Stroke workout are there too.</span>
      </div>
      <p class="small muted" style={{ margin: '8px 0 0' }}>
        It opens with stroke drills chosen by your player stage and drill levels, then the top targets share the time by makes lost, and it closes with a run-out.
      </p>
    </div>
  );
}
