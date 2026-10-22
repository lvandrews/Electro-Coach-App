import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AppData, Tab } from '../app';
import { predictCI, speedCurve, calibration, similarShots, TERMS, type ModelFit, type ModelRow, type ShotInputs } from '../engine/model';
import { buildLedger, ESS_MIN, type LedgerResult, type SegmentStat, type Tier } from '../engine/ledger';
import { useWidth } from './useWidth';
import { fitFor } from './fitCache';
import { SpeedProfileCard } from './SpeedProfile';
import { BestShotsCard } from './BestShots';
import { Empty } from './SessionsScreen';
import { fmtDate, int, pct } from './format';

// ---------- computation (cached across tab switches) ----------

interface Computed { rows: ModelRow[]; fit: ModelFit; ledger: LedgerResult }
let cache: { key: unknown; value: Computed } | null = null;

function useModel(data: AppData): { value: Computed | null; error: string | null } {
  const key = data.exclusions;   // a new Map whenever shots or rules change
  const [state, setState] = useState<{ value: Computed | null; error: string | null }>(
    cache?.key === key ? { value: cache.value, error: null } : { value: null, error: null });
  useEffect(() => {
    if (cache?.key === key) { setState({ value: cache.value, error: null }); return; }
    setState({ value: null, error: null });
    const t = setTimeout(() => {   // let the "Fitting…" frame paint first
      try {
        const m = fitFor(data);
        if (!m) throw new Error('need at least 50 kept shots with full geometry to fit the model');
        const { rows, fit } = m;
        const ledger = buildLedger(fit, rows);
        cache = { key, value: { rows, fit, ledger } };
        setState({ value: cache.value, error: null });
      } catch (e) { setState({ value: null, error: e instanceof Error ? e.message : String(e) }); }
    }, 30);
    return () => clearTimeout(t);
  }, [key]);
  return state;
}

const TIER_CLASS: Record<Tier, string> = {
  'Established strength': 't-strong', 'Emerging strength': 't-emerging', Neutral: 't-neutral', Watch: 't-watch', 'Established weakness': 't-weak',
};
const pts = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(100 * x).toFixed(1)}`;

// ---------- screen ----------

export function ModelScreen({ data, onGo, onOpenDrill, focus }: { data: AppData; onGo: (t: Tab) => void; onOpenDrill: (id: string) => void; focus?: string | null }) {
  const { value, error } = useModel(data);
  const [view, setView] = useState<'forest' | 'radar'>(() => { try { return (localStorage.getItem('ec-model-view') as 'forest' | 'radar') || 'forest'; } catch { return 'forest'; } });
  const pick = (v: 'forest' | 'radar') => { setView(v); try { localStorage.setItem('ec-model-view', v); } catch { /* ignore */ } };

  useEffect(() => {
    if (!focus || !value) return;
    const t = setTimeout(() => document.getElementById(focus)?.scrollIntoView({ block: 'start' }), 350);
    return () => clearTimeout(t);
  }, [focus, value]);

  if (!data.shots.size) return <Empty onGo={onGo} />;
  if (error) return <section><h2>Model</h2><div class="notice bad">The model could not be fitted: {error}.</div></section>;
  if (!value) return <section><h2>Model</h2><p class="muted">Fitting the model to {int(data.shots.size - data.exclusions.size)} kept shots…</p></section>;

  const { fit, rows, ledger } = value;
  const o = ledger.overall;
  return (
    <section>
      <h2>Model</h2>
      <p class="lede">How often you make each kind of shot compared with how often you should, given its geometry.</p>
      <p class="small muted" style={{ marginTop: '-6px' }}>
        Fitted just now on {int(fit.n)} kept shots from {fit.sessions} sessions, {fmtDate(fit.dateRange[0], { month: 'short', year: 'numeric' })} to {fmtDate(fit.dateRange[1], { month: 'short', year: 'numeric' })}.
        {o.cur != null && <> Current form overall (recent shots weighted, 90-day half-life): <b class="num">{pts(o.cur)} pts</b>.</>}
      </p>

      <div class="card">
        <div class="row" style={{ alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Strengths and weaknesses</h3>
          <span class="spacer" />
          <div class="seg" role="group" aria-label="View">
            <button aria-pressed={view === 'forest'} onClick={() => pick('forest')}>Forest plot</button>
            <button aria-pressed={view === 'radar'} onClick={() => pick('radar')}>Radar</button>
          </div>
        </div>
        <TierLegend />
        {view === 'forest' ? <Forest ledger={ledger} /> : <Radar ledger={ledger} />}
      </div>

      <BestShotsCard data={data} />
      <SpeedProfileCard data={data} onOpenDrill={onOpenDrill} />
      <Predictor fit={fit} rows={rows} />
      <Details fit={fit} rows={rows} />
    </section>
  );
}

function TierLegend() {
  const tiers: Tier[] = ['Established strength', 'Emerging strength', 'Neutral', 'Watch', 'Established weakness'];
  return (
    <div class="legend small" style={{ margin: '10px 0 4px' }}>
      {tiers.map(t => <span key={t}><i class={`swatch ${TIER_CLASS[t]}`} />{t}</span>)}
    </div>
  );
}

// ---------- forest plot ----------

const LIM = 0.2;   // ±20 points

function Forest({ ledger }: { ledger: LedgerResult }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [open, setOpen] = useState<string | null>(null);
  const groups = [...new Set(ledger.segments.map(s => s.group))];
  const pad = 10;
  const x = (v: number) => pad + ((Math.max(-LIM, Math.min(LIM, v)) + LIM) / (2 * LIM)) * (W - 2 * pad);
  const ticks = [-0.2, -0.1, 0, 0.1, 0.2];

  return (
    <div ref={ref} class="forest">
      <p class="small muted" style={{ margin: '0 0 6px' }}>
        Bar: all-time difference from expected. Line: 95% range (sessions resampled 2,000 times). Diamond: current form; hollow when there are too few recent shots. Tap a row for its numbers.
      </p>
      <svg width={W} height={22} class="chart" aria-hidden="true">
        {ticks.map(t => <text key={t} x={x(t)} y={14} text-anchor="middle">{t === 0 ? '0' : `${t > 0 ? '+' : '−'}${Math.abs(t * 100)}`}</text>)}
      </svg>
      {groups.map(g => (
        <div key={g} class="forest-group">
          <div class="forest-head">{g}{g === 'Equipment' && <span class="muted"> · condition effects, not skill</span>}{g.startsWith('Spin') && <span class="muted"> · Railbird reads spin from the cue ball's bend, so compare within a band</span>}</div>
          {ledger.segments.filter(s => s.group === g).sort((a, b) => b.oe - a.oe).map(s => {
            const k = s.group + s.label;
            return (
              <div key={k} class={`forest-row ${open === k ? 'open' : ''}`}>
                <button class="forest-label" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}>
                  <span>{s.label}</span>
                  <span class="muted num">{pts(s.oe)} · n {int(s.n)}</span>
                </button>
                <svg width={W} height={20} class="chart" role="img" aria-label={`${s.label}: ${pts(s.oe)} points, ${s.condition ? 'condition effect' : s.tier}`}>
                  {ticks.map(t => <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={20} class={t === 0 ? 'zero' : 'tick'} />)}
                  <rect x={Math.min(x(0), x(s.oe))} y={5} width={Math.max(2, Math.abs(x(s.oe) - x(0)))} height={10} rx={2}
                    class={s.condition ? 't-cond' : TIER_CLASS[s.tier]} />
                  <line x1={x(s.lo)} x2={x(s.hi)} y1={10} y2={10} class="ci" />
                  {s.lo > -LIM ? <line x1={x(s.lo)} x2={x(s.lo)} y1={6} y2={14} class="ci" /> : <path d={`M${x(-LIM) + 5},6 L${x(-LIM)},10 L${x(-LIM) + 5},14`} class="ci" fill="none" />}
                  {s.hi < LIM ? <line x1={x(s.hi)} x2={x(s.hi)} y1={6} y2={14} class="ci" /> : <path d={`M${x(LIM) - 5},6 L${x(LIM)},10 L${x(LIM) - 5},14`} class="ci" fill="none" />}
                  {s.cur != null && <path d={`M${x(s.cur)},4 L${x(s.cur) + 5},10 L${x(s.cur)},16 L${x(s.cur) - 5},10 Z`} class={s.ess >= ESS_MIN ? 'cur' : 'cur hollow'} />}
                </svg>
                {open === k && <SegDetail s={s} />}
              </div>
            );
          })}
        </div>
      ))}
      <div class="axis-note small muted">← worse than expected · percentage points · better than expected →</div>
    </div>
  );
}

function SegDetail({ s }: { s: SegmentStat }) {
  return (
    <div class="seg-detail small">
      <div class="num">
        Made {pct(s.make, 1)} of {int(s.n)} shots in {s.sessions} sessions; expected {pct(s.expected, 1)}.
        Difference {pts(s.oe)} pts, 95% range {pts(s.lo)} to {pts(s.hi)}.
      </div>
      <div>{s.condition ? 'Equipment rows show how much easier or harder these tables or pockets play; they are not a skill rating.' : <><b>{s.tier}.</b> {tierText(s.tier)}</>}</div>
      <div class="num muted">
        Current form {s.cur == null ? '—' : `${pts(s.cur)} pts`} from an effective {int(Math.round(s.ess))} recent shots{s.ess < ESS_MIN ? ` (under ${ESS_MIN}: read with caution)` : ''}.
      </div>
    </div>
  );
}
function tierText(t: Tier) {
  switch (t) {
    case 'Established strength': return 'The whole 95% range is above zero.';
    case 'Established weakness': return 'The whole 95% range is below zero.';
    case 'Emerging strength': return 'At least 2 points above expected, but the range still includes zero.';
    case 'Watch': return 'At least 2 points below expected, but the range still includes zero.';
    default: return 'Within 2 points of expected.';
  }
}

// ---------- radar ----------

function Radar({ ledger }: { ledger: LedgerResult }) {
  const [ref, W0] = useWidth<HTMLDivElement>();
  const [sel, setSel] = useState<number | null>(null);
  const W = Math.min(W0, 520), H = W * 0.92;
  const cx = W / 2, cy = H / 2, Rmax = Math.min(W, H) / 2 - 62, R0 = Rmax * 0.5;
  const S = 0.15;   // ±15 points across the radius
  const r = (v: number) => R0 + (Math.max(-S, Math.min(S, v)) / S) * (Rmax - R0);
  const n = ledger.radar.length;
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const P = (a: number, rad: number) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  const wedge = (i: number, rIn: number, rOut: number) => {
    const half = (Math.PI / n) * 0.62, a0 = ang(i) - half, a1 = ang(i) + half;
    const [x0, y0] = P(a0, rIn), [x1, y1] = P(a0, rOut), [x2, y2] = P(a1, rOut), [x3, y3] = P(a1, rIn);
    return `M${x0},${y0} L${x1},${y1} A${rOut},${rOut} 0 0 1 ${x2},${y2} L${x3},${y3} A${rIn},${rIn} 0 0 0 ${x0},${y0} Z`;
  };
  const s = sel != null ? ledger.radar[sel] : null;
  return (
    <div ref={ref}>
      <p class="small muted" style={{ margin: '0 0 6px' }}>
        A quick shape check over ten broad groups. The dark ring is your expectation; petals outside it beat it, inside fall short. The outer ring is +15 points and the center −15. Tap a petal for its numbers. The forest plot is more precise because it shows uncertainty.
      </p>
      <svg width={W} height={H} class="chart radar" role="img" aria-label="Radar of difference from expected across ten shot groups">
        {[-0.15, -0.075, 0.075, 0.15].map(v => <circle key={v} cx={cx} cy={cy} r={r(v)} class="tick" fill="none" />)}
        <circle cx={cx} cy={cy} r={R0} class="zero" fill="none" />
        {ledger.radar.map((a, i) => {
          const [lx, ly] = P(ang(i), Rmax + 10);
          const [ex, ey] = P(ang(i), Rmax);
          const anchor = Math.abs(Math.cos(ang(i))) < 0.2 ? 'middle' : Math.cos(ang(i)) > 0 ? 'start' : 'end';
          const parts = a.label.split(/,\s*|\s(?=\d)/);
          return (
            <g key={a.label} onClick={() => setSel(sel === i ? null : i)} style={{ cursor: 'pointer' }}>
              <line x1={cx} y1={cy} x2={ex} y2={ey} class="tick" />
              <path d={a.oe >= 0 ? wedge(i, R0, r(a.oe)) : wedge(i, r(a.oe), R0)} class={TIER_CLASS[a.tier]} opacity={sel == null || sel === i ? 1 : 0.45} />
              <text x={lx} y={ly - (parts.length - 1) * 6} text-anchor={anchor} class="label-ink">
                {parts.map((t, k) => <tspan key={k} x={lx} dy={k ? 12 : 0}>{t}</tspan>)}
              </text>
              <text x={lx} y={ly + (parts.length - 1) * 6 + 13} text-anchor={anchor} class="num">{pts(a.oe)}</text>
            </g>
          );
        })}
      </svg>
      {s && <SegDetail s={s} />}
    </div>
  );
}

// ---------- predictor ----------

const FIELDS: { key: keyof ShotInputs; label: string; unit: string; min: number; max: number; step: number }[] = [
  { key: 'objPktIn', label: 'Object ball → pocket', unit: '″', min: 2, max: 100, step: 1 },
  { key: 'cueObjIn', label: 'Cue ball → object ball', unit: '″', min: 2, max: 100, step: 1 },
  { key: 'cutDeg', label: 'Cut angle', unit: '°', min: 0, max: 85, step: 1 },
  { key: 'approachDeg', label: 'Pocket approach angle', unit: '°', min: 0, max: 90, step: 1 },
  { key: 'mph', label: 'Cue ball speed', unit: 'mph', min: 0, max: 17, step: 0.5 },
];

function Predictor({ fit, rows }: { fit: ModelFit; rows: ModelRow[] }) {
  const [inp, setInp] = useState<ShotInputs>({ objPktIn: 24, cueObjIn: 36, cutDeg: 30, approachDeg: 20, mph: 6 });
  const p = predictCI(fit, inp);
  const curve = useMemo(() => speedCurve(fit, inp), [fit, inp.objPktIn, inp.cueObjIn, inp.cutDeg, inp.approachDeg]);
  const sim = useMemo(() => similarShots(rows, inp), [rows, inp.objPktIn, inp.cueObjIn, inp.cutDeg]);
  const set = (k: keyof ShotInputs) => (e: Event) => {
    const v = Number((e.target as HTMLInputElement).value);
    if (Number.isFinite(v)) setInp({ ...inp, [k]: v });
  };
  return (
    <div class="card" id="predictor">
      <h3>Shot predictor</h3>
      <p class="small muted" style={{ marginTop: 0 }}>Describe a shot to see how often you'd expect to make it, and which speed gives it the best chance. For attack or safety: attack when this is above your break-even chance (see the routine's shot-selection notes).</p>
      <div class="pred">
        <div class="pred-inputs">
          {FIELDS.map(f => (
            <label key={f.key} class="pred-field">
              <span>{f.label}</span>
              <input type="range" min={f.min} max={f.max} step={f.step} value={inp[f.key]} onInput={set(f.key)} aria-label={f.label} />
              <span class="pred-num">
                <input id={`pred-${f.key}`} type="number" min={f.min} max={f.max} step={f.step} value={inp[f.key]} onChange={set(f.key)} />
                <span class="muted">{f.unit}</span>
              </span>
            </label>
          ))}
        </div>
        <div class="pred-out">
          <div class="pred-label">Expected make rate</div>
          <div class="pred-big num">{pct(p.p)}</div>
          <div class="small muted num">95% range {pct(p.lo)}–{pct(p.hi)}</div>
          <div class="meter" aria-hidden="true"><span style={{ width: `${100 * p.p}%` }} /></div>
          <div class="small" style={{ marginTop: '8px' }}>
            {sim.n >= 10
              ? <>Your record for shots like this: <b class="num">{sim.makes} of {sim.n}</b> ({pct(sim.rate)}).</>
              : <>Fewer than 10 shots like this in your record ({sim.n}), so the model is filling the gap.</>}
            <span class="muted"> Within ±{sim.tol.cut}° cut, ±{sim.tol.objPkt}″ to the pocket and ±{sim.tol.cueObj}″ cue ball to object ball.</span>
          </div>
        </div>
      </div>
      <SpeedChart curve={curve} mph={inp.mph} />
    </div>
  );
}

function SpeedChart({ curve, mph }: { curve: ReturnType<typeof speedCurve>; mph: number }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const H = 170, L = 38, Rr = 10, T = 12, B = 26;
  const maxX = curve.pts[curve.pts.length - 1].mph;
  const ps = curve.pts.map(q => q.p);
  const lo = Math.max(0, Math.floor((Math.min(...ps) - 0.05) * 10) / 10), hi = Math.min(1, Math.ceil((Math.max(...ps) + 0.05) * 10) / 10);
  const x = (v: number) => L + (v / maxX) * (W - L - Rr);
  const y = (p: number) => T + (1 - (p - lo) / (hi - lo)) * (H - T - B);
  const d = curve.pts.map((q, i) => `${i ? 'L' : 'M'}${x(q.mph).toFixed(1)},${y(q.p).toFixed(1)}`).join(' ');
  const cur = curve.pts.reduce((a, b) => (Math.abs(b.mph - mph) < Math.abs(a.mph - mph) ? b : a));
  const yt: number[] = []; for (let v = lo; v <= hi + 1e-9; v += (hi - lo) > 0.4 ? 0.2 : 0.1) yt.push(Math.round(v * 100) / 100);
  return (
    <div ref={ref} style={{ marginTop: '14px' }}>
      <div class="panel-title">Make chance by speed for this shot</div>
      <p class="small" style={{ margin: '2px 0 6px' }}>
        Best around <b class="num">{curve.best.mph.toFixed(1)} mph</b>; within 2 points of that from <span class="num">{curve.band[0]}</span> to <span class="num">{curve.band[1]} mph</span>.
      </p>
      <svg width={W} height={H} class="chart" role="img" aria-label="Make probability by cue ball speed">
        <rect x={x(curve.band[0])} y={T} width={Math.max(1, x(curve.band[1]) - x(curve.band[0]))} height={H - T - B} class="band" />
        {yt.map(v => <g key={v}><line x1={L} x2={W - Rr} y1={y(v)} y2={y(v)} class="tick" /><text x={L - 6} y={y(v) + 4} text-anchor="end">{Math.round(v * 100)}%</text></g>)}
        {[0, 3, 6, 9, 12, 15].filter(v => v <= maxX).map(v => <text key={v} x={x(v)} y={H - 8} text-anchor="middle">{v}</text>)}
        <path d={d} class="curve" fill="none" />
        <circle cx={x(cur.mph)} cy={y(cur.p)} r={5} class="curve-dot" />
        <text x={W - Rr} y={H - 8} text-anchor="end">mph</text>
      </svg>
    </div>
  );
}

// ---------- model details ----------

function Details({ fit, rows }: { fit: ModelFit; rows: ModelRow[] }) {
  const cal = useMemo(() => calibration(fit, rows), [fit, rows]);
  const meaning = [
    '', 'each extra foot to the pocket', 'each extra foot from cue ball to object ball', 'thinner cuts (grows quickly past ~45°)',
    'each extra 10° of pocket approach angle', 'speed (with the next term, a peak speed)', 'bends the speed effect back down at high speed',
  ];
  return (
    <details class="card">
      <summary>How the model works</summary>
      <p class="small">
        A logistic regression of make or miss on the shot's geometry, fitted on this device from your kept shots. Standard errors are clustered by session,
        so a few long sessions can't make the estimates look more certain than they are. Pseudo-R² is {fit.pseudoR2.toFixed(3)}: low, as usual for a single
        make-or-miss outcome. What matters for the comparisons above is calibration: predicted and actual make rates line up across the range (chart below).
      </p>
      <div class="scroll-x">
        <table class="small">
          <thead><tr><th>Term</th><th class="n">Coefficient</th><th class="n">Odds ×</th><th class="n">95% range</th><th>Effect of</th></tr></thead>
          <tbody>
            {TERMS.map((t, i) => (
              <tr key={t}>
                <td>{t}</td>
                <td class="n">{fit.beta[i].toFixed(3)}</td>
                <td class="n">{i ? Math.exp(fit.beta[i]).toFixed(3) : '—'}</td>
                <td class="n">{i ? `${Math.exp(fit.beta[i] - 1.96 * fit.se[i]).toFixed(3)}–${Math.exp(fit.beta[i] + 1.96 * fit.se[i]).toFixed(3)}` : '—'}</td>
                <td>{meaning[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Calibration cal={cal} />
    </details>
  );
}

function Calibration({ cal }: { cal: { pred: number; obs: number; n: number }[] }) {
  const [ref, W0] = useWidth<HTMLDivElement>();
  const W = Math.min(W0, 360), H = W, L = 36, B = 28, T = 8, R = 8;
  const lo = Math.max(0, Math.floor(Math.min(...cal.map(c => Math.min(c.pred, c.obs))) * 10) / 10);
  const hi = Math.min(1, Math.ceil(Math.max(...cal.map(c => Math.max(c.pred, c.obs))) * 10) / 10);
  const x = (v: number) => L + ((v - lo) / (hi - lo)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks: number[] = []; for (let v = lo; v <= hi + 1e-9; v += 0.1) ticks.push(Math.round(v * 10) / 10);
  return (
    <div ref={ref} style={{ marginTop: '12px' }}>
      <div class="panel-title">Calibration: predicted vs actual, ten equal groups of shots</div>
      <svg width={W} height={H} class="chart" role="img" aria-label="Calibration plot">
        {ticks.map(v => <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} class="tick" /><text x={L - 6} y={y(v) + 4} text-anchor="end">{Math.round(v * 100)}%</text>
          <text x={x(v)} y={H - 10} text-anchor="middle">{Math.round(v * 100)}%</text>
        </g>)}
        <line x1={x(lo)} y1={y(lo)} x2={x(hi)} y2={y(hi)} class="zero" />
        {cal.map((c, i) => <circle key={i} cx={x(c.pred)} cy={y(c.obs)} r={4.5} class="curve-dot"><title>{`predicted ${pct(c.pred)}, actual ${pct(c.obs)}, ${c.n} shots`}</title></circle>)}
      </svg>
      <p class="small muted" style={{ margin: 0 }}>Across: predicted make rate. Up: actual. Points on the diagonal mean the model is calibrated.</p>
    </div>
  );
}
