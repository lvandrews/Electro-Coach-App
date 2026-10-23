import { useEffect, useState } from 'preact/hooks';
import type { DrillDef } from '../engine/drills';
import {
  currentPhase, levelState, makeEvent, mirrorDiagram, missEvent, progressNote, requiredMakes, sideNow, summarize, verdictOf,
  type MakeOutcome, type MissDir, type ProgSpec,
} from '../engine/progressive';
import type { TallyEvent, TallySession } from '../engine/tally';
import { drillLevel, getHand, getOverride, getThresholds, onProgPrefs } from './progPrefs';
import { TableDiagram } from './TableDiagram';

type Push = (e: Omit<TallyEvent, 't'>, msg: string) => void;

/** The diagram for a level, mirrored for left-handed players where the drill depends on it. */
export function levelDiagram(spec: ProgSpec, level: number) {
  const dg = spec.levels[Math.max(0, Math.min(spec.levels.length, level) - 1)]?.diagram ?? null;
  return spec.handed && getHand() === 'L' ? mirrorDiagram(dg) : dg;
}

const pct = (v: number | null) => (v == null ? '–' : `${Math.round(100 * v)}%`);

function outcomeLabel(o: MakeOutcome) {
  if (o.drift && o.spin) return o.label;
  const side = o.drift ?? o.rail ?? o.spin;
  if (side) {
    const [l, r] = o.spin && !o.drift ? ['↺', '↻'] : ['◀', '▶'];
    return side === 'L' ? `${l} ${o.label}` : `${o.label} ${r}`;
  }
  return o.quality === 'best' ? `★ ${o.label}` : o.quality === 'good' ? `✓ ${o.label}` : o.label;
}

/** Plain-language feedback from the pattern of drift and spin (Lela's diagnosis). */
export function strokeFeedback(sum: ReturnType<typeof summarize>): string[] {
  const out: string[] = [];
  const sp = sum.spin.L + sum.spin.R, dr = sum.drift.L + sum.drift.R;
  if (sp >= 2) out.push(`Spinning on ${sp} of ${sum.makes}${sum.spin.L !== sum.spin.R ? `, mostly ${sum.spin.L > sum.spin.R ? 'left ↺' : 'right ↻'}` : ''}: you're not hitting the center of the cue ball.`);
  if (dr >= 2) out.push(`Drifting on ${dr} of ${sum.makes}${sum.drift.L !== sum.drift.R ? `, mostly ${sum.drift.L > sum.drift.R ? 'left' : 'right'}` : ''}: you're not hitting the center of your target.`);
  return out;
}

export function ProgressiveTally({ drill, session, tallies, push, onPatch, onAmend, onFinish }: {
  drill: DrillDef; session: TallySession; tallies: TallySession[]; push: Push;
  onPatch: (p: Partial<TallySession>) => void; onAmend: (res: string) => void; onFinish: () => void;
}) {
  const spec = drill.prog!;
  const [, bump] = useState(0);
  useEffect(() => onProgPrefs(() => bump(v => v + 1)), []);
  const mine = tallies.filter(t => t.drillId === drill.id && t.id !== session.id);
  const state = drillLevel(drill, mine);
  const level = session.level ?? state.level;
  const onLevel = (lv: number) => onPatch({ level: lv });
  // A new set starts at the player's current level, the first set size and the middle variant.
  useEffect(() => {
    const p: Partial<TallySession> = {};
    if (spec.progressive && session.level == null) p.level = state.level;
    if (spec.setSizes && session.target == null) p.target = spec.setSizes[0];
    if (spec.variants && session.variant == null) p.variant = spec.variants[Math.min(1, spec.variants.length - 1)].id;
    if (Object.keys(p).length) onPatch(p);
  }, [session.id]);

  const sum = summarize(spec, session);
  const cur = currentPhase(spec, session.events, session.target);
  const need = requiredMakes(spec, session.target);
  const multi = spec.phases.length > 1;
  const done = sum.complete;
  const side = sideNow(spec, session.events);
  const fresh = session.events.length === 0;
  const [amend, setAmend] = useState<MakeOutcome | null>(null);
  useEffect(() => { if (!amend) return; const t = setTimeout(() => setAmend(null), 6000); return () => clearTimeout(t); }, [amend, session.events.length]);

  const make = (o: MakeOutcome) => { push(makeEvent(o, cur.phase, side), o.label); setAmend(o.amend ? o : null); };
  const miss = (d: MissDir) => { push(missEvent(d, cur.phase, side), d === '?' ? 'Missed (not sure)' : `Missed ${d === 'L' ? 'left' : d === 'R' ? 'right' : d}`); setAmend(null); };
  const shown = cur.phase.outcomes.filter(o => !o.hidden);

  return (
    <div class="prog">
      <div class="prog-level">
        {spec.progressive && session.events.length === 0
          ? <div class="seg" role="group" aria-label="Level">
              {spec.levels.map((l, i) => (
                <button key={i} aria-pressed={level === i + 1} onClick={() => onLevel(i + 1)}>{l.label}{state.level === i + 1 ? ' ●' : ''}</button>
              ))}
            </div>
          : spec.progressive && <span class="prog-chip">{spec.levels[level - 1]?.label}</span>}
        <span class="small muted">{spec.levels[level - 1]?.cue}</span>
      </div>
      {(spec.variants || spec.setSizes) && <div class="row" style={{ gap: '8px', alignItems: 'center' }}>
        {spec.variants && (fresh
          ? <div class="seg" role="group" aria-label="Speed">{spec.variants.map(v => <button key={v.id} aria-pressed={session.variant === v.id} onClick={() => onPatch({ variant: v.id })}>{v.label}</button>)}</div>
          : <span class="prog-chip">{spec.variants.find(v => v.id === session.variant)?.label}</span>)}
        {spec.setSizes && (fresh
          ? <label class="small">Set of <select value={String(session.target ?? spec.setSizes[0])} onChange={e => onPatch({ target: Number((e.target as HTMLSelectElement).value) })}>
              {spec.setSizes.map(n => <option key={n} value={n}>{n}</option>)}</select></label>
          : <span class="small muted">set of {need}</span>)}
      </div>}
      {spec.progressive && session.events.length === 0 && <p class="small muted" style={{ margin: '2px 0 0' }}>● your current level{state.mastered ? ' (top level mastered)' : ''}. Another level is fine for practice; only sets at your level count toward moving.</p>}

      <details class="prog-setup">
        <summary>Set-up diagram</summary>
        <TableDiagram spec={levelDiagram(spec, level)} title={`${drill.name} ${spec.levels[level - 1]?.label ?? ''}`} maxWidth={260} />
      </details>

      {!done ? <>
        <div class="prog-phase">
          {multi && <span class="prog-phase-name">{cur.phase.name}</span>}
          {side && spec.alternate && <span class="prog-phase-name">{spec.alternate[side === 'L' ? 0 : 1]}</span>}
          <span class="prog-phase-count num">{multi ? `${cur.made} of ${cur.of}` : `${sum.makes} of ${need}`}</span>
          <span class="small muted">{multi ? `${sum.makes} of ${need} makes in all` : 'makes'}</span>
        </div>

        {amend?.amend && <div class="prog-amend" role="group" aria-label="Add spin">
          <span class="small">{amend.label}…</span>
          {amend.amend.map(a => <button key={a.to} class="btn btn-s" onClick={() => { onAmend(a.to); setAmend(null); }}>{a.label}</button>)}
        </div>}

        <div class={`prog-makes n${shown.length}`}>
          {shown.map(o => (
            <button key={o.id} class={`btn prog-btn ${o.quality ?? ''} ${o.drift || o.spin || o.rail ? 'side' : ''}`} onClick={() => make(o)}>{outcomeLabel(o)}</button>
          ))}
        </div>
        <div class="prog-miss">
          {spec.missKind === 'lr'
            ? <><button class="btn prog-btn miss" onClick={() => miss('L')}>◀ Missed left</button><button class="btn prog-btn miss" onClick={() => miss('R')}>Missed right ▶</button></>
            : <><button class="btn prog-btn miss" onClick={() => miss('thick')}>Missed thick</button><button class="btn prog-btn miss" onClick={() => miss('thin')}>Missed thin</button></>}
        </div>
        <button class="btn prog-unsure" onClick={() => miss('?')}>Missed (not sure which way)</button>
      </> : <Complete drill={drill} spec={spec} session={session} mine={mine} level={level} onFinish={onFinish} />}

      <div class="prog-stats small num">
        {sum.attempts} shots · {sum.makes} made · {pct(sum.makePct)} made{!spec.noQuality && <> · quality {sum.quality} of {sum.makes} ({pct(sum.qualityPct)})</>}
        {(sum.misses.L + sum.misses.R + sum.misses.thick + sum.misses.thin + sum.misses['?']) > 0 && <> · misses {spec.missKind === 'lr' ? `${sum.misses.L} left, ${sum.misses.R} right` : `${sum.misses.thick} thick, ${sum.misses.thin} thin`}{sum.misses['?'] ? `, ${sum.misses['?']} unsure` : ''}</>}
        {(sum.drift.L + sum.drift.R) > 0 && <> · drift {sum.drift.L} left, {sum.drift.R} right</>}
        {(sum.spin.L + sum.spin.R) > 0 && <> · spin {sum.spin.L} left, {sum.spin.R} right</>}
        {(sum.rail.L + sum.rail.R) > 0 && <> · rail {sum.rail.L} left, {sum.rail.R} right of the pocket</>}
      </div>
      {spec.coaching && !done && <ul class="prog-coach small">{spec.coaching.map((c, i) => <li key={i}>{c}</li>)}</ul>}
    </div>
  );
}

function Complete({ drill, spec, session, mine, level, onFinish }: { drill: DrillDef; spec: ProgSpec; session: TallySession; mine: TallySession[]; level: number; onFinish: () => void }) {
  const sum = summarize(spec, session);
  const th = getThresholds(drill.id), ov = getOverride(drill.id);
  const before = levelState(spec, mine, th, ov);
  const after = levelState(spec, [...mine, { ...session, ended: session.ended ?? new Date().toISOString() }], th, ov);
  const v = verdictOf(sum, th);
  const misses = sum.misses;
  return (
    <div class="card prog-done">
      <h3 style={{ margin: 0 }}>Set complete</h3>
      <div class="prog-done-grid">
        <div><b class="num">{pct(sum.makePct)}</b><span>made ({sum.makes} of {sum.attempts})</span></div>
        {!spec.noQuality && <div><b class="num">{pct(sum.qualityPct)}</b><span>quality ({sum.quality} of {sum.makes})</span></div>}
        {spec.alternate && (['L', 'R'] as const).map((sd, i) => <div key={sd}><b class="num">{pct(sum.bySide[sd].attempts ? sum.bySide[sd].makes / sum.bySide[sd].attempts : null)}</b><span>{spec.alternate![i]} ({sum.bySide[sd].makes} of {sum.bySide[sd].attempts})</span></div>)}
        {sum.best > 0 && <div><b class="num">{sum.best}</b><span>{spec.bestLabel ?? 'best results'}</span></div>}
      </div>
      {spec.phases.length > 1 && <p class="small" style={{ margin: '4px 0' }}>{spec.phases.map(p => {
        const b = sum.byPhase[p.id]; return b ? `${p.name}: ${b.quality} of ${b.makes} quality, ${b.attempts - b.makes} missed` : '';
      }).filter(Boolean).join(' · ')}</p>}
      {(misses.L + misses.R + misses.thick + misses.thin) > 0 && <p class="small" style={{ margin: '4px 0' }}>Misses: {spec.missKind === 'lr' ? `${misses.L} left, ${misses.R} right` : `${misses.thick} thick, ${misses.thin} thin`}{misses['?'] ? `, ${misses['?']} not sure` : ''}.</p>}
      {(sum.drift.L + sum.drift.R) > 0 && <p class="small" style={{ margin: '4px 0' }}>Drift on stop shots: {sum.drift.L} left, {sum.drift.R} right.</p>}
      {(sum.rail.L + sum.rail.R) > 0 && <p class="small" style={{ margin: '4px 0' }}>Reached the rail {sum.rail.L} left and {sum.rail.R} right of the pocket.</p>}
      {strokeFeedback(sum).map((f, i) => <p key={i} class="small" style={{ margin: '4px 0', fontWeight: 600 }}>{f}</p>)}
      {spec.progressive && <p class="prog-verdict">{progressNote(before, after, v, level, spec.levels.length)}</p>}
      <button class="btn primary clock-big" onClick={onFinish}>Save this set</button>
      <p class="small muted" style={{ margin: 0 }}>Tapped one wrong? Undo it below before saving.</p>
    </div>
  );
}
