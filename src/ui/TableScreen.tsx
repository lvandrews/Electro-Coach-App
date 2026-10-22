import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AppData, Tab } from '../app';
import {
  buildHeatMap, chancesAt, contour, fitHeatModel, heatRows, pocketsOf, rowsInPeriod, similarPositions, TABLES,
  type CutChoice, type HeatMap,
} from '../engine/heatmap';
import type { ModelFit, ModelRow } from '../engine/model';
import { Empty } from './SessionsScreen';
import { int, pct } from './format';
import { usePrefs, type HeatPalette } from './prefs';

// ---------- periods ----------

type PeriodId = 'all' | '365' | '90' | 'before90';
const PERIODS: { id: PeriodId; label: string }[] = [
  { id: 'all', label: 'All time' }, { id: '365', label: 'Last 12 months' }, { id: '90', label: 'Last 90 days' }, { id: 'before90', label: 'Before the last 90 days' },
];
function periodRange(id: PeriodId): [string | undefined, string | undefined] {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
  if (id === '365') return [daysAgo(365), undefined];
  if (id === '90') return [daysAgo(90), undefined];
  if (id === 'before90') return [undefined, daysAgo(90)];
  return [undefined, undefined];
}
const MIN_SHOTS = 400;

// ---------- cached fits ----------

let fitCache: { key: unknown; rows: ModelRow[]; fits: Map<PeriodId, { fit: ModelFit; rows: ModelRow[] } | string> } | null = null;
function fitFor(data: AppData, period: PeriodId) {
  if (fitCache?.key !== data.exclusions) fitCache = { key: data.exclusions, rows: heatRows(data.shotList, data.exclusions), fits: new Map() };
  const c = fitCache;
  if (!c.fits.has(period)) {
    const [from, to] = periodRange(period);
    const rows = rowsInPeriod(c.rows, from, to);
    try { c.fits.set(period, rows.length < MIN_SHOTS ? `Only ${int(rows.length)} kept shots in this period; the map needs at least ${MIN_SHOTS}.` : { fit: fitHeatModel(rows), rows }); }
    catch (e) { c.fits.set(period, e instanceof Error ? e.message : String(e)); }
  }
  return c.fits.get(period)!;
}

// ---------- color scale: absolute. Default red (rarely made) → orange → yellow → green (near-certain) ----------

const PALETTES: Record<HeatPalette, [number, string][]> = {
  'green-red': [
    [0.0, '#7f1d1d'], [0.2, '#c62828'], [0.35, '#e8572a'], [0.45, '#f28c28'], [0.55, '#f7b733'],
    [0.65, '#f2dc4b'], [0.72, '#c9dc5a'], [0.8, '#8cc65a'], [0.88, '#4ea852'], [1.0, '#1e7a3c'],
  ],
  // Viridis: readable with any color vision, dark purple (hard) to yellow (easy).
  viridis: [
    [0.0, '#440154'], [0.13, '#482878'], [0.25, '#3e4a89'], [0.38, '#31688e'], [0.5, '#26828e'],
    [0.63, '#1f9e89'], [0.75, '#35b779'], [0.88, '#6ece58'], [1.0, '#fde725'],
  ],
};
const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const STOP_RGB = Object.fromEntries(Object.entries(PALETTES).map(([k, v]) => [k, v.map(([p, h]) => [p, hex(h)] as const)])) as Record<HeatPalette, (readonly [number, number[]])[]>;
export function heatColor(p: number, palette: HeatPalette = 'green-red'): number[] {
  const S = STOP_RGB[palette];
  const x = Math.max(0, Math.min(1, p));
  let k = 1; while (k < S.length - 1 && S[k][0] < x) k++;
  const [p0, a] = S[k - 1], [p1, b] = S[k], t = (x - p0) / (p1 - p0 || 1);
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}
const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;

// ---------- screen ----------

export function TableScreen({ data, onGo }: { data: AppData; onGo: (t: Tab) => void }) {
  const [size, setSize] = useState<'9ft' | '7ft'>('9ft');
  const [cut, setCut] = useState<CutChoice>('usual');
  const [period, setPeriod] = useState<PeriodId>('all');
  const [compare, setCompare] = useState(false);
  const [period2, setPeriod2] = useState<PeriodId>('before90');
  const [pick, setPick] = useState<[number, number] | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => { setReady(false); const t = setTimeout(() => setReady(true), 30); return () => clearTimeout(t); }, [data.exclusions]);
  useEffect(() => setPick(null), [size]);

  const A = useMemo(() => (ready ? fitFor(data, period) : null), [ready, data.exclusions, period]);
  const B = useMemo(() => (ready && compare ? fitFor(data, period2) : null), [ready, compare, data.exclusions, period2]);
  const mapA = useMemo(() => (A && typeof A !== 'string' ? buildHeatMap(A.fit, A.rows, size, cut) : null), [A, size, cut]);
  const mapB = useMemo(() => (B && typeof B !== 'string' ? buildHeatMap(B.fit, B.rows, size, cut) : null), [B, size, cut]);

  if (!data.shots.size) return <Empty onGo={onGo} />;
  const t = TABLES[size];
  const spot: [number, number] = [t.w / 2, t.h / 4];
  const at = pick ?? spot;
  const mid = mapA?.mean ?? 0.65;

  return (
    <section>
      <h2>Table</h2>
      <p class="lede">Your chance of potting from each spot into its best pocket; tap anywhere on the table.</p>

      <div class="controls">
        <label>Table<select value={size} onChange={e => setSize((e.target as HTMLSelectElement).value as '9ft' | '7ft')}><option value="9ft">9-ft</option><option value="7ft">7-ft</option></select></label>
        <label>Cut angle<select value={String(cut)} onChange={e => { const v = (e.target as HTMLSelectElement).value; setCut(v === 'usual' ? 'usual' : (Number(v) as CutChoice)); }}>
          <option value="usual">Your usual mix</option><option value="10">About 10°</option><option value="30">About 30°</option><option value="45">About 45°</option><option value="60">About 60°</option>
        </select></label>
        <label>Period<select value={period} onChange={e => setPeriod((e.target as HTMLSelectElement).value as PeriodId)}>{PERIODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        {compare && <label>Compare with<select value={period2} onChange={e => setPeriod2((e.target as HTMLSelectElement).value as PeriodId)}>{PERIODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>}
      </div>
      <label class="small switch-row" style={{ marginBottom: '10px' }}>
        <input type="checkbox" checked={compare} onChange={() => { if (!compare && period === 'all') { setPeriod('90'); setPeriod2('before90'); } setCompare(!compare); }} /> Compare two periods side by side
      </label>

      {!ready || !A ? <p class="muted">Building the map…</p>
        : typeof A === 'string' ? <div class="notice">{A}</div>
        : (
          <div class="card">
            <div class={compare ? 'heat-pair' : 'heat-single'}>
              <HeatPanel map={mapA!} mid={mid} at={at} picked={!!pick} onPick={setPick}
                title={compare ? PERIODS.find(p => p.id === period)!.label : undefined} n={A.rows.length} />
              {compare && (typeof B === 'string' ? <div class="notice">{B}</div>
                : mapB && <HeatPanel map={mapB} mid={mid} at={at} picked={!!pick} onPick={setPick} title={PERIODS.find(p => p.id === period2)!.label} n={B!.rows.length} />)}
            </div>
            <Legend mid={mid} />
            <Readout data={data} A={A} mapA={mapA!} B={B && typeof B !== 'string' ? B : null} mapB={mapB} at={at} isSpot={!pick} cut={cut}
              labelA={PERIODS.find(p => p.id === period)!.label} labelB={PERIODS.find(p => p.id === period2)!.label} />
          </div>
        )}

      {mapA && <Notes map={mapA} />}
    </section>
  );
}

// ---------- the map ----------

const RAIL = 4.2, PAD = 1.2;

function HeatPanel({ map, mid, at, picked, onPick, title, n }: {
  map: HeatMap; mid: number; at: [number, number]; picked: boolean; onPick: (p: [number, number]) => void; title?: string; n: number;
}) {
  const t = map.table;
  const W = t.w + 2 * (RAIL + PAD), H = t.h + 2 * (RAIL + PAD);
  const X = (x: number) => RAIL + PAD + x, Y = (y: number) => RAIL + PAD + (t.h - y);

  const { heat: palette } = usePrefs();
  // heat image: one pixel per grid cell, smoothed by the browser when scaled
  const img = useMemo(() => {
    if (typeof document === 'undefined') return '';
    const c = document.createElement('canvas'); c.width = map.cols; c.height = map.rows;
    const ctx = c.getContext('2d'); if (!ctx) return '';
    const im = ctx.createImageData(map.cols, map.rows);
    for (let j = 0; j < map.rows; j++) for (let i = 0; i < map.cols; i++) {
      const v = map.values[j * map.cols + i], col = heatColor(v, palette), o = ((map.rows - 1 - j) * map.cols + i) * 4;
      im.data[o] = col[0]; im.data[o + 1] = col[1]; im.data[o + 2] = col[2]; im.data[o + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
    return c.toDataURL();
  }, [map, palette]);

  const levels = [0.5, 0.6, 0.7, 0.75];
  const lines = useMemo(() => levels.map(l => ({ l, segs: contour(map, l) })), [map]);
  const label = (segs: [number, number][][]) => {
    // label each contour where it crosses nearest the middle of the table's long axis
    let best: [number, number] | null = null, bd = Infinity;
    for (const [a, b] of segs) { if (Math.min(a[0], b[0]) < 7 || Math.max(a[0], b[0]) > t.w - 7 || Math.min(a[1], b[1]) < 4 || Math.max(a[1], b[1]) > t.h - 4) continue; const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; const d = Math.abs(mx - t.w / 2) + Math.abs(my - t.h * 0.62) * 0.3; if (d < bd) { bd = d; best = [mx, my]; } }
    return best;
  };
  const sides = pocketsOf(t).filter(p => p.side);
  const ray = (p: typeof sides[number], deg: number, len: number) => {
    const r = (deg * Math.PI) / 180, [nx, ny] = p.normal;
    return [p.at, [p.at[0] + len * (nx * Math.cos(r) - ny * Math.sin(r)), p.at[1] + len * (nx * Math.sin(r) + ny * Math.cos(r))]] as [number, number][];
  };
  const diamonds: [number, number][] = [];
  for (let k = 1; k < 8; k++) if (k !== 4) { diamonds.push([-RAIL / 2, k * t.diamond], [t.w + RAIL / 2, k * t.diamond]); }
  for (const k of [1, 2, 3]) diamonds.push([k * t.diamond, -RAIL / 2], [k * t.diamond, t.h + RAIL / 2]);

  function tap(e: MouseEvent) {
    const svg = e.currentTarget as SVGSVGElement, pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const m = svg.getScreenCTM(); if (!m) return;
    const q = pt.matrixTransform(m.inverse());
    const x = q.x - RAIL - PAD, y = t.h - (q.y - RAIL - PAD), R = 1.125;
    if (x < -1 || y < -1 || x > t.w + 1 || y > t.h + 1) return;
    onPick([Math.round(Math.max(R, Math.min(t.w - R, x)) * 4) / 4, Math.round(Math.max(R, Math.min(t.h - R, y)) * 4) / 4]);
  }

  return (
    <figure class="heat-fig">
      {title && <figcaption><b>{title}</b> <span class="muted num">· {int(n)} shots</span></figcaption>}
      <svg viewBox={`0 0 ${W} ${H}`} class="table-dia heat" role="img" aria-label={`Make chance across the ${t.size === '9ft' ? '9-ft' : '7-ft'} table`} onClick={tap} style={{ cursor: 'crosshair' }}>
        <rect x={PAD} y={PAD} width={t.w + 2 * RAIL} height={t.h + 2 * RAIL} rx={2.4} fill="#4a3123" />
        <clipPath id={`cloth-${t.size}-${title ?? 'a'}`}><rect x={X(0)} y={Y(t.h)} width={t.w} height={t.h} /></clipPath>
        <g clip-path={`url(#cloth-${t.size}-${title ?? 'a'})`}>
          <rect x={X(0)} y={Y(t.h)} width={t.w} height={t.h} fill="#f0efec" />
          {img && <image href={img} x={X(1.125 - map.cell / 2)} y={Y(t.h - 1.125 + map.cell / 2)} width={t.w - 2.25 + map.cell} height={t.h - 2.25 + map.cell} preserveAspectRatio="none" />}
          {lines.map(({ l, segs }) => (
            <g key={l}>
              <path d={segs.map(([a, b]) => `M${X(a[0]).toFixed(2)},${Y(a[1]).toFixed(2)}L${X(b[0]).toFixed(2)},${Y(b[1]).toFixed(2)}`).join('')}
                class="contour" stroke-width={l === 0.75 ? 0.45 : 0.3} stroke-dasharray={l === 0.5 ? '0.8 0.8' : undefined} />
            </g>
          ))}
          {lines.map(({ l, segs }) => { const p = label(segs); return p && <text key={l} x={X(p[0])} y={Y(p[1]) + 0.7} class="contour-label" text-anchor="middle">{Math.round(l * 100)}%</text>; })}
          <line x1={X(0)} x2={X(t.w)} y1={Y(t.h * 0.75)} y2={Y(t.h * 0.75)} stroke="#1b1b1b" stroke-width={0.18} stroke-dasharray="1 1" opacity={0.35} />
        </g>
        {sides.flatMap(p => [-1, 1].flatMap(sg => ([[45, '#2ea043'], [55, '#d99a12'], [65, '#d1342f']] as const).map(([d, c]) => {
          const [a, b] = ray(p, sg * d, 13);
          return <line key={`${p.name}${sg}${d}`} x1={X(a[0])} y1={Y(a[1])} x2={X(b[0])} y2={Y(b[1])} stroke={c} stroke-width={0.4} />;
        })))}
        {diamonds.map(([x, y], i) => <path key={i} d={`M${X(x)},${Y(y) - 0.7} L${X(x) + 0.55},${Y(y)} L${X(x)},${Y(y) + 0.7} L${X(x) - 0.55},${Y(y)} Z`} fill="#efe4cc" />)}
        {pocketsOf(t).map(p => <circle key={p.name} cx={X(p.at[0])} cy={Y(p.at[1])} r={p.side ? 2.3 : 2.6} fill="#111" />)}
        {/* 9 on the foot spot */}
        <circle cx={X(t.w / 2)} cy={Y(t.h / 4)} r={1.125} fill="#f2c230" stroke="#1a1a1a" stroke-width={0.18} />
        <circle cx={X(t.w / 2)} cy={Y(t.h / 4)} r={0.5} fill="#fbfbf7" />
        <text x={X(t.w / 2)} y={Y(t.h / 4) + 0.33} class="dia-num" text-anchor="middle">9</text>
        {picked && <g class="pick">
          <circle cx={X(at[0])} cy={Y(at[1])} r={1.125} fill="#fbfbf7" stroke="#1a1a1a" stroke-width={0.25} />
          <circle cx={X(at[0])} cy={Y(at[1])} r={2.4} fill="none" stroke="#1a1a1a" stroke-width={0.25} />
        </g>}
      </svg>
    </figure>
  );
}

function Legend({ mid }: { mid: number }) {
  const { heat: palette } = usePrefs();
  const stops = Array.from({ length: 21 }, (_, i) => i / 20);
  return (
    <div class="heat-legend">
      <div class="bar-wrap">
        <div class="bar" style={{ background: `linear-gradient(90deg, ${stops.map(p => `${rgb(heatColor(p, palette))} ${p * 100}%`).join(', ')})` }} />
        <div class="avg-mark" style={{ left: `${mid * 100}%` }} title={`Your average on this table: ${pct(mid)}`} />
      </div>
      <div class="ticks small num"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
      <div class="small">{palette === 'viridis' ? 'Yellow is close to certain, green and blue are harder, dark purple is rarely made.' : 'Green is close to certain, yellow and orange are harder, red is rarely made.'} Each spot uses the cut, cue-ball distance and speed of your usual shots.</div>
      <div class="small">▲ marks your actual make rate on this table: <b class="num">{pct(mid)}</b></div>
      <div class="small muted">Lines at 50% (dotted), 60%, 70% and 75% (heavier). Side-pocket rays: 45° green, 55° amber, 65° red.</div>
    </div>
  );
}

// ---------- readout for the tapped spot ----------

function Readout({ data, A, mapA, B, mapB, at, isSpot, cut, labelA, labelB }: {
  data: AppData; A: { fit: ModelFit; rows: ModelRow[] }; mapA: HeatMap; B: { fit: ModelFit; rows: ModelRow[] } | null; mapB: HeatMap | null;
  at: [number, number]; isSpot: boolean; cut: CutChoice; labelA: string; labelB: string;
}) {
  void data;
  const t = mapA.table;
  const chA = chancesAt(A.fit, mapA.mix, mapA.offset, t, at);
  const chB = B && mapB ? chancesAt(B.fit, mapB.mix, mapB.offset, t, at) : null;
  if (!chA.length) return null;
  const best = chA[0];
  const side = best.pocket.includes('side');
  const sim = similarPositions(A.rows, t.size, side, best.distIn, best.approach);
  const bestB = chB?.find(c => c.pocket === best.pocket);
  const fromLeft = at[0], fromFoot = at[1];
  return (
    <div class="readout">
      <div class="readout-head">
        <div>
          <div class="small muted">{isSpot ? '9 on the foot spot' : `Object ball ${fromLeft.toFixed(1)}″ from the left rail, ${fromFoot.toFixed(1)}″ from the foot rail`}</div>
          <div><span class="pred-big num" style={{ fontSize: '2.2rem' }}>{pct(best.p)}</span> <span>into the {best.pocket}{side ? ' pocket' : ' corner'}</span></div>
          <div class="small muted num">{best.distIn.toFixed(0)}″ to the pocket, approach {best.approach.toFixed(0)}°{cut !== 'usual' ? `, cut about ${cut}°` : ', your usual cuts'}</div>
        </div>
      </div>
      {chB && bestB && (
        <p class="small num" style={{ margin: '8px 0 0' }}>
          {labelA}: <b>{pct(best.p, 1)}</b> · {labelB}: <b>{pct(bestB.p, 1)}</b> · difference <b>{best.p - bestB.p >= 0 ? '+' : '−'}{Math.abs(100 * (best.p - bestB.p)).toFixed(1)} pts</b>
          <span class="muted"> Each period has its own fit, so a gap of two or three points can be noise; the Progress tab (next step) will put error bars on changes like this.</span>
        </p>
      )}
      {chA.length > 1 && (
        <p class="small" style={{ margin: '8px 0 0' }}>
          Other pockets: {chA.slice(1, 4).map(c => `${c.pocket} ${pct(c.p)}`).join(', ')}.
        </p>
      )}
      <p class="small" style={{ margin: '8px 0 0' }}>
        {sim.n >= 15
          ? <>Your record from positions like this: <b class="num">{sim.makes} of {sim.n}</b> ({pct(sim.rate)}).</>
          : <>Fewer than 15 recorded shots from positions like this ({sim.n}); the map is filling the gap.</>}
        <span class="muted"> Same table size and pocket type, within ±{sim.tol.dist}″ of distance and ±{sim.tol.approach}° of approach, any cut.</span>
      </p>
    </div>
  );
}

function Notes({ map }: { map: HeatMap }) {
  return (
    <details class="card">
      <summary>How the map is made</summary>
      <ul class="small" style={{ paddingLeft: '18px' }}>
        <li>Each spot shows the best pocket's chance. Distance to the pocket and approach angle come from the spot; cut angle, cue-ball distance and speed are averaged over your kept shots (or the cut is fixed to the angle you choose).</li>
        <li>It uses the step 2 model's terms with a smooth distance curve, a curved corner-approach term and separate side-pocket terms, refitted on this device ({int(map.modelShots)} shots). On 9-ft tables it matches your actual make rate within about 2 points on average across distance bands.</li>
        <li>{map.table.size === '7ft' ? '7-ft' : '9-ft'} map: {int(map.tableShots)} shots on this table size{map.tableShots < 100 ? ' (too few to adjust for this table; the map uses all tables)' : `, adjusted by ${map.offset >= 0 ? '+' : '−'}${Math.abs(map.offset).toFixed(2)} on the log-odds scale so its average matches what you actually make here`}.</li>
        <li>Straighter shots beat the map and thin cuts fall short of it: switch the cut angle to see by how much.</li>
        <li>Within about a foot of a corner at shallow approach angles the map reads about 7 points higher than your record. The model itself is close there; the gap is the shot mix. From those spots you tend to face thinner cuts with the cue ball farther away than your average shot, and the map assumes your average shot.</li>
      </ul>
    </details>
  );
}
