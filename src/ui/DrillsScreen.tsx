import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AppData, Tab } from '../app';
import {
  BUILTIN_DRILLS, CATEGORY_HINT, CATEGORY_LABEL, layoutSnippet, matchDrill, newTransitionsDrill,
  type DiagramBall, type DiagramSpec, type DrillCategory, type DrillDef,
} from '../engine/drills';
import { captureCheck, completionSummary, diagnosticCounts, localDate, makeTallyFile, parseTallyFile, type CaptureRow, type TallySession } from '../engine/tally';
import { TABLE, snapTo } from '../engine/table';
import { saveTextFile } from '../platform';
import { DiagramKey, TableDiagram } from './TableDiagram';
import { fmtDate, fmtTime, int, pct, plural } from './format';
import { requiredMakes, summarize, verdictOf, type LevelState, type Thresholds } from '../engine/progressive';
import { drillLevel, getHand, getOverride, getThresholds, onProgPrefs, setHand, setLevel, setThresholds } from './progPrefs';
import { levelDiagram } from './ProgressiveTally';

export interface DrillsProps {
  data: AppData;
  drills: DrillDef[];
  tallies: TallySession[];
  device: string;
  activeTallyId: string | null;
  onStartTally: (d: DrillDef) => void;
  onResumeTally: () => void;
  onSaveLayout: (drillId: string, spec: DiagramSpec | null) => Promise<void>;
  onSaveCustom: (d: DrillDef) => Promise<void>;
  onDeleteCustom: (id: string) => Promise<void>;
  onDeleteTally: (id: string) => Promise<void>;
  onImportTallies: (ts: TallySession[]) => Promise<{ added: number; updated: number; unchanged: number }>;
  onGo: (t: Tab) => void;
  openId: string | null;
  onOpen: (id: string | null) => void;
  onOpenScorer: () => void;
}

const ORDER: DrillCategory[] = ['stroke', 'transitions', 'runout', 'reps', 'calibration'];

interface DrillSession { sessionId: number; start: string; shots: number; kept: number; makes: number }

export function DrillsScreen(p: DrillsProps) {
  const openId = p.openId, setOpenId = p.onOpen;

  // Railbird sessions per drill, from stored shots
  const byDrill = useMemo(() => {
    const m = new Map<string, Map<number, DrillSession>>();
    for (const s of p.data.shotList) {
      const d = matchDrill(p.drills, s.tags, s.gameTypes, s.sessionName);
      if (!d) continue;
      const sm = m.get(d.id) ?? m.set(d.id, new Map()).get(d.id)!;
      const r = sm.get(s.sessionId) ?? sm.set(s.sessionId, { sessionId: s.sessionId, start: s.sessionStart, shots: 0, kept: 0, makes: 0 }).get(s.sessionId)!;
      r.shots++;
      if (!p.data.exclusions.has(s.shotId)) { r.kept++; if (s.make) r.makes++; }
    }
    const out = new Map<string, DrillSession[]>();
    for (const [k, v] of m) out.set(k, [...v.values()].sort((a, b) => (a.start < b.start ? 1 : -1)));
    return out;
  }, [p.data.shotList, p.data.exclusions, p.drills]);

  const capture = useMemo(() => captureCheck(p.tallies, p.data.shotList, p.data.exclusions, p.drills), [p.tallies, p.data, p.drills]);

  const open = p.drills.find(d => d.id === openId);
  if (open) return <DrillDetail {...p} drill={open} sessions={byDrill.get(open.id) ?? []} capture={capture} onBack={() => setOpenId(null)} />;

  const active = p.tallies.find(t => t.id === p.activeTallyId);

  return (
    <section>
      <h2>Drills</h2>
      <p class="lede">Set up from the diagram and tap each shot on the phone. Drills Railbird can film have a tag to copy; stroke drills adjust their level from your results.</p>
      {active && (
        <div class="notice good row" style={{ alignItems: 'center' }}>
          <span>{active.drillName} tally in progress ({plural(active.events.length, 'tap')}).</span>
          <span class="spacer" /><button class="btn primary" onClick={p.onResumeTally}>Return to tally</button>
        </div>
      )}

      {ORDER.map(cat => {
        const list = p.drills.filter(d => d.category === cat);
        return (
          <div key={cat} class="drill-group">
            <div class="row" style={{ alignItems: 'baseline' }}>
              <h3 style={{ margin: 0 }}>{CATEGORY_LABEL[cat]}</h3>
              <span class="small muted">{CATEGORY_HINT[cat]}</span>
            </div>
            <div class="drill-list">
              {list.map(d => {
                const ss = byDrill.get(d.id) ?? [];
                const ts = p.tallies.filter(t => t.drillId === d.id);
                const lastIso = [ss[0]?.start, ts[0]?.started].filter(Boolean).sort().pop();
                return (
                  <button key={d.id} class="drill-card" onClick={() => setOpenId(d.id)}>
                    <TableDiagram spec={d.prog ? levelDiagram(d.prog, drillLevel(d, p.tallies).level) : d.diagram} title={`${d.name} layout`} showLabels={false} />
                    <div class="drill-card-text">
                      <div class="drill-name">{d.name}{d.short && <span class="type">{d.short}</span>}</div>
                      <div class="small muted">
                        {d.railbirdBuiltIn ? 'Railbird drill mode' : d.tags.map(t => t.value).join(', ')}
                      </div>
                      <div class="small">
                        {d.counters === 'completion' ? 'Tap per rack' : d.counters === 'diagnostic' ? 'Tap per shot' : d.counters === 'progressive' ? `Tap per shot${d.prog?.progressive ? ` · Level ${drillLevel(d, p.tallies).level}` : ''}` : 'No taps'}
                        {' · '}{lastIso ? `last ${fmtDate(lastIso, { day: 'numeric', month: 'short' })}` : 'not recorded yet'}
                      </div>
                    </div>
                  </button>
                );
              })}
              {cat === 'transitions' && (
                <button class="drill-card add" onClick={async () => { const d = newTransitionsDrill(p.drills); await p.onSaveCustom(d); setOpenId(d.id); }}>
                  <span class="add-plus" aria-hidden="true">+</span>
                  <div class="drill-card-text"><div class="drill-name">New transitions drill</div><div class="small muted">Place the balls, name it, and it gets its own tag.</div></div>
                </button>
              )}
            </div>
          </div>
        );
      })}

      <div class="notice request-drill row" style={{ alignItems: 'center' }}>
        <span class="grow small"><b>Want a drill added?</b> Find it on poolbilliards.co and send the link. Requests are welcome.</span>
        <button class="btn btn-s primary" onClick={() => p.onGo('feedback')}>Request a drill</button>
      </div>

      <Transfer {...p} />
    </section>
  );
}

// ---------- tag chip with copy ----------

function CopyTag({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState<'ok' | 'fail' | null>(null);
  const ref = useRef<HTMLElement>(null);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone('ok'); }
    catch {
      const r = document.createRange(); if (ref.current) { r.selectNodeContents(ref.current); const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(r); }
      setDone('fail');
    }
    setTimeout(() => setDone(null), 1800);
  };
  return (
    <span class="tag-chip">
      {label && <span class="muted small">{label}</span>}
      <code ref={ref}>{value}</code>
      <button class="btn btn-s" onClick={copy}>{done === 'ok' ? 'Copied' : done === 'fail' ? 'Selected — copy it' : 'Copy'}</button>
    </span>
  );
}

// ---------- detail ----------

interface DetailProps extends DrillsProps { drill: DrillDef; sessions: DrillSession[]; capture: CaptureRow[]; onBack: () => void }

function DrillDetail(p: DetailProps) {
  const d = p.drill;
  const [editing, setEditing] = useState(false);
  const [, bump] = useState(0);
  useEffect(() => onProgPrefs(() => bump(v => v + 1)), []);
  const tallies = p.tallies.filter(t => t.drillId === d.id);
  const lvl = d.prog ? drillLevel(d, p.tallies) : null;
  const [view, setView] = useState<number | null>(null);
  const shown = d.prog ? levelDiagram(d.prog, view ?? lvl!.level) : d.diagram;
  const pathKinds = [...new Set((shown?.paths ?? []).map(x => x.kind))];

  return (
    <section>
      <button class="btn btn-s" onClick={p.onBack}>Back to drills</button>
      <h2 style={{ marginTop: '10px' }}>{d.name}</h2>
      <p class="small muted" style={{ marginTop: 0 }}>{CATEGORY_LABEL[d.category]}{d.short ? ` · ${d.short}` : ''}</p>

      <div class="drill-detail">
        <div class="drill-figure">
          {editing
            ? <LayoutEditor drill={d} onCancel={() => setEditing(false)} onSave={async spec => { await p.onSaveLayout(d.id, spec); setEditing(false); }} />
            : <>
                {d.prog && d.prog.levels.length > 1 && <div class="seg" role="group" aria-label="Show level" style={{ marginBottom: '6px' }}>
                  {d.prog.levels.map((l, i) => <button key={i} aria-pressed={(view ?? lvl!.level) === i + 1} onClick={() => setView(i + 1)}>{l.label}</button>)}
                </div>}
                <TableDiagram spec={shown} title={`${d.name} layout`} maxWidth={340} />
                {d.prog && <p class="small" style={{ margin: '4px 0' }}>{d.prog.levels[(view ?? lvl!.level) - 1]?.cue}</p>}
                <DiagramKey kinds={pathKinds} />
                <div class="row">
                  {d.editableLayout && <button class="btn btn-s" onClick={() => setEditing(true)}>{d.diagram ? 'Edit layout' : 'Set the layout'}</button>}
                  {d.diagram && !d.prog && <CopyLayout id={d.id} spec={d.diagram} />}
                </div>
              </>}
        </div>

        <div class="drill-text">
          {d.prog && <LevelPanel drill={d} tallies={tallies} state={lvl!} />}
          <div class="panel-title" style={{ marginTop: d.prog ? undefined : 0 }}>Railbird tag</div>
          {d.counters === 'progressive' && !d.railbirdBuiltIn && <p class="small muted" style={{ margin: '0 0 4px' }}>Only needed on days you film it; the taps are the record.</p>}
          {d.railbirdBuiltIn
            ? <p style={{ margin: '2px 0 8px' }}>Use Railbird's built-in drill mode (<code>{d.railbirdBuiltIn}</code>). No tag needed.</p>
            : <div class="tag-list">{d.tags.map(t => <CopyTag key={t.value} value={t.value} label={t.label} />)}</div>}
          {d.aliases.length > 0 && <p class="small muted" style={{ margin: '4px 0 0' }}>Older sessions tagged {d.aliases.slice(0, 2).map(a => `“${a}”`).join(' or ')} also count.</p>}

          {d.learning && <div class="notice learn-note">
            <b>Learning stage.</b> {d.learning}
            {d.counters === 'completion' && <div class="small muted" style={{ marginTop: '4px' }}>Until then, turn on <b>Learning mode (ball in hand)</b> on the tally: those racks are kept but stay out of the stats.</div>}
          </div>}
          <div class="panel-title">Set-up</div>
          <ul class="setup">{d.setup.map((s, i) => <li key={i}>{s}</li>)}</ul>
          {(d.diagram?.notes ?? []).map((n, i) => <p key={i} class="small muted" style={{ margin: '4px 0' }}>{n}</p>)}
          {d.target && <><div class="panel-title">How much</div><p style={{ margin: '2px 0' }}>{d.target.text}</p></>}

          {d.custom && <CustomFields {...p} />}

          {d.scorer && <div style={{ marginTop: '14px' }}><button class="btn primary" onClick={() => p.onOpenScorer()}>Open the scorer</button></div>}
          {d.counters !== 'none' && (
            <div style={{ marginTop: '14px' }}>
              {p.activeTallyId && p.tallies.find(t => t.id === p.activeTallyId)?.drillId === d.id
                ? <button class="btn primary" onClick={p.onResumeTally}>Return to tally</button>
                : <button class="btn primary" disabled={!!p.activeTallyId} onClick={() => p.onStartTally(d)}>{d.counters === 'progressive' ? 'Start a set' : 'Start tally'}</button>}
              {p.activeTallyId && p.tallies.find(t => t.id === p.activeTallyId)?.drillId !== d.id && <span class="small muted"> Finish the other tally first.</span>}
            </div>
          )}
        </div>
      </div>

      {d.counters === 'completion' && tallies.some(t => t.events.length) && <RackEnds drill={d} tallies={tallies} />}
      {tallies.length > 0 && <TallyHistory {...p} tallies={tallies} />}

      <div class="card" style={{ marginTop: '14px' }}>
        <h3>Railbird sessions</h3>
        {p.sessions.length === 0
          ? <p class="muted small" style={{ margin: 0 }}>None imported yet. Sessions show up here when they carry this drill's tag{d.railbirdBuiltIn ? ' or drill mode' : ''}.</p>
          : <div class="scroll-x"><table>
              <thead><tr><th>Date</th><th class="n">Shots</th><th class="n">Kept</th><th class="n">Made</th></tr></thead>
              <tbody>{p.sessions.slice(0, 12).map(s => (
                <tr key={s.sessionId}><td>{fmtDate(s.start, { day: 'numeric', month: 'short', year: 'numeric' })}</td><td class="n">{int(s.shots)}</td><td class="n">{int(s.kept)}</td><td class="n">{pct(s.kept ? s.makes / s.kept : null)}</td></tr>
              ))}</tbody>
            </table></div>}
        {p.sessions.length > 12 && <p class="small muted">Showing the latest 12 of {p.sessions.length}.</p>}
      </div>
    </section>
  );
}

function CustomFields(p: DetailProps) {
  const d = p.drill;
  const [name, setName] = useState(d.name);
  const [desc, setDesc] = useState(d.setup.join('\n'));
  const [armDel, setArmDel] = useState(false);
  const dirty = name !== d.name || desc !== d.setup.join('\n');
  return (
    <div class="card flat" style={{ marginTop: '12px' }}>
      <label class="field">Name<input id={`dn-${d.id}`} type="text" value={name} onInput={e => setName((e.target as HTMLInputElement).value)} /></label>
      <label class="field">Description<textarea id={`dd-${d.id}`} rows={3} value={desc} onInput={e => setDesc((e.target as HTMLTextAreaElement).value)} /></label>
      <div class="row">
        <button class="btn" disabled={!dirty} onClick={() => p.onSaveCustom({ ...d, name: name.trim() || d.name, setup: desc.split('\n').map(s => s.trim()).filter(Boolean) })}>Save</button>
        <button class="btn danger" onClick={async () => { if (!armDel) { setArmDel(true); return; } await p.onDeleteCustom(d.id); p.onBack(); }}>{armDel ? 'Tap again to delete' : 'Delete drill'}</button>
      </div>
    </div>
  );
}

function TallyHistory(p: DetailProps & { tallies: TallySession[] }) {
  const d = p.drill;
  const [arm, setArm] = useState<string | null>(null);
  return (
    <div class="card" style={{ marginTop: '14px' }}>
      <h3>Your tallies</h3>
      {p.tallies.map(t => {
        const cap = p.capture.find(c => c.tallyId === t.id);
        const live = t.id === p.activeTallyId;
        return (
          <div key={t.id} class="tally-row">
            <div class="row" style={{ alignItems: 'baseline' }}>
              <b>{fmtDate(t.started, { weekday: 'short', day: 'numeric', month: 'short' })} {fmtTime(t.started)}</b>
              <span class="small muted">{t.device}{live ? ' · in progress' : ''}</span>
              <span class="spacer" />
              {!live && <button class="btn btn-s danger" onClick={async () => { if (arm !== t.id) { setArm(t.id); return; } await p.onDeleteTally(t.id); setArm(null); }}>{arm === t.id ? 'Tap again to delete' : 'Delete'}</button>}
            </div>
            <TallySummary drill={d} t={t} />
            {t.note && <p class="small" style={{ margin: '4px 0' }}>Note: {t.note}</p>}
            {cap && <CaptureLine c={cap} />}
          </div>
        );
      })}
    </div>
  );
}

function RackEnds({ drill, tallies }: { drill: DrillDef; tallies: TallySession[] }) {
  const c = completionSummary(tallies, drill.ballsPerRack ?? 9);
  if (!c.racks) return null;
  const max = Math.max(1, ...c.ends.map(e => e.missed + e.outOfLine + e.unknown));
  return (
    <div class="card" style={{ marginTop: '14px' }}>
      <h3>Where racks end</h3>
      <p class="small muted" style={{ marginTop: 0 }}>
        All {plural(c.racks, 'rack')} tallied: ran out {c.completed} ({pct(c.completed / c.racks)}), {c.ballsPerRack.toFixed(1)} balls per rack{c.learning > 0 && <>; {plural(c.learning, 'learning rack')} left out</>}.
        A miss on a ball points at the shot; out of line points at the transition into it.
      </p>
      <div class="legend small" style={{ margin: '0 0 6px' }}>
        <span><i class="swatch" style={{ background: 'var(--warn)' }} />Missed</span>
        <span><i class="swatch" style={{ background: 'var(--ink-2)', opacity: 0.55 }} />Out of line</span>
      </div>
      <table class="ends-table tally-table compact">
        <thead><tr><th>Ball</th><th class="n">Missed</th><th class="n">Out of line</th>{c.endedAt.length > 0 && <th class="n">No reason</th>}<th /></tr></thead>
        <tbody>
          {c.ends.map(e => (
            <tr key={e.ball}>
              <td>{e.ball}</td><td class="n">{e.missed || ''}</td><td class="n">{e.outOfLine || ''}</td>
              {c.endedAt.length > 0 && <td class="n">{e.unknown || ''}</td>}
              <td class="bar"><div class="ends-bar">
                {e.missed > 0 && <span class="m" style={{ width: `${(100 * e.missed) / max}%` }} />}
                {e.outOfLine > 0 && <span class="l" style={{ width: `${(100 * e.outOfLine) / max}%` }} />}
              </div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TallySummary({ drill, t }: { drill: DrillDef; t: TallySession }) {
  if (drill.prog) {
    const sm = summarize(drill.prog, t);
    const m = sm.misses;
    return (
      <p class="num" style={{ margin: '4px 0' }}>
        {drill.prog.progressive && <>Level {t.level ?? 1} · </>}{t.variant && <>{drill.prog.variants?.find(v => v.id === t.variant)?.label ?? t.variant} · </>}{sm.makes} of {sm.attempts} made ({pct(sm.makePct)}){!drill.prog.noQuality && <>, quality {pct(sm.qualityPct)}</>}
        {sm.best > 0 && <>, {sm.best} {drill.prog.bestLabel ?? 'best'}</>}
        {!sm.complete && <> · unfinished ({sm.makes} of {requiredMakes(drill.prog, t.target)} makes)</>}
        {(m.L + m.R + m.thick + m.thin) > 0 && <> · misses {drill.prog.missKind === 'lr' ? `${m.L} left, ${m.R} right` : `${m.thick} thick, ${m.thin} thin`}</>}
        {(sm.drift.L + sm.drift.R) > 0 && <> · drift {sm.drift.L}L {sm.drift.R}R</>}
        {(sm.spin.L + sm.spin.R) > 0 && <> · spin {sm.spin.L}L {sm.spin.R}R</>}
        {(sm.rail.L + sm.rail.R) > 0 && <> · rail {sm.rail.L}L {sm.rail.R}R</>}
      </p>
    );
  }
  if (drill.counters === 'completion') {
    const c = completionSummary(t, drill.ballsPerRack ?? 9);
    const parts = [
      c.missedAt.length > 0 && `missed the ${c.missedAt.join(', ')}`,
      c.outOfLineAt.length > 0 && `out of line on the ${c.outOfLineAt.join(', ')}`,
      c.endedAt.length > 0 && `ended at ${c.endedAt.join(', ')} (no reason recorded)`,
    ].filter(Boolean);
    return (
      <p class="num" style={{ margin: '4px 0' }}>
        Ran out {c.completed} of {plural(c.racks, 'rack')}{c.racks > 0 && <>, {c.ballsPerRack.toFixed(1)} balls per rack</>}
        {parts.length > 0 && <>; {parts.join('; ')}</>}{c.learning > 0 && <>; plus {plural(c.learning, 'learning rack')} (ball in hand, not counted)</>}.
      </p>
    );
  }
  const counts = diagnosticCounts(t);
  return (
    <div class="scroll-x">
      <table class="tally-table compact">
        <thead><tr><th>Block</th><th>Side</th><th class="n">Make</th><th class="n">Thick</th><th class="n">Thin</th>{drill.blocks?.some(b => b.keys.includes('rail')) && <><th class="n">Rail</th><th class="n">Pocket</th></>}</tr></thead>
        <tbody>
          {Object.entries(counts).flatMap(([b, bySide]) => (['L', 'R'] as const).filter(s => bySide[s].make + bySide[s].thick + bySide[s].thin + bySide[s].rail + bySide[s].pocket > 0).map(s => (
            <tr key={b + s}>
              <td>{drill.blocks?.find(x => x.id === b)?.name ?? b}</td><td>{s === 'L' ? 'Left' : 'Right'}</td>
              <td class="n">{bySide[s].make}</td><td class="n">{bySide[s].thick}</td><td class="n">{bySide[s].thin}</td>
              {drill.blocks?.some(x => x.keys.includes('rail')) && <><td class="n">{bySide[s].rail}</td><td class="n">{bySide[s].pocket}</td></>}
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}

export function CaptureLine({ c }: { c: CaptureRow }) {
  if (!c.railbirdSessions.length)
    return <p class="small muted" style={{ margin: '4px 0 0' }}>No Railbird session for this drill on {fmtDate(c.date + 'T12:00:00')} yet. Import the export to compare.</p>;
  const side = (x?: { tapped: number; recorded: number; capture: number | null }) => x && x.tapped ? `${x.recorded} of ${x.tapped} (${pct(x.capture)})` : '—';
  return (
    <p class="small capture" style={{ margin: '4px 0 0' }}>
      Railbird recorded {int(c.recorded.makes)} of your {int(c.tapped.makes)} tapped makes ({pct(c.capture)} captured)
      {c.bySide && <>: left {side(c.bySide.L)}, right {side(c.bySide.R)}</>}.
      {c.capture != null && c.capture < 0.9 && <> The tally is the main record for this session.</>}
    </p>
  );
}

function CopyLayout({ id, spec }: { id: string; spec: DiagramSpec }) {
  const [shown, setShown] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const copy = async () => {
    const text = layoutSnippet(id, spec);
    try { await navigator.clipboard.writeText(text); setMsg('Layout copied.'); setShown(null); }
    catch { setShown(text); setMsg('Select all the text below and copy it.'); }
    setTimeout(() => setMsg(null), 3000);
  };
  return (
    <>
      <button class="btn btn-s" onClick={copy}>Copy layout</button>
      {msg && <span class="small" role="status">{msg}</span>}
      {shown && <textarea class="mono" rows={4} readOnly value={shown} onFocus={e => (e.target as HTMLTextAreaElement).select()} />}
    </>
  );
}

// ---------- layout editor ----------

function LayoutEditor({ drill, onSave, onCancel }: { drill: DrillDef; onSave: (s: DiagramSpec | null) => void; onCancel: () => void }) {
  const numbered = drill.category === 'transitions';
  const [balls, setBalls] = useState<DiagramBall[]>(drill.diagram?.balls ?? []);
  const [tool, setTool] = useState<string>('cb');
  const [snap, setSnap] = useState(true);
  const [lastSnap, setLastSnap] = useState<string | null>(null);
  const tools = ['cb', ...(numbered ? Array.from({ length: drill.ballsPerRack ?? 9 }, (_, i) => String(i + 1)) : ['ob']), 'erase'];
  const label = (t: string) => (t === 'cb' ? 'Cue ball' : t === 'ob' ? 'Object ball' : t === 'erase' ? 'Remove' : t);

  const tap = (x: number, y: number) => {
    const near = balls.findIndex(b => Math.hypot(b.x - x, b.y - y) < 2.8);
    if (tool === 'erase') { if (near >= 0) setBalls(balls.filter((_, i) => i !== near)); return; }
    const r = (v: number) => Math.round(v * 4) / 4;   // quarter-inch grid
    const sp = snap ? snapTo(x, y) : null;
    if (sp) { x = sp.at[0]; y = sp.at[1]; }
    setLastSnap(sp ? sp.label : null);
    const q = (v: number) => (sp ? Math.round(v * 1000) / 1000 : r(v));
    const ball: DiagramBall = tool === 'cb' ? { kind: 'cb', x: q(x), y: q(y) } : tool === 'ob' ? { kind: 'ob', x: q(x), y: q(y) } : { kind: 'ob', x: q(x), y: q(y), num: Number(tool) };
    let next = balls.filter(b => !(tool === 'cb' ? b.kind === 'cb' : tool !== 'ob' && b.num === Number(tool)));
    if (tool === 'ob' && near >= 0) next = next.filter((_, i) => i !== near);   // tap an object ball again to move it off
    setBalls([...next, ball]);
    // numbered drills: step to the next ball automatically
    if (numbered && tool !== 'cb') { const n = Number(tool); if (n < (drill.ballsPerRack ?? 9)) setTool(String(n + 1)); }
    else if (numbered && tool === 'cb' && !balls.some(b => b.num === 1)) setTool('1');
  };

  return (
    <div class="layout-editor">
      <p class="small" style={{ margin: '0 0 6px' }}>Pick a ball, then tap the table where it goes. {numbered && 'Numbers advance after each tap.'}</p>
      <div class="chips" role="group" aria-label="Ball to place">
        {tools.map(t => <button key={t} aria-pressed={tool === t} onClick={() => setTool(t)}>{label(t)}</button>)}
      </div>
      <TableDiagram spec={{ balls, paths: [] }} title="Layout editor" maxWidth={340} onTap={tap} sequence={numbered} />
      <label class="small switch-row"><input type="checkbox" checked={snap} onChange={() => setSnap(!snap)} />
        Snap to the spots and to diamonds (frozen, or one ball off the rail)</label>
      <p class="small muted num" style={{ margin: '4px 0' }}>
        {balls.length} balls placed{lastSnap ? `; last one snapped to ${lastSnap}` : ''}. Table {TABLE.w}″ × {TABLE.h}″, head rail at the top.
      </p>
      <div class="row">
        <button class="btn primary" onClick={() => onSave(balls.length ? { balls, paths: [], notes: drill.diagram?.notes } : null)}>Save layout</button>
        <button class="btn" onClick={onCancel}>Cancel</button>
        <button class="btn" onClick={() => setBalls([])}>Clear</button>
        {drill.diagram && !drill.custom && (BUILTIN_DRILLS.find(b => b.id === drill.id)?.diagram
          ? <button class="btn" onClick={() => onSave(null)}>Restore default layout</button>
          : <button class="btn" onClick={() => onSave(null)}>Remove saved layout</button>)}
      </div>
    </div>
  );
}

// ---------- moving tallies between devices ----------

function Transfer(p: DrillsProps) {
  const [msg, setMsg] = useState<string | null>(null);
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const finished = p.tallies.filter(t => t.id !== p.activeTallyId);

  const json = () => JSON.stringify(makeTallyFile(finished, p.device));
  const doImport = async (raw: string) => {
    try {
      const f = parseTallyFile(raw);
      const r = await p.onImportTallies(f.sessions);
      setMsg(`From ${f.device}: ${plural(r.added, 'new tally', 'new tallies')}${r.updated ? `, ${r.updated} updated` : ''}${r.unchanged ? `, ${r.unchanged} already here` : ''}.`);
      setPaste(false); setText('');
    } catch (e) { setMsg(`Could not read tallies: ${e instanceof Error ? e.message : String(e)}`); }
  };

  return (
    <details class="card" style={{ marginTop: '18px' }}>
      <summary>Move tallies between devices</summary>
      <p class="small muted">
        Tally on the laptop or a spare device while the phone runs Railbird. Afterwards, send the tallies here as a small file or as copied text. Importing the same tallies twice is safe.
        This device is <b>{p.device}</b> and holds {plural(finished.length, 'finished tally', 'finished tallies')}.
      </p>
      {msg && <div class="notice" role="status">{msg}</div>}
      <div class="row">
        <button class="btn primary" disabled={!finished.length} onClick={() => saveTextFile(`electro-coach-tallies-${localDate(new Date().toISOString())}.json`, json())}>Save tallies as a file</button>
        <button class="btn" disabled={!finished.length} onClick={async () => {
          try { await navigator.clipboard.writeText(json()); setCopied('Copied. Paste it on the other device.'); }
          catch { setText(json()); setPaste(true); setCopied('Select all the text below and copy it.'); }
          setTimeout(() => setCopied(null), 4000);
        }}>Copy tallies as text</button>
      </div>
      {copied && <p class="small" role="status">{copied}</p>}
      <div class="row" style={{ marginTop: '10px' }}>
        <button class="btn" onClick={() => file.current?.click()}>Import a tally file</button>
        <button class="btn" onClick={() => setPaste(!paste)}>{paste ? 'Close' : 'Paste tallies'}</button>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={async e => {
          const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = '';
          if (f) doImport(await f.text());
        }} />
      </div>
      {paste && (
        <div style={{ marginTop: '10px' }}>
          <textarea id="tally-paste" rows={5} class="mono" value={text} placeholder="Paste copied tallies here" onInput={e => setText((e.target as HTMLTextAreaElement).value)} />
          <button class="btn primary" style={{ marginTop: '6px' }} disabled={!text.trim()} onClick={() => doImport(text)}>Import pasted tallies</button>
        </div>
      )}
    </details>
  );
}

// ---------- progressive drills: level, history per level, thresholds ----------

function LevelPanel({ drill, tallies, state }: { drill: DrillDef; tallies: TallySession[]; state: LevelState }) {
  const spec = drill.prog!;
  const th = getThresholds(drill.id);
  const [editTh, setEditTh] = useState(false);
  const done = tallies.filter(t => t.ended && summarize(spec, t).complete).sort((a, b) => (a.ended! < b.ended! ? 1 : -1));
  const at = (lv: number) => done.filter(t => (t.level ?? 1) === lv);
  const ov = getOverride(drill.id);
  return (
    <div class="card prog-panel">
      {spec.progressive ? <>
        <div class="row" style={{ alignItems: 'baseline' }}>
          <h3 style={{ margin: 0 }}>Your level: {state.level}{state.mastered ? ' · mastered' : ''}</h3>
          <span class="small muted">{state.good ? `${state.good} of 2 at the move-up bar` : state.poor ? `${state.poor} poor set${state.poor === 1 ? '' : 's'} in a row` : ''}</span>
        </div>
        <div class="small muted th-rules">
          <div><b>Move up:</b> two sets in a row at {Math.round(100 * th.upMake)}% made and {Math.round(100 * th.upQuality)}% quality.</div>
          <div><b>Move down:</b> two sets in a row under {Math.round(100 * th.downMake)}% made or {Math.round(100 * th.downQuality)}% quality. One bad day never moves you down.</div>
          {state.changed && <div>Last move: Level {state.changed.from} → {state.changed.to} on {fmtDate(state.changed.at, { day: 'numeric', month: 'short' })}.</div>}
        </div>
        <div class="row" style={{ gap: '6px', alignItems: 'center' }}>
          <span class="small">Set the level yourself:</span>
          <div class="seg" role="group" aria-label="Set level">
            {spec.levels.map((l, i) => <button key={i} aria-pressed={state.level === i + 1} onClick={() => setLevel(drill.id, i + 1)}>{i + 1}</button>)}
          </div>
        </div>
        {ov && <p class="small muted" style={{ margin: '4px 0 0' }}>Set by hand on {fmtDate(ov.at, { day: 'numeric', month: 'short' })}; sets since then count from there.</p>}
      </> : <h3 style={{ margin: 0 }}>Your sets</h3>}

      {done.length > 0 && <div class="scroll-x"><table class="tally-table compact" style={{ marginTop: '8px' }}>
        <thead><tr>{(spec.progressive || spec.variants) && <th>{spec.progressive ? 'Level' : 'Speed'}</th>}<th class="n">Sets</th><th class="n">Last made</th>{!spec.noQuality && <><th class="n">Last quality</th><th class="n">Best quality</th></>}</tr></thead>
        <tbody>{(spec.progressive ? spec.levels.map((_, i) => ({ k: String(i + 1), label: String(i + 1), ts: at(i + 1) }))
          : spec.variants ? spec.variants.map(v => ({ k: v.id, label: v.label, ts: done.filter(t => t.variant === v.id) }))
          : [{ k: 'all', label: '', ts: done }]).map(({ k, label, ts }) => {
          if (!ts.length) return null;
          const last = summarize(spec, ts[0]);
          const bestQ = Math.max(...ts.map(t => summarize(spec, t).qualityPct ?? 0));
          return <tr key={k}>{(spec.progressive || spec.variants) && <td>{label}</td>}<td class="n">{ts.length}</td><td class="n">{pct(last.makePct)}</td>{!spec.noQuality && <><td class="n">{pct(last.qualityPct)}</td><td class="n">{pct(bestQ)}</td></>}</tr>;
        })}</tbody>
      </table></div>}
      {done.length > 0 && spec.progressive && <p class="small muted" style={{ margin: '4px 0 0' }}>Last set: {(() => { const v = verdictOf(summarize(spec, done[0]), th); return v === 'good' ? 'at the move-up bar' : v === 'poor' ? 'below the bar' : 'in between'; })()}.</p>}

      {spec.handed && <div class="row" style={{ gap: '6px', alignItems: 'center', marginTop: '8px' }}>
        <span class="small">You play</span>
        <div class="seg" role="group" aria-label="Handedness">
          <button aria-pressed={getHand() === 'R'} onClick={() => setHand('R')}>Right-handed</button>
          <button aria-pressed={getHand() === 'L'} onClick={() => setHand('L')}>Left-handed</button>
        </div>
      </div>}

      {spec.progressive && <details style={{ marginTop: '8px' }} open={editTh} onToggle={e => setEditTh((e.target as HTMLDetailsElement).open)}>
        <summary class="small">Adjust the thresholds</summary>
        <ThresholdFields value={th} onChange={v => setThresholds(drill.id, v)} />
        <button class="btn btn-s" onClick={() => setThresholds(drill.id, null)}>Restore 80 / 70 and 70 / 50</button>
      </details>}
    </div>
  );
}

function ThresholdFields({ value, onChange }: { value: Thresholds; onChange: (v: Thresholds) => void }) {
  const f = (k: keyof Thresholds, label: string) => (
    <select aria-label={label} value={String(Math.round(100 * value[k]))} onChange={e => onChange({ ...value, [k]: Number((e.target as HTMLSelectElement).value) / 100 })}>
      {[40, 50, 60, 65, 70, 75, 80, 85, 90, 95].map(n => <option key={n} value={n}>{n}%</option>)}</select>
  );
  // One line each: what moves you up, then what moves you down.
  return (
    <div class="small">
      <div class="th-grid">
        <span /><span class="th-head">Made</span><span /><span class="th-head">Quality</span>
        <b>Move up</b>{f('upMake', 'Move up: made at least')}<span class="th-join">and</span>{f('upQuality', 'Move up: quality at least')}
        <b>Move down</b>{f('downMake', 'Move down: made under')}<span class="th-join">or</span>{f('downQuality', 'Move down: quality under')}
      </div>
      <p class="muted" style={{ margin: '0 0 8px' }}>Move up needs at least both numbers; move down needs under either one.</p>
    </div>
  );
}
