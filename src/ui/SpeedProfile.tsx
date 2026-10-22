import { useEffect, useState } from 'preact/hooks';
import type { AppData } from '../app';
import { DIST_BANDS, mphRange, REF_BANDS, REF_KEYS, SPEED_GLITCH_MPH, type SpeedBandResult, type SpeedProfile } from '../engine/speed';
import { speedFor } from './fitCache';
import { useWidth } from './useWidth';
import { int, pct } from './format';

/** The speed profile, computed off the first paint (three model fits). */
export function useSpeedProfile(data: AppData): SpeedProfile | null {
  const [v, setV] = useState<SpeedProfile | null>(null);
  useEffect(() => {
    if (!data.shots.size) { setV(null); return; }
    const t = setTimeout(() => setV(speedFor(data)), 40);
    return () => clearTimeout(t);
  }, [data.exclusions]);
  return v;
}

const MAX = 15;

/** One sentence per distance band, for the routine and the card. */
export function bandSentence(b: SpeedBandResult): string {
  const sweet = b.sweet ? mphRange(b.sweet) : null;
  const edge = b.openLo && b.openHi ? ' (it runs to both ends of the speeds you play here)'
    : b.openLo ? ' (and maybe slower: you rarely play slower here)' : b.openHi ? ' (and maybe faster: you rarely play faster here)' : '';
  return `${b.label} shots: best about ${b.best!.toFixed(1)} mph; within 2 points of that from ${sweet} mph${edge}.`;
}

export function coverageNotes(b: SpeedBandResult): string[] {
  const out: string[] = [];
  for (const k of REF_KEYS) {
    const c = b.coverage[k], r = REF_BANDS[k];
    if (!c.enough) out.push(`Not enough ${k} (${r.text}) ${b.label.toLowerCase()} shots to judge: ${int(c.n)}, ${pct(c.share)} of them.`);
  }
  return out;
}

export function SpeedProfileCard({ data, onOpenDrill, compact }: { data: AppData; onOpenDrill?: (id: string) => void; compact?: boolean }) {
  const prof = useSpeedProfile(data);
  const [ref, W] = useWidth<HTMLDivElement>();
  if (!data.shots.size) return null;
  if (!prof) return <div class="card" id="speed-profile"><h3 style={{ marginTop: 0 }}>Speed profile</h3><p class="small muted">Working out your speeds…</p></div>;
  const L = 64, R = 10, rowH = 30, top = 22, H = top + prof.bands.length * rowH + 22;
  const x = (v: number) => L + (Math.min(MAX, Math.max(0, v)) / MAX) * (W - L - R);
  const thin = prof.bands.some(b => !b.coverage.firm.enough || !b.coverage.easy.enough);
  const at = (b: SpeedBandResult) => REF_KEYS.filter(k => b.atRef[k] != null).map(k => `${pct(b.atRef[k]!)} at ${k} speed`);
  return (
    <div class="card" id="speed-profile">
      <h3 style={{ marginTop: 0 }}>Speed profile</h3>
      <p class="small muted" style={{ marginTop: 0 }}>
        The speed that makes the most balls at each distance, from the shot model fitted separately for short, medium and long shots, with the shot's geometry held fixed.
        The shaded columns are the reference speeds (easy 4–7, firm 8–11, hard 12+ mph); the bar is your sweet spot (within 2 points of your best speed); the dot is the best speed.
        Only speeds you actually play are shown.
      </p>
      {prof.bands.length === 0 ? <p class="small muted">Not enough shots yet: each distance needs 300.</p> : <>
        <div ref={ref}>
          <svg width={W} height={H} class="chart speed-strip" role="img" aria-label="Best speed and sweet spot by distance">
            {REF_KEYS.map(k => {
              const lo = x(REF_BANDS[k].lo), hi = x(Math.min(MAX, REF_BANDS[k].hi));
              return (
                <g key={k}>
                  <rect x={lo} y={top - 4} width={hi - lo} height={H - top - 18} class={`ref-band ${k}`} />
                  <text x={(lo + hi) / 2} y={12} text-anchor="middle">{k}</text>
                </g>
              );
            })}
            {[0, 3, 6, 9, 12, 15].map(v => <g key={v}><line x1={x(v)} x2={x(v)} y1={top - 4} y2={H - 22} class="tick" /><text x={x(v)} y={H - 6} text-anchor="middle">{v}</text></g>)}
            <text x={0} y={H - 6}>mph</text>
            {prof.bands.map((b, i) => {
              const cy = top + i * rowH + rowH / 2 - 4;
              return (
                <g key={b.id}>
                  <title>{`${bandSentence(b)} ${b.n} shots.`}</title>
                  <text x={0} y={cy + 4} class="label-ink">{b.label}</text>
                  <line x1={x(b.observed[0])} x2={x(b.observed[1])} y1={cy} y2={cy} class="obs-range" />
                  {b.sweet && <rect x={x(b.sweet[0])} y={cy - 5} width={Math.max(4, x(b.sweet[1]) - x(b.sweet[0]))} height={10} rx={4} class="sweet" />}
                  {b.best != null && <circle cx={x(b.best)} cy={cy} r={5} class="best-dot" />}
                </g>
              );
            })}
          </svg>
        </div>
        <ul class="small speed-list">
          {prof.bands.map(b => (
            <li key={b.id}>
              <b>{bandSentence(b)}</b> <span class="muted">{DIST_BANDS.find(d => d.id === b.id)!.note}, {int(b.n)} shots.</span>
              {b.bestRange && !compact && <span class="muted"> The best speed's 95% range is {mphRange(b.bestRange)} mph.</span>}
              {!b.peakClear && <span class="muted"> The curve is nearly flat here, so the exact best speed matters little.</span>}
              {!compact && at(b).length > 0 && <span class="muted"> Typical shot at this distance: {at(b).join(', ')}.</span>}
              {coverageNotes(b).map((t, i) => <div key={i} class="muted">{t}</div>)}
            </li>
          ))}
        </ul>
        {thin && onOpenDrill && <p class="small" style={{ margin: '4px 0 0' }}>
          To fill a gap, film a block of those shots at that speed; the <button class="link-btn" onClick={() => onOpenDrill('d2-stun')}>stun test</button> is played at 7–8 mph.
        </p>}
        {!compact && <p class="small muted" style={{ margin: '6px 0 0' }}>
          Distance is total travel: cue ball to object ball plus object ball to pocket. {int(prof.glitches)} shots read below {SPEED_GLITCH_MPH} mph are Railbird tracking glitches and are left out.
        </p>}
      </>}
    </div>
  );
}
