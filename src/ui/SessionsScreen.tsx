import { useMemo, useState } from 'preact/hooks';
import type { AppData, Tab } from '../app';
import { summarizeSessions, type SessionSummary } from '../engine/sessions';
import { RULES } from '../engine/rules';
import { wilson } from '../engine/distributions';
import { fmtDate, fmtTime, int, pct } from './format';

export function SessionsScreen({ data, onGo }: { data: AppData; onGo: (t: Tab) => void }) {
  const sessions = useMemo(() => summarizeSessions(data.shotList, data.exclusions), [data.shotList, data.exclusions]);
  const [open, setOpen] = useState<number | null>(null);
  const [type, setType] = useState<string>('all');

  if (!sessions.length) return <Empty onGo={onGo} />;

  const types = [...new Set(sessions.map(s => s.sessionType))];
  const shown = type === 'all' ? sessions : sessions.filter(s => s.sessionType === type);
  const groups = new Map<string, SessionSummary[]>();
  for (const s of shown) {
    const k = fmtDate(s.start, { month: 'long', year: 'numeric' });
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
  }

  return (
    <section>
      <h2>Sessions</h2>
      <p class="lede">{int(sessions.length)} sessions, newest first. Make rates count kept shots only; tap a session for what was excluded and why.</p>
      <div class="controls">
        <label>Session type
          <select value={type} onChange={e => setType((e.target as HTMLSelectElement).value)}>
            <option value="all">All types</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>
      {[...groups].map(([month, list]) => (
        <div key={month}>
          <div class="month">{month}</div>
          {list.map(s => (
            <div key={s.sessionId}>
              <button class="session" aria-expanded={open === s.sessionId} onClick={() => setOpen(open === s.sessionId ? null : s.sessionId)}>
                <div class="day num">{new Date(s.start).getDate()}<small>{fmtDate(s.start, { weekday: 'short' })}</small></div>
                <div>
                  <div>{s.name || 'Session'}<span class="type">{s.sessionType}</span></div>
                  <div class="small muted num">{int(s.valid)} kept{s.shots !== s.valid && ` of ${int(s.shots)}`}{s.tableSize && `, ${s.tableSize.replace('ft', '-ft')}`}{s.pocketSizeIn && `, ${s.pocketSizeIn}″ pockets`}</div>
                </div>
                <div class="rate">{pct(s.makeRate)}<small>made</small></div>
              </button>
              {open === s.sessionId && <Detail s={s} data={data} />}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

function Detail({ s, data }: { s: SessionSummary; data: AppData }) {
  const ci = wilson(s.makes, s.valid);
  const excluded = data.shotList.filter(x => x.sessionId === s.sessionId && data.exclusions.has(x.shotId));
  const label = (id: string) => RULES.find(r => r.id === id)?.label ?? id;
  return (
    <div class="session-detail">
      <div>Started {fmtDate(s.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} at {fmtTime(s.start)}.</div>
      {ci && <div class="num">{int(s.makes)} of {int(s.valid)} made; 95% range {pct(ci[0])}–{pct(ci[1])}.</div>}
      {s.tags.length > 0 && <div class="muted">Tags: {s.tags.join(', ')}</div>}
      {excluded.length > 0 && (
        <details style={{ marginTop: '6px' }}>
          <summary class="small">{int(excluded.length)} excluded</summary>
          <table>
            <tbody>
              {excluded.map(x => (
                <tr key={x.shotId}>
                  <td>{x.url ? <a href={x.url} target="_blank" rel="noopener">Shot {x.shotId}</a> : `Shot ${x.shotId}`}</td>
                  <td>{data.exclusions.get(x.shotId)!.map(label).join('; ')}</td>
                  <td class="n">{x.cutDeg?.toFixed(0)}°{x.mph != null && `, ${x.mph.toFixed(1)} mph`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

export function Empty({ onGo }: { onGo: (t: Tab) => void }) {
  return (
    <section class="card flat">
      <h3>No shots yet</h3>
      <p class="muted">This page analyzes Railbird shot data: import a Railbird export to fill it in.
        Drills, tallies, timed sessions, scoring, the shot clock, FargoRate, the journal and the routine all work without Railbird.</p>
      <button class="btn primary" onClick={() => onGo('import')}>Go to Import</button>
    </section>
  );
}
