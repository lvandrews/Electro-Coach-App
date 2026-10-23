import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AppData } from '../app';
import { applyRoutineEdits, ROUTINE, type RoutineData, type RoutineEdits, type RoutineLink, type QuickStep } from '../engine/routine';
import { enoughForRate, type RoutineFacts } from '../engine/facts';
import { mphRange, REF_BANDS } from '../engine/speed';
import { factsFor } from './fitCache';
import { bandSentence, coverageNotes, useSpeedProfile } from './SpeedProfile';
import type { Tab } from './nav';
import { int, pct } from './format';
import { isNative } from '../platform';
import { getWidgetSize, requestWidgetPin, setWidgetSize, widgetPinInfo, type WidgetSize } from '../widget';

type Props = {
  data: AppData; edits: RoutineEdits | null; onEdits: (e: RoutineEdits | null) => Promise<void>;
  onGo: (t: Tab) => void; onGoFocus: (t: Tab, focus: string) => void; focus?: string | null;
};

const LINK: Record<RoutineLink, { label: string; tab: Tab; focus?: string }> = {
  plan: { label: 'Your practice targets', tab: 'plan' },
  progress: { label: 'Your progress', tab: 'progress' },
  table: { label: 'Table heat maps', tab: 'table' },
  predictor: { label: 'Shot predictor', tab: 'model', focus: 'predictor' },
  speed: { label: 'Your speed profile', tab: 'model', focus: 'speed-profile' },
};

export function RoutineScreen({ data, edits, onEdits, onGo, onGoFocus, focus }: Props) {
  const r = useMemo(() => applyRoutineEdits(ROUTINE, edits), [edits]);
  const [editQuick, setEditQuick] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <section>
      <h2>Pre-shot routine</h2>
      <p class="lede">The quick card is for between shots; the notes below hold the detail and your own numbers. The text is yours to edit.</p>
      <AddWidget compact />

      <div class="card routine-quick">
        <div class="row"><h3 style={{ margin: 0 }}>Quick card</h3><span class="spacer" /><button class="btn btn-s" onClick={() => setEditQuick(!editQuick)}>{editQuick ? 'Close' : 'Edit'}</button></div>
        {editQuick
          ? <QuickEditor steps={r.quick} onSave={async q => { await onEdits({ ...(edits ?? {}), quick: q }); setEditQuick(false); }} />
          : <ol class="quick-steps">{r.quick.map((s, i) => <li key={i}><b>{s.title}</b><span>{s.cue}</span></li>)}</ol>}
      </div>

      {r.sections.map(s => (
        <details key={s.id} id={`routine-${s.id}`} class="card routine-section" open={focus === s.id || undefined}>
          <summary>{s.title}</summary>
          {editing === s.id ? (
            <SectionEditor title={s.title} points={s.points} onCancel={() => setEditing(null)}
              onSave={async (title, points) => { await onEdits({ ...(edits ?? {}), sections: { ...(edits?.sections ?? {}), [s.id]: { title, points } } }); setEditing(null); }} />
          ) : <>
            <ul>{s.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
            {s.data && <YourNumbers kind={s.data} data={data} />}
            <div class="row" style={{ gap: '6px' }}>
              <button class="btn btn-s" onClick={() => setEditing(s.id)}>Edit</button>
              {(s.links ?? []).map(l => <button key={l} class="btn btn-s" onClick={() => (LINK[l].focus ? onGoFocus(LINK[l].tab, LINK[l].focus!) : onGo(LINK[l].tab))}>{LINK[l].label}</button>)}
            </div>
          </>}
        </details>
      ))}

      <WidgetCard edits={edits} />

      {edits && <p class="small muted">You have edited this reference. <button class="btn btn-s" onClick={() => onEdits(null)}>Restore the original draft</button></p>}
    </section>
  );
}

function QuickEditor({ steps, onSave }: { steps: QuickStep[]; onSave: (s: QuickStep[]) => void }) {
  const [v, setV] = useState(steps.map(s => `${s.title}: ${s.cue}`).join('\n'));
  return (
    <div style={{ marginTop: '10px' }}>
      <label class="field">One step per line, as “Title: cue”
        <textarea rows={8} value={v} onInput={e => setV((e.target as HTMLTextAreaElement).value)} />
      </label>
      <button class="btn primary" onClick={() => onSave(v.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const i = l.indexOf(':'); return i > 0 ? { title: l.slice(0, i).trim(), cue: l.slice(i + 1).trim() } : { title: l, cue: '' };
      }))}>Save</button>
    </div>
  );
}

function SectionEditor({ title, points, onSave, onCancel }: { title: string; points: string[]; onSave: (t: string, p: string[]) => void; onCancel: () => void }) {
  const [t, setT] = useState(title);
  const [v, setV] = useState(points.join('\n'));
  return (
    <div style={{ marginTop: '8px' }}>
      <label class="field">Heading<input type="text" value={t} onInput={e => setT((e.target as HTMLInputElement).value)} /></label>
      <label class="field">One point per line<textarea rows={8} value={v} onInput={e => setV((e.target as HTMLTextAreaElement).value)} /></label>
      <div class="row" style={{ gap: '8px' }}>
        <button class="btn primary" onClick={() => onSave(t.trim() || title, v.split('\n').map(l => l.trim()).filter(Boolean))}>Save</button>
        <button class="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ---------- your numbers beside the rules of thumb ----------

function useFacts(data: AppData): RoutineFacts | null {
  const [f, setF] = useState<RoutineFacts | null>(null);
  useEffect(() => { if (!data.shots.size) return; const t = setTimeout(() => setF(factsFor(data)), 40); return () => clearTimeout(t); }, [data.exclusions]);
  return f;
}

function YourNumbers({ kind, data }: { kind: RoutineData; data: AppData }) {
  if (!data.shots.size) return null;
  return kind === 'speed' ? <SpeedNumbers data={data} /> : <FactNumbers kind={kind} data={data} />;
}

function SpeedNumbers({ data }: { data: AppData }) {
  const prof = useSpeedProfile(data);
  if (!prof) return null;
  return (
    <div class="facts-box small">
      <div class="panel-title">Your numbers</div>
      <ul>
        {prof.bands.map(b => <li key={b.id}>{bandSentence(b)}{coverageNotes(b).map((t, i) => <span key={i} class="muted"> {t}</span>)}</li>)}
      </ul>
      <div class="muted" style={{ marginTop: '4px' }}>Reference: easy {REF_BANDS.easy.text}, firm {REF_BANDS.firm.text}, hard {REF_BANDS.hard.text}.{prof.bands.find(b => b.id === 'medium')?.sweet ? ` Your medium-distance sweet spot: ${mphRange(prof.bands.find(b => b.id === 'medium')!.sweet!)} mph.` : ''}</div>
    </div>
  );
}

function FactNumbers({ kind, data }: { kind: 'selection' | 'tables'; data: AppData }) {
  const f = useFacts(data);
  if (!f) return null;
  const ty = f.typical;
  const ft = (inches: number) => `${(inches / 12).toFixed(1)} ft`;
  const pts = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(100 * x).toFixed(1)}`;
  if (kind === 'tables') {
    if (f.tables.length < 2) return <div class="facts-box small"><div class="panel-title">Your numbers</div><div class="muted">Only one table size in your data so far.</div></div>;
    return (
      <div class="facts-box small">
        <div class="panel-title">Your numbers</div>
        <ul>{f.tables.map(t => <li key={t.size}>{t.size === '7ft' ? '7-ft' : '9-ft'} tables: {pts(t.oe)} pts against the shot model (range {pts(t.lo)} to {pts(t.hi)}), {int(t.n)} shots in {t.sessions} sessions.</li>)}</ul>
        <div class="muted" style={{ marginTop: '4px' }}>Above zero means you make more than the model expects for shots of that geometry on that size of table. A range that includes zero is not a clear difference.</div>
      </div>
    );
  }
  return (
    <div class="facts-box small">
      <div class="panel-title">Your numbers</div>
      <p style={{ margin: '0 0 6px' }}>
        Start from your typical shot: object ball <b>{ft(ty.objPktIn)}</b> from the pocket, cue ball <b>{ft(ty.cueObjIn)}</b> from the object ball,
        a <b>{Math.round(ty.cutDeg)}°</b> cut at <b>{ty.mph.toFixed(1)} mph</b>. You make that about <b>{pct(f.typicalP)}</b> of the time.
        Each row changes one thing and keeps the rest of that shot the same; the highlighted column is your typical shot.
      </p>
      <OneFactor title="Object ball distance to the pocket" pts={f.objDist} unit=" ft" here={{ at: +(ty.objPktIn / 12).toFixed(1), p: f.typicalP }} />
      <OneFactor title="Cue ball distance to the object ball" pts={f.cueDist} unit=" ft" here={{ at: +(ty.cueObjIn / 12).toFixed(1), p: f.typicalP }} />
      <OneFactor title="Cut angle" pts={f.cut} unit="°" here={{ at: Math.round(ty.cutDeg), p: f.typicalP }} />
      <div class="panel-title" style={{ marginTop: '8px' }}>Side pockets: what you actually made, by approach angle</div>
      <table class="factor-table"><tbody>
        <tr>{f.side.map(b => <th key={b.label}>{b.label}</th>)}</tr>
        <tr>{f.side.map(b => <td key={b.label} class="num">{enoughForRate(b) ? pct(b.rate) : '—'}</td>)}</tr>
        <tr class="muted">{f.side.map(b => <td key={b.label} class="num">{int(b.n)} shots</td>)}</tr>
      </tbody></table>
      <div class="muted" style={{ marginTop: '6px' }}>The distance and cut rows come from the shot model; values with fewer than 30 of your shots nearby are left out. The side-pocket row is your raw make rate (— under 30 shots).</div>
    </div>
  );
}

function OneFactor({ title, pts, unit, here }: { title: string; pts: { at: number; p: number; n: number }[]; unit: string; here: { at: number; p: number } }) {
  // The grid points with enough of your shots nearby, plus your typical value (highlighted).
  const span = Math.max(...pts.map(q => q.at)) - Math.min(...pts.map(q => q.at));
  const shown = [...pts.filter(q => q.n >= 30 && Math.abs(q.at - here.at) > span * 0.04), { ...here, n: Infinity, typical: true }]
    .sort((a, b) => a.at - b.at) as ({ at: number; p: number; typical?: boolean })[];
  return (
    <>
      <div class="panel-title" style={{ marginTop: '8px' }}>{title}</div>
      <table class="factor-table"><tbody>
        <tr>{shown.map(q => <th key={q.at} class={q.typical ? 'here' : ''}>{q.at}{unit}</th>)}</tr>
        <tr>{shown.map(q => <td key={q.at} class={`num ${q.typical ? 'here' : ''}`}>{pct(q.p)}</td>)}</tr>
      </tbody></table>
    </>
  );
}

/** The home-screen widget: how to add it, and its text size (the phone's own size by default). */
/**
 * Add to home screen: asks the launcher to place the widget (it shows its own confirmation).
 * Compact form sits at the top of the page and only appears until a widget is placed.
 */
function AddWidget({ compact }: { compact?: boolean }) {
  const [info, setInfo] = useState<{ supported: boolean; placed: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const check = () => { void widgetPinInfo().then(setInfo); };
  useEffect(() => {
    if (!isNative()) return;
    check();
    const v = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', v);
    return () => document.removeEventListener('visibilitychange', v);
  }, []);
  if (!isNative() || !info) return null;
  const manual = 'Touch and hold an empty spot on your home screen, choose Widgets, find Electro-Coach and drag the Pre-shot routine widget into place.';
  const add = async () => {
    const ok = await requestWidgetPin();
    setMsg(ok ? 'Your phone will ask to confirm: tap Add (or drag it where you want it).' : `Your home screen doesn't allow adding it from here. ${manual}`);
    setTimeout(check, 4000);
  };
  if (compact) {
    // Once a widget is placed: a quiet line instead of the prompt, still with a way to add one.
    if (info.placed > 0) return (
      <p class="small add-widget-done" style={{ margin: '0 0 10px' }}>
        <span style={{ color: 'var(--good)' }}>✓ This routine is on your home screen.</span>{' '}
        <button class="link-btn" onClick={() => document.getElementById('routine-widget')?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>Widget settings</button>
      </p>
    );
    return (
      <div class="notice row add-widget" style={{ alignItems: 'center' }}>
        <span class="grow small">Keep this routine one glance away with the home-screen widget.</span>
        <button class="btn btn-s primary" onClick={info.supported ? add : () => setMsg(manual)}>Add to home screen</button>
        {msg && <p class="small" style={{ margin: '4px 0 0', flexBasis: '100%' }}>{msg}</p>}
      </div>
    );
  }
  return (
    <div style={{ margin: '0 0 10px' }}>
      {info.placed > 0 && <p class="small" style={{ margin: '0 0 6px', color: 'var(--good)' }}>✓ On your home screen{info.placed > 1 ? ` (${info.placed} widgets)` : ''}.</p>}
      {info.supported
        ? <button class="btn primary" onClick={add}>{info.placed > 0 ? 'Add another' : 'Add to home screen'}</button>
        : <p class="small" style={{ margin: 0 }}>{manual}</p>}
      {msg && <p class="small" style={{ margin: '6px 0 0' }}>{msg}</p>}
      {info.supported && !msg && <p class="small muted" style={{ margin: '6px 0 0' }}>Or add it yourself: {manual.charAt(0).toLowerCase() + manual.slice(1)}</p>}
    </div>
  );
}

function WidgetCard({ edits }: { edits: RoutineEdits | null }) {
  const [size, setSize] = useState<WidgetSize>(getWidgetSize());
  return (
    <div class="card" id="routine-widget">
      <h3 style={{ marginTop: 0 }}>On your home screen</h3>
      {isNative() ? <>
        <p class="small" style={{ marginTop: 0 }}>The <b>Pre-shot routine</b> widget shows the quick card, then scrolls to the full notes, and updates whenever you edit them here. Tap it to open this page.</p>
        <AddWidget />
        <div class="row" style={{ gap: '8px', alignItems: 'center' }}>
          <span class="small">Widget text</span>
          <div class="seg" role="group" aria-label="Widget text size">
            {(['normal', 'large', 'xlarge'] as WidgetSize[]).map(k => <button key={k} aria-pressed={size === k} onClick={() => { setSize(k); setWidgetSize(k, edits); }}>{k === 'normal' ? 'Normal' : k === 'large' ? 'Large' : 'Extra large'}</button>)}
          </div>
        </div>
        <p class="small muted" style={{ margin: '6px 0 0' }}>Normal follows your phone's text size setting; Large and Extra large go bigger still.</p>
      </> : <p class="small muted" style={{ margin: 0 }}>The Android app has a home-screen widget with this routine. iPhone home-screen web apps can't have widgets.</p>}
    </div>
  );
}
