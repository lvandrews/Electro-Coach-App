import { useMemo } from 'preact/hooks';
import type { DiagramSpec } from '../engine/drills';
import { POCKETS, SPOTS, TABLE, type Pt } from '../engine/table';

// Drill diagram drawn from table coordinates (inches). Head rail at the top.
// The table is a physical object, so its cloth, rails and ball colors stay the
// same in light and dark themes; text outside the table uses theme tokens.

const RAIL = 4.2;            // rail width drawn, inches
const PAD = 1.2;             // breathing room outside the rails
const VB_W = TABLE.w + 2 * (RAIL + PAD);
const VB_H = TABLE.h + 2 * (RAIL + PAD);

const X = (x: number) => RAIL + PAD + x;
const Y = (y: number) => RAIL + PAD + (TABLE.h - y);
const pts = (p: Pt[]) => p.map(([x, y]) => `${X(x).toFixed(2)},${Y(y).toFixed(2)}`).join(' ');

const PATH_STYLE: Record<string, { stroke: string; width: number; dash?: string; opacity?: number }> = {
  aim: { stroke: '#4c5a60', width: 0.35, dash: '1 0.8', opacity: 0.9 },
  ob: { stroke: '#d99a12', width: 0.45, dash: '1.6 0.8' },
  stun: { stroke: '#1f6fd1', width: 0.55 },
  roll: { stroke: '#d4552b', width: 0.55 },
  draw: { stroke: '#7b4cc4', width: 0.55 },
  guide: { stroke: '#f3ead3', width: 0.3, dash: '0.8 1', opacity: 0.55 },
};
const ZONE_FILL = { good: 'rgba(60,190,90,0.5)', caution: 'rgba(255,200,70,0.55)' };
const RAY_STROKE = { good: '#2ea043', caution: '#e3a008', bad: '#d1342f' };
const BALL_COLORS = ['#f2c230', '#2160c4', '#d23a2f', '#6b3fa0', '#f07a1f', '#1d8a4a', '#7a2b1b', '#1a1a1a', '#f2c230'];

interface Props {
  spec: DiagramSpec | null;
  title: string;
  maxWidth?: number;
  showLabels?: boolean;
  onTap?: (x: number, y: number) => void;
  sequence?: boolean;     // connect numbered balls in order (used only in the layout editor; ball numbers show the order elsewhere)
}

export function TableDiagram({ spec, title, maxWidth, showLabels = true, onTap, sequence }: Props) {
  const R = TABLE.ballR;
  const uid = useMemo(() => Math.random().toString(36).slice(2, 8), []);
  const diamonds: Pt[] = [];
  for (let y = 12.5; y < 100; y += 12.5) if (y !== 50) { diamonds.push([-RAIL / 2, y], [TABLE.w + RAIL / 2, y]); }
  for (const x of [12.5, 25, 37.5]) diamonds.push([x, -RAIL / 2], [x, TABLE.h + RAIL / 2]);

  const numbered = (spec?.balls ?? []).filter(b => b.num != null).sort((a, b) => a.num! - b.num!);

  function tap(e: MouseEvent) {
    if (!onTap) return;
    const svg = e.currentTarget as SVGSVGElement;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const m = svg.getScreenCTM(); if (!m) return;
    const p = pt.matrixTransform(m.inverse());
    const x = p.x - RAIL - PAD, y = TABLE.h - (p.y - RAIL - PAD);
    if (x < -1 || x > TABLE.w + 1 || y < -1 || y > TABLE.h + 1) return;
    onTap(Math.max(R, Math.min(TABLE.w - R, x)), Math.max(R, Math.min(TABLE.h - R, y)));
  }

  return (
    <svg class="table-dia" viewBox={`0 0 ${VB_W} ${VB_H}`} role="img" aria-label={title}
      style={{ maxWidth: maxWidth ? `${maxWidth}px` : undefined, cursor: onTap ? 'crosshair' : undefined }}
      onClick={onTap ? tap : undefined}>
      <title>{title}</title>
      {/* rails */}
      <rect x={PAD} y={PAD} width={TABLE.w + 2 * RAIL} height={TABLE.h + 2 * RAIL} rx={2.4} fill="#4a3123" />
      <rect x={PAD + 0.5} y={PAD + 0.5} width={TABLE.w + 2 * RAIL - 1} height={TABLE.h + 2 * RAIL - 1} rx={2} fill="none" stroke="#6b4a35" stroke-width={0.5} />
      {/* cloth */}
      <rect x={X(0)} y={Y(TABLE.h)} width={TABLE.w} height={TABLE.h} fill="#2f6f63" />
      <rect x={X(0)} y={Y(TABLE.h)} width={TABLE.w} height={TABLE.h} fill="none" stroke="#24574d" stroke-width={0.6} />
      {/* head string and spots */}
      <line x1={X(0)} x2={X(TABLE.w)} y1={Y(SPOTS.headString)} y2={Y(SPOTS.headString)} stroke="#cfe3dc" stroke-width={0.22} stroke-dasharray="1 1" opacity={0.6} />
      {[SPOTS.head, SPOTS.center, SPOTS.foot].map(([x, y], i) => <circle key={i} cx={X(x)} cy={Y(y)} r={0.4} fill="#cfe3dc" opacity={0.75} />)}
      {/* diamonds */}
      {diamonds.map(([x, y], i) => (
        <path key={i} d={`M${X(x)},${Y(y) - 0.7} L${X(x) + 0.55},${Y(y)} L${X(x)},${Y(y) + 0.7} L${X(x) - 0.55},${Y(y)} Z`} fill="#efe4cc" />
      ))}
      {/* pockets */}
      {Object.entries(POCKETS).map(([k, [x, y]]) => (
        <circle key={k} cx={X(x)} cy={Y(y)} r={k === 'ML' || k === 'MR' ? 2.3 : 2.6} fill="#111" />
      ))}

      {spec && <>
        {(spec.zones ?? []).map((z, i) => <polygon key={i} points={pts(z.polygon)} fill={ZONE_FILL[z.tone]} />)}
        {(spec.rays ?? []).map((r, i) => (
          <g key={i}>
            <line x1={X(r.from[0])} y1={Y(r.from[1])} x2={X(r.to[0])} y2={Y(r.to[1])} stroke={RAY_STROKE[r.tone]} stroke-width={0.5} />
            {showLabels && <text x={X(r.to[0]) - 0.6} y={Y(r.to[1]) - 0.6} class="dia-label on-cloth" text-anchor="end">{r.label}</text>}
          </g>
        ))}
        {sequence && numbered.length > 1 && (
          <polyline points={pts(numbered.map(b => [b.x, b.y]))} fill="none" stroke="#f3ead3" stroke-width={0.3} stroke-dasharray="0.6 0.9" opacity={0.7} />
        )}
        {spec.paths.map((p, i) => {
          const st = PATH_STYLE[p.kind];
          return <polyline key={i} points={pts(p.points)} fill="none" stroke={st.stroke} stroke-width={st.width}
            stroke-dasharray={st.dash} opacity={st.opacity ?? 1} stroke-linecap="round" stroke-linejoin="round" />;
        })}
        {spec.balls.map((b, i) => {
          const fill = b.kind === 'cb' ? '#fbfbf7' : b.num != null ? BALL_COLORS[(b.num - 1) % 9] : '#f2c230';
          const stripe = b.num != null && b.num >= 9;
          return (
            <g key={i}>
              <circle cx={X(b.x)} cy={Y(b.y)} r={R} fill={stripe ? '#fbfbf7' : fill} stroke="#1a1a1a" stroke-width={0.18} />
              {stripe && <>
                <clipPath id={`bc-${uid}-${i}`}><circle cx={X(b.x)} cy={Y(b.y)} r={R - 0.09} /></clipPath>
                <rect x={X(b.x) - R} y={Y(b.y) - 0.5} width={2 * R} height={1} fill={fill} clip-path={`url(#bc-${uid}-${i})`} />
              </>}
              {b.num != null && <>
                <circle cx={X(b.x)} cy={Y(b.y)} r={0.55} fill="#fbfbf7" />
                <text x={X(b.x)} y={Y(b.y) + 0.36} class="dia-num" text-anchor="middle">{b.num}</text>
              </>}
              {showLabels && b.label && (
                <text x={X(b.x) + (b.x > 38 ? -1.7 : 1.7)} y={Y(b.y) + 0.45} class="dia-label on-cloth" text-anchor={b.x > 38 ? 'end' : 'start'}>{b.label}</text>
              )}
            </g>
          );
        })}
        {showLabels && (spec.labels ?? []).map((l, i) => <text key={i} x={X(l.at[0])} y={Y(l.at[1])} class="dia-label on-cloth" text-anchor={l.anchor ?? 'start'}>{l.text}</text>)}
      </>}
      {!spec && (
        <text x={X(TABLE.w / 2)} y={Y(TABLE.h / 2)} class="dia-label on-cloth" text-anchor="middle">Layout not set</text>
      )}
    </svg>
  );
}

export const DIAGRAM_KEY = [
  { kind: 'ob', label: 'Object ball path' },
  { kind: 'stun', label: 'Stun / tangent line' },
  { kind: 'roll', label: 'Rolling cue ball' },
  { kind: 'draw', label: 'Draw' },
  { kind: 'aim', label: 'Aim line' },
] as const;

export function DiagramKey({ kinds }: { kinds: string[] }) {
  const shown = DIAGRAM_KEY.filter(k => kinds.includes(k.kind));
  if (!shown.length) return null;
  return (
    <div class="legend dia-key">
      {shown.map(k => {
        const st = PATH_STYLE[k.kind];
        return (
          <span key={k.kind}>
            <svg width="22" height="8" aria-hidden="true"><line x1="1" x2="21" y1="4" y2="4" stroke={st.stroke} stroke-width="2.4" stroke-dasharray={st.dash ? '4 3' : undefined} stroke-linecap="round" /></svg>
            {k.label}
          </span>
        );
      })}
    </div>
  );
}
