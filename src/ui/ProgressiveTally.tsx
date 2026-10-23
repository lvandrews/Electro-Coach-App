import { useEffect, useState } from 'preact/hooks';
import type { DrillDef } from '../engine/drills';
import {
  currentPhase, levelState, makeEvent, mirrorDiagram, missEvent, progressNote, requiredMakes, summarize, verdictOf,
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
  if (o.drift === 'L') return '◀ Drifted left';
  if (o.drift === 'R') return 'Drifted right ▶';
  if (o.spin === 'L') return '↺ Spin left';
  if (o.spin === 'R') return 'Spin right ↻';
  return o.quality === 'best' ? `★ ${o.label}` : o.quality === 'good' ? `✓ ${o.label}` : o.label;
}

export function ProgressiveTally({ drill, session, tallies, push, onLevel, onFinish }: {
  drill: DrillDef; session: TallySession; tallies: TallySession[]; push: Push;
  onLevel: (level: number) => void; onFinish: () => void;
}) {
  const spec = drill.prog!;
  const [, bump] = useState(0);
  useEffect(() => onProgPrefs(() => bump(v => v + 1)), []);
  const mine = tallies.filter(t => t.drillId === drill.id && t.id !== session.id);
  const state = drillLevel(drill, mine);
  const level = session.level ?? state.level;
  // A new set starts at the player's current level.
  useEffect(() => { if (spec.progressive && session.level == null) onLevel(state.level); }, [session.id]);

  const sum = summarize(spec, session);
  const cur = currentPhase(spec, session.events);
  const need = requiredMakes(spec);
  const multi = spec.phases.length > 1;
  const done = sum.complete;

  const make = (o: MakeOutcome) => push(makeEvent(o, cur.phase), outcomeLabel(o).replace(/^[✓★◀↺] /, ''));
  const miss = (d: MissDir) => push(missEvent(d, cur.phase), d === '?' ? 'Missed (not sure)' : `Missed ${d === 'L' ? 'left' : d === 'R' ? 'right' : d}`);

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
      {spec.progressive && session.events.length === 0 && <p class="small muted" style={{ margin: '2px 0 0' }}>● your current level{state.mastered ? ' (top level mastered)' : ''}. Another level is fine for practice; only sets at your level count toward moving.</p>}

      <details class="prog-setup">
        <summary>Set-up diagram</summary>
        <TableDiagram spec={levelDiagram(spec, level)} title={`${drill.name} ${spec.levels[level - 1]?.label ?? ''}`} maxWidth={260} />
      </details>

      {!done ? <>
        <div class="prog-phase">
          {multi && <span class="prog-phase-name">{cur.phase.name}</span>}
          <span class="prog-phase-count num">{multi ? `${cur.made} of ${cur.phase.makes}` : `${sum.makes} of ${need}`}</span>
          <span class="small muted">{multi ? `${sum.makes} of ${need} makes in all` : 'makes'}</span>
        </div>

        <div class={`prog-makes n${cur.phase.outcomes.length}`}>
          {cur.phase.outcomes.map(o => (
            <button key={o.id} class={`btn prog-btn ${o.quality ?? ''} ${o.drift || o.spin ? 'side' : ''}`} onClick={() => make(o)}>{outcomeLabel(o)}</button>
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
        {sum.attempts} shots · {sum.makes} made · {pct(sum.makePct)} made · quality {sum.quality} of {sum.makes} ({pct(sum.qualityPct)})
        {(sum.misses.L + sum.misses.R + sum.misses.thick + sum.misses.thin + sum.misses['?']) > 0 && <> · misses {spec.missKind === 'lr' ? `${sum.misses.L} left, ${sum.misses.R} right` : `${sum.misses.thick} thick, ${sum.misses.thin} thin`}{sum.misses['?'] ? `, ${sum.misses['?']} unsure` : ''}</>}
        {(sum.drift.L + sum.drift.R) > 0 && <> · drift {sum.drift.L} left, {sum.drift.R} right</>}
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
        <div><b class="num">{pct(sum.qualityPct)}</b><span>quality ({sum.quality} of {sum.makes})</span></div>
        {sum.best > 0 && <div><b class="num">{sum.best}</b><span>{spec.bestLabel ?? 'best results'}</span></div>}
      </div>
      {spec.phases.length > 1 && <p class="small" style={{ margin: '4px 0' }}>{spec.phases.map(p => {
        const b = sum.byPhase[p.id]; return b ? `${p.name}: ${b.quality} of ${b.makes} quality, ${b.attempts - b.makes} missed` : '';
      }).filter(Boolean).join(' · ')}</p>}
      {(misses.L + misses.R + misses.thick + misses.thin) > 0 && <p class="small" style={{ margin: '4px 0' }}>Misses: {spec.missKind === 'lr' ? `${misses.L} left, ${misses.R} right` : `${misses.thick} thick, ${misses.thin} thin`}{misses['?'] ? `, ${misses['?']} not sure` : ''}.</p>}
      {(sum.drift.L + sum.drift.R) > 0 && <p class="small" style={{ margin: '4px 0' }}>Drift on stop shots: {sum.drift.L} left, {sum.drift.R} right.</p>}
      {spec.progressive && <p class="prog-verdict">{progressNote(before, after, v, level, spec.levels.length)}</p>}
      <button class="btn primary clock-big" onClick={onFinish}>Save this set</button>
      <p class="small muted" style={{ margin: 0 }}>Tapped one wrong? Undo it below before saving.</p>
    </div>
  );
}
