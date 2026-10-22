import type { ComponentChildren } from 'preact';

// A small hand-written SVG time chart: session dots, an optional rolling line with
// a band, an optional dashed second line, a reference line, the baseline freeze
// date and numbered note markers. Times are epoch milliseconds.

export interface TDot { t: number; y: number; r?: number; hollow?: boolean; key: string | number }
export interface TPt { t: number; y: number | null }
export interface TBand { t: number; lo: number | null; hi: number | null }
export interface TMarker { t: number; n: number; title: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthTicks(t0: number, t1: number, maxTicks: number) {
  const span = (t1 - t0) / (30.4 * 86400000);
  const step = [1, 2, 3, 6, 12].find(s => span / s <= maxTicks) ?? 12;
  const d = new Date(t0); d.setDate(1); d.setHours(0, 0, 0, 0);
  while (d.getMonth() % step) d.setMonth(d.getMonth() + 1);
  const out: { t: number; label: string }[] = [];
  for (; d.getTime() <= t1; d.setMonth(d.getMonth() + step)) {
    if (d.getTime() < t0) continue;
    const m = d.getMonth();
    out.push({ t: d.getTime(), label: m === 0 || !out.length ? `${MONTHS[m]} ${String(d.getFullYear()).slice(2)}` : MONTHS[m] });
  }
  return out;
}

/** Group note markers whose flags would overlap into one flag ("1, 2"). */
function clusterMarkers(ms: TMarker[], X: (t: number) => number, gap: number) {
  const sorted = [...ms].sort((a, b) => a.t - b.t);
  const out: { x: number; xs: number[]; label: string; titles: string[]; w: number }[] = [];
  let cur: TMarker[] = [];
  const flush = () => {
    if (!cur.length) return;
    const xs = cur.map(m => X(m.t)), nums = cur.map(m => m.n);
    const label = nums.length > 2 ? `${nums[0]}–${nums[nums.length - 1]}` : nums.join(', ');
    out.push({ x: (xs[0] + xs[xs.length - 1]) / 2, xs, label, titles: cur.map(m => m.title), w: Math.max(15, 6 + label.length * 6) });
    cur = [];
  };
  for (const m of sorted) { if (cur.length && X(m.t) - X(cur[cur.length - 1].t) >= gap) flush(); cur.push(m); }
  flush();
  return out;
}

/** Split a series at nulls into drawable runs. */
function runs<T>(xs: T[], ok: (x: T) => boolean): T[][] {
  const out: T[][] = []; let cur: T[] = [];
  for (const x of xs) { if (ok(x)) cur.push(x); else if (cur.length) { out.push(cur); cur = []; } }
  if (cur.length) out.push(cur);
  return out;
}

export function TimeChart(props: {
  width: number; height?: number; compact?: boolean;
  t0: number; t1: number; y0: number; y1: number; yTicks?: number[]; yFmt?: (v: number) => string;
  dots?: TDot[]; line?: TPt[]; line2?: TPt[]; band?: TBand[]; refY?: number; refLabel?: string;
  freeze?: number | null; markers?: TMarker[]; selected?: string | number | null;
  onPick?: (key: string | number) => void; label: string; children?: ComponentChildren;
}) {
  const { width: W, compact } = props;
  const H = props.height ?? (compact ? 70 : 230);
  const L = compact ? 4 : 40, R = compact ? 4 : 10, T = compact ? 6 : (props.markers?.length ? 22 : 10), B = compact ? 6 : 24;
  const X = (t: number) => L + ((t - props.t0) / (props.t1 - props.t0 || 1)) * (W - L - R);
  const Y = (v: number) => T + (1 - (Math.max(props.y0, Math.min(props.y1, v)) - props.y0) / (props.y1 - props.y0 || 1)) * (H - T - B);
  const fmt = props.yFmt ?? (v => String(v));
  const path = (pts: { t: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');

  function pick(e: MouseEvent) {
    if (!props.onPick || !props.dots?.length) return;
    const svg = e.currentTarget as SVGSVGElement, r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    let best = props.dots[0], bd = Infinity;
    for (const d of props.dots) { const dd = Math.abs(X(d.t) - x); if (dd < bd) { bd = dd; best = d; } }
    if (bd < 24) props.onPick(best.key);
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" class={`tchart ${compact ? 'compact' : ''}`} role="img" aria-label={props.label}
      onClick={pick} style={{ cursor: props.onPick ? 'pointer' : undefined }}>
      {!compact && (props.yTicks ?? []).map(v => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} class="grid" />
          <text x={L - 5} y={Y(v) + 3.5} class="tick" text-anchor="end">{fmt(v)}</text>
        </g>
      ))}
      {!compact && monthTicks(props.t0, props.t1, Math.max(3, Math.floor((W - L - R) / 62))).map(m => (
        <g key={m.t}>
          <line x1={X(m.t)} x2={X(m.t)} y1={H - B} y2={H - B + 4} class="axis" />
          <text x={X(m.t)} y={H - B + 15} class="tick" text-anchor="middle">{m.label}</text>
        </g>
      ))}
      {props.refY != null && <line x1={L} x2={W - R} y1={Y(props.refY)} y2={Y(props.refY)} class="ref" />}
      {props.refY != null && props.refLabel && !compact && <text x={W - R - 2} y={Y(props.refY) - 4} class="tick ref-label" text-anchor="end">{props.refLabel}</text>}
      {props.freeze != null && props.freeze >= props.t0 && props.freeze <= props.t1 && (
        <g>
          <line x1={X(props.freeze)} x2={X(props.freeze)} y1={T} y2={H - B} class="freeze" />
          {!compact && X(props.freeze) > L + 60 && X(props.freeze) < W - R - 40 && <text x={X(props.freeze) - 3} y={T + 9} class="tick freeze-label" text-anchor="end">frozen</text>}
        </g>
      )}
      {clusterMarkers(props.markers ?? [], X, compact ? 0 : 17).map(c => (
        <g key={c.label} class="marker">
          <title>{c.titles.join('\n')}</title>
          {c.xs.map((x, i) => <line key={i} x1={x} x2={x} y1={compact ? T : T - 4} y2={H - B} />)}
          {!compact && <rect x={c.x - c.w / 2} y={T - 18.5} width={c.w} height={15} rx={7.5} />}
          {!compact && <text x={c.x} y={T - 7.5} text-anchor="middle">{c.label}</text>}
        </g>
      ))}
      {props.band && runs(props.band, b => b.lo != null && b.hi != null).map((r, i) => (
        <path key={i} class="band" d={`${r.map((b, j) => `${j ? 'L' : 'M'}${X(b.t).toFixed(1)},${Y(b.hi!).toFixed(1)}`).join('')}${[...r].reverse().map(b => `L${X(b.t).toFixed(1)},${Y(b.lo!).toFixed(1)}`).join('')}Z`} />
      ))}
      {(props.dots ?? []).map(d => {
        const clipped = d.y > props.y1 || d.y < props.y0;
        return <circle key={d.key} cx={X(d.t)} cy={Y(d.y)} r={d.r ?? 3} class={`dot ${d.hollow ? 'hollow' : ''} ${clipped ? 'clipped' : ''} ${props.selected === d.key ? 'sel' : ''}`} />;
      })}
      {props.line2 && runs(props.line2, p => p.y != null).map((r, i) => <path key={i} class="line2" d={path(r as { t: number; y: number }[])} />)}
      {props.line && runs(props.line, p => p.y != null).map((r, i) => <path key={i} class="line" d={path(r as { t: number; y: number }[])} />)}
      {props.children}
    </svg>
  );
}
