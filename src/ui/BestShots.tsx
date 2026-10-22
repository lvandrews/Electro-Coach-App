import { useEffect, useState } from 'preact/hooks';
import type { AppData } from '../app';
import { describeShot, type BestShot } from '../engine/best';
import { bestFor } from './fitCache';
import { int, pct } from './format';

export function useBestShots(data: AppData): BestShot[] | null {
  const [v, setV] = useState<BestShot[] | null>(null);
  useEffect(() => {
    if (!data.shots.size) { setV(null); return; }
    const t = setTimeout(() => setV(bestFor(data)), 60);
    return () => clearTimeout(t);
  }, [data.exclusions]);
  return v;
}

/** The shots you make most reliably: a confidence list, not a target list. */
export function BestShotsCard({ data }: { data: AppData }) {
  const best = useBestShots(data);
  if (!best?.length) return null;
  return (
    <div class="card" id="best-shots">
      <h3 style={{ marginTop: 0 }}>Shots you own</h3>
      <p class="small muted" style={{ marginTop: 0 }}>
        The kinds of shot you make most reliably, by cut, distance, speed and spin. Each has at least 30 shots over 5 or more sessions,
        and they're ranked by the make rate you can count on (the low end of its 95% range), so a lucky streak can't top a long record.
      </p>
      <ol class="best-list">
        {best.map((b, i) => (
          <li key={i}>
            <div><b>{describeShot(b)}</b></div>
            <div class="small num">Made {pct(b.rate)}: {int(b.made)} of {int(b.n)} over {b.sessions} sessions{b.recent ? `; ${b.recent.made} of ${b.recent.n} in the last 90 days` : ''}.</div>
          </li>
        ))}
      </ol>
      <p class="small muted" style={{ margin: '6px 0 0' }}>Hangers (object ball within a foot of the pocket) are left out.</p>
    </div>
  );
}
