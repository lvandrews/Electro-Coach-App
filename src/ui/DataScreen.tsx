import { useMemo, useState } from 'preact/hooks';
import type { AppData, Tab } from '../app';
import { VARIABLES, applyFilter, histogram, wilson, type Filter, type Histogram, type Bin } from '../engine/distributions';
import { RULES, type RuleId } from '../engine/rules';
import type { Shot } from '../engine/schema';
import { useWidth } from './useWidth';
import { Empty } from './SessionsScreen';
import { int, localYmd, pct } from './format';

type Period = 'all' | '365' | '90' | '30' | 'custom';

export function DataScreen({ data, onGo }: { data: AppData; onGo: (t: Tab) => void }) {
  const [varId, setVarId] = useState('cut');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [f, setF] = useState<Filter>({ tableSize: 'all', direction: 'all', pocketType: 'all', sessionType: 'all' });
  const [sel, setSel] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const variable = VARIABLES.find(v => v.id === varId)!;
  const filter: Filter = useMemo(() => {
    if (period === 'custom') return { ...f, from: from ? new Date(from + 'T00:00').toISOString() : undefined, to: to ? new Date(to + 'T23:59:59').toISOString() : undefined };
    if (period === 'all') return f;
    const d = new Date(); d.setDate(d.getDate() - Number(period));
    return { ...f, from: d.toISOString() };
  }, [f, period, from, to]);
  const inView = useMemo(() => applyFilter(data.shotList, filter), [data.shotList, filter]);
  const h = useMemo(() => histogram(inView, data.exclusions, variable), [inView, data.exclusions, variable]);

  if (!data.shots.size) return <Empty onGo={onGo} />;

  const set = (k: keyof Filter) => (e: Event) => { setF({ ...f, [k]: (e.target as HTMLSelectElement).value }); setSel(null); };
  const types = [...new Set(data.shotList.map(s => s.sessionType))];
  const overall = h.totals.valid ? h.totals.makes / h.totals.valid : null;
  const u = !variable.unit ? '' : variable.unit === '°' ? '°' : ` ${variable.unit}`;

  return (
    <section>
      <h2>Data</h2>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="var(--excluded)" opacity="0.35" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--excluded)" stroke-width="2" />
          </pattern>
        </defs>
      </svg>

      <p class="lede">How your shots are spread across each measurement, what the cleaning rules removed, and how often you made the shots that remain.</p>

      <div class="chips" role="group" aria-label="Measurement">
        {VARIABLES.map(v => <button key={v.id} aria-pressed={v.id === varId} onClick={() => { setVarId(v.id); setSel(null); }}>{v.label}</button>)}
      </div>

      <div class="controls">
        <label>Period
          <select value={period} onChange={e => { setPeriod((e.target as HTMLSelectElement).value as Period); setSel(null); }}>
            <option value="all">All time</option><option value="365">Last 12 months</option>
            <option value="90">Last 90 days</option><option value="30">Last 30 days</option><option value="custom">Custom…</option>
          </select>
        </label>
        {period === 'custom' && <>
          <label>From<input type="date" value={from} max={to || localYmd(new Date())} onChange={e => setFrom((e.target as HTMLInputElement).value)} /></label>
          <label>To<input type="date" value={to} min={from} onChange={e => setTo((e.target as HTMLInputElement).value)} /></label>
        </>}
        <label>Table<select value={f.tableSize} onChange={set('tableSize')}><option value="all">Any</option><option value="9ft">9-ft</option><option value="7ft">7-ft</option></select></label>
        <label>Cut direction<select value={f.direction} onChange={set('direction')}><option value="all">Both</option><option value="LEFT">Left</option><option value="RIGHT">Right</option></select></label>
        <label>Pocket<select value={f.pocketType} onChange={set('pocketType')}><option value="all">Any</option><option value="CORNER">Corner</option><option value="SIDE">Side</option></select></label>
        <label>Session type<select value={f.sessionType} onChange={set('sessionType')}><option value="all">Any</option>{types.map(t => <option key={t} value={t}>{t}</option>)}</select></label>
      </div>

      <div class="card">
        <dl class="facts">
          <div><dt>Shots in view</dt><dd>{int(h.totals.all)}</dd></div>
          <div><dt>Kept</dt><dd>{int(h.totals.valid)}</dd></div>
          <div><dt>Made (kept)</dt><dd>{pct(overall)}</dd></div>
          {h.quantiles && <div><dt>Median, middle 80%</dt><dd class="num" style={{ fontSize: '1.05rem' }}>{fmtVal(h.quantiles.p50)}{u} <span class="muted" style={{ fontWeight: 400 }}>({fmtVal(h.quantiles.p10)}–{fmtVal(h.quantiles.p90)})</span></dd></div>}
        </dl>
        {h.missing.all > 0 && <p class="small muted" style={{ margin: '10px 0 0' }}>{int(h.missing.all)} shots have no {variable.label.toLowerCase()} value and are not plotted.</p>}

        <div class="row" style={{ marginTop: '14px' }}>
          <div class="legend" style={{ margin: 0 }}>
            <span><i class="swatch" style={{ background: 'var(--kept)' }} />Kept</span>
            <span><svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" rx="3" fill="url(#hatch)" /></svg>Excluded by a rule</span>
          </div>
          <span class="spacer" />
          <div class="seg" role="group" aria-label="View">
            <button aria-pressed={!asTable} onClick={() => setAsTable(false)}>Chart</button>
            <button aria-pressed={asTable} onClick={() => setAsTable(true)}>Table</button>
          </div>
        </div>

        {h.totals.all === 0 ? <p class="muted">No shots match these filters.</p>
          : asTable ? <BinTable h={h} />
          : <Charts h={h} overall={overall} sel={sel} onSel={setSel} />}

        {sel != null && h.bins[sel] && !asTable && <BinDetail bin={h.bins[sel]} unit={u} shots={inView} data={data} get={variable.get} />}
      </div>
    </section>
  );
}

const fmtVal = (x: number) => (Number.isInteger(x) || Math.abs(x) >= 10 ? x.toFixed(0) : x.toFixed(1));

const M = { l: 40, r: 8 };

function Charts({ h, overall, sel, onSel }: { h: Histogram; overall: number | null; sel: number | null; onSel: (i: number | null) => void }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const n = h.bins.length;
  const band = (W - M.l - M.r) / n;
  const bw = Math.max(3, Math.min(24, band - 2));
  const cx = (i: number) => M.l + band * i + band / 2;
  const maxAll = Math.max(1, ...h.bins.map(b => b.all));
  const step = niceStep(maxAll);
  const top = Math.ceil(maxAll / step) * step;

  // ---- panel A geometry
  const HA = 170, padT = 8, padB = 22;
  const yA = (v: number) => padT + (HA - padT - padB) * (1 - v / top);
  // label every k-th bin so x labels never collide
  const every = Math.max(1, Math.ceil(42 / band));

  // Kept-share labels: lowest retention first; skip any that would collide with one already placed.
  const keptLabels = new Set<number>();
  {
    const placed: [number, number][] = [];
    const cand = h.bins.map((b, i) => ({ b, i })).filter(({ b }) => b.all >= 5 && b.retained != null && b.retained < 0.95)
      .sort((a, z) => a.b.retained! - z.b.retained!);
    for (const { b, i } of cand) {
      const half = (pct(b.retained).length * 6.6) / 2 + 2;
      const lo = cx(i) - half, hi = cx(i) + half;
      if (placed.every(([a, z]) => hi < a || lo > z)) { placed.push([lo, hi]); keptLabels.add(i); }
    }
  }

  // ---- panel B geometry
  const HB = 150, bT = 8, bB = 22;
  const yB = (p: number) => bT + (HB - bT - bB) * (1 - p);

  const hits = (H: number) => h.bins.map((b, i) => (
    <rect key={i} class="hit" x={M.l + band * i} y={0} width={band} height={H}
      onMouseEnter={() => onSel(i)} onClick={() => onSel(sel === i ? null : i)}>
      <title>{b.label}</title>
    </rect>
  ));
  const xLabels = (H: number) => h.bins.map((b, i) => (i % every === 0 || i === n - 1) && (
    <text key={i} x={cx(i)} y={H - 6} text-anchor="middle">{b.hi == null ? b.label : fmtVal(h.variable.integer ? b.lo + 0.5 : b.lo)}</text>
  ));

  return (
    <div ref={ref}>

      <div class="panel-title">Shots per bin <span class="muted" style={{ fontWeight: 400 }}>(a percentage above a bar is the share kept, shown where rules removed more than 5%)</span></div>
      <svg class="chart" width={W} height={HA} role="img" aria-label={`Histogram of ${h.variable.label}: kept and excluded shots per bin`}>
        {sel != null && <rect class="sel" x={M.l + band * sel} y={0} width={band} height={HA - padB} />}
        {ticks(top, step).map(t => <g key={t}><line class="tick" x1={M.l} x2={W - M.r} y1={yA(t)} y2={yA(t)} /><text x={M.l - 6} y={yA(t) + 4} text-anchor="end">{compact(t)}</text></g>)}
        {h.bins.map((b, i) => {
          const x = cx(i) - bw / 2;
          const yk = yA(b.valid), ya = yA(b.all);
          const ex = b.all - b.valid;
          return (
            <g key={i}>
              {b.valid > 0 && <path d={colPath(x, yk, bw, yA(0) - yk, ex === 0)} fill="var(--kept)" />}
              {ex > 0 && <path d={colPath(x, ya, bw, Math.max(1, yk - ya - (b.valid > 0 ? 2 : 0)), true)} fill="url(#hatch)" />}
              {keptLabels.has(i) && <text x={cx(i)} y={ya - 5} text-anchor="middle" class="label-ink">{pct(b.retained)}</text>}
            </g>
          );
        })}
        <line class="axis" x1={M.l} x2={W - M.r} y1={yA(0)} y2={yA(0)} />
        {xLabels(HA)}
        {hits(HA - padB)}
      </svg>

      <div class="panel-title">Made, among kept shots <span class="muted" style={{ fontWeight: 400 }}>(dot = rate, bar = 95% range; hollow under 30 shots)</span></div>
      <svg class="chart" width={W} height={HB} role="img" aria-label={`Make rate by ${h.variable.label} with 95% intervals`}>
        {sel != null && <rect class="sel" x={M.l + band * sel} y={0} width={band} height={HB - bB} />}
        {[0, 0.25, 0.5, 0.75, 1].map(p => <g key={p}><line class="tick" x1={M.l} x2={W - M.r} y1={yB(p)} y2={yB(p)} /><text x={M.l - 6} y={yB(p) + 4} text-anchor="end">{p * 100}%</text></g>)}
        {overall != null && <g>
          <line x1={M.l} x2={W - M.r} y1={yB(overall)} y2={yB(overall)} stroke="var(--ink-2)" stroke-width="1" opacity="0.6" />
          <text x={W - M.r} y={yB(overall) - 4} text-anchor="end" class="label-ink">all kept {pct(overall)}</text>
        </g>}
        {h.bins.map((b, i) => {
          if (b.valid < 5 || b.makeRate == null) return null;
          const ci = wilson(b.makes, b.valid)!;
          const solid = b.valid >= 30;
          return (
            <g key={i}>
              <line x1={cx(i)} x2={cx(i)} y1={yB(ci[0])} y2={yB(ci[1])} stroke="var(--kept)" stroke-width="2" stroke-linecap="round" opacity="0.55" />
              <circle cx={cx(i)} cy={yB(b.makeRate)} r={4.5} fill={solid ? 'var(--kept)' : 'var(--card)'} stroke={solid ? 'var(--card)' : 'var(--kept)'} stroke-width="2" />
            </g>
          );
        })}
        <line class="axis" x1={M.l} x2={W - M.r} y1={yB(0)} y2={yB(0)} />
        {xLabels(HB)}
        {hits(HB - bB)}
      </svg>
      <p class="small muted" style={{ margin: '4px 0 0' }}>
        {h.variable.label}{h.variable.unit && ` (${h.variable.unit})`}, lower edge of each bin. Tap a bin for its numbers. Bins with fewer than 5 kept shots have no dot.
      </p>
    </div>
  );
}

/** Column path: rounded 4px data-end on top, square at the baseline. */
function colPath(x: number, y: number, w: number, hgt: number, roundTop: boolean) {
  if (hgt <= 0) return '';
  const r = roundTop ? Math.min(4, w / 2, hgt) : 0;
  return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
}
function niceStep(max: number) {
  const raw = max / 4, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
const ticks = (top: number, step: number) => Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K` : String(n));

function BinDetail({ bin, unit, shots, data, get }: { bin: Bin; unit: string; shots: Shot[]; data: AppData; get: (s: Shot) => number | null }) {
  const inBin = shots.filter(s => { const x = get(s); return x != null && x >= bin.lo && (bin.hi == null || x < bin.hi); });
  const reasons = new Map<RuleId, number>();
  for (const s of inBin) for (const r of data.exclusions.get(s.shotId) ?? []) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  const ci = wilson(bin.makes, bin.valid);
  const label = (id: RuleId) => RULES.find(r => r.id === id)!.label.toLowerCase();
  return (
    <div class="bin-detail" aria-live="polite">
      <b>{bin.hi == null ? bin.label : `${bin.label}`}{unit}</b>
      <div class="num">
        {int(bin.all)} shots; {int(bin.valid)} kept ({pct(bin.retained)}).
        {bin.valid > 0 && <> Made {int(bin.makes)}, {pct(bin.makeRate)}{ci && bin.valid >= 5 && <> (95% range {pct(ci[0])}–{pct(ci[1])})</>}.</>}
      </div>
      {reasons.size > 0 && <div class="muted">Excluded: {[...reasons].map(([r, c]) => `${int(c)} ${label(r)}`).join(', ')}.</div>}
    </div>
  );
}

function BinTable({ h }: { h: Histogram }) {
  return (
    <div class="scroll-x">
      <table>
        <thead><tr><th>{h.variable.label}{h.variable.unit && ` (${h.variable.unit})`}</th><th class="n">Shots</th><th class="n">Kept</th><th class="n">Kept %</th><th class="n">Made %</th><th class="n">95% range</th></tr></thead>
        <tbody>
          {h.bins.map((b, i) => {
            const ci = b.valid >= 5 ? wilson(b.makes, b.valid) : null;
            return (
              <tr key={i}>
                <td>{b.label}</td><td class="n">{int(b.all)}</td><td class="n">{int(b.valid)}</td>
                <td class="n">{pct(b.retained)}</td><td class="n">{pct(b.makeRate)}</td>
                <td class="n">{ci ? `${pct(ci[0])}–${pct(ci[1])}` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
