import { useMemo, useState } from 'preact/hooks';
import type { AppData } from '../app';
import type { DrillDef } from '../engine/drills';
import { completionSummary, diagnosticCounts, type TallySession } from '../engine/tally';
import { bowlingTotal, spState, type Game } from '../engine/games';
import { summarizeSessions } from '../engine/sessions';
import type { PracticeSession } from '../engine/session';
import { fmtDate, fmtTime, int, pct, plural } from './format';

// One timeline of everything you did: Railbird sessions, tallies, games, matches and
// timed practice sessions, newest first.

export type ActivityKind = 'practice' | 'railbird' | 'tally' | 'bowling' | 'straight';
export interface Activity { id: string; kind: ActivityKind; date: string; title: string; detail: string; ref: string; live?: boolean }

export const KIND_LABEL: Record<ActivityKind, string> = { practice: 'Practice session', railbird: 'Railbird', tally: 'Tally', bowling: 'Bowling drill', straight: 'Straight pool' };

export function activities(data: AppData, tallies: TallySession[], games: Game[], drills: DrillDef[]): Activity[] {
  const out: Activity[] = [];
  for (const s of summarizeSessions(data.shotList, data.exclusions)) {
    out.push({ id: `rb-${s.sessionId}`, kind: 'railbird', date: s.start, ref: String(s.sessionId),
      title: s.sessionType === 'Free play' ? (s.name || 'Free play') : s.sessionType,
      detail: `${int(s.valid)} kept shots${s.makeRate != null ? `, made ${pct(s.makeRate)}` : ''}${s.tableSize ? ` · ${s.tableSize}` : ''}` });
  }
  for (const t of tallies) {
    if (!t.events.length && t.ended) continue;
    const d = drills.find(x => x.id === t.drillId);
    let detail = plural(t.events.length, 'tap');
    if (d?.counters === 'completion') {
      const c = completionSummary(t, d.ballsPerRack ?? 9);
      detail = c.racks ? `${c.completed} of ${plural(c.racks, 'rack')} run out${c.shotsAttempted ? `, ${pct(c.makes / c.shotsAttempted)} of shots made` : ''}` : '';
      if (c.learning) detail += `${detail ? ' · ' : ''}${plural(c.learning, 'learning rack')}`;
    } else if (d?.counters === 'diagnostic') {
      let m = 0, a = 0;
      for (const b of Object.values(diagnosticCounts(t))) for (const sd of ['L', 'R'] as const) { m += b[sd].make; a += b[sd].make + b[sd].thick + b[sd].thin; }
      detail = `${m} of ${a} made`;
    }
    out.push({ id: `t-${t.id}`, kind: 'tally', date: t.started, ref: t.drillId, title: t.drillName, detail: `${detail}${t.note ? ` · “${t.note}”` : ''}`, live: !t.ended });
  }
  for (const g of games) {
    if (g.kind === 'bowling') {
      const tot = bowlingTotal(g);
      out.push({ id: `g-${g.id}`, kind: 'bowling', date: g.date, ref: g.id, title: '10-ball bowling', detail: tot != null ? `Score ${tot}${g.source !== 'scored' ? ' (entered)' : ''}` : 'In progress', live: tot == null });
    } else if (g.kind === 'straight-pool') {
      const s = spState(g);
      out.push({ id: `g-${g.id}`, kind: 'straight', date: g.date, ref: g.id, title: `Straight pool vs ${g.players[1]}`, detail: `${s.score[0]}–${s.score[1]}, race to ${g.raceTo} · high run ${s.highRun[0]}`, live: !g.ended });
    } else if (g.kind === 'practice') {
      const p = g as PracticeSession;
      const done = p.blocks.filter(b => b.endedAt).length;
      out.push({ id: `g-${g.id}`, kind: 'practice', date: g.date, ref: g.id, title: `${p.minutes}-minute practice`, live: !p.ended,
        detail: `${done} of ${plural(p.blocks.length, 'block')}${p.rating ? ` · felt ${p.rating}/5` : ''}${p.note ? ` · “${p.note}”` : ''}` });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

type Props = {
  data: AppData; tallies: TallySession[]; games: Game[]; drills: DrillDef[];
  onOpen: (a: Activity) => void;
};

export function HistoryScreen({ data, tallies, games, drills, onOpen }: Props) {
  const all = useMemo(() => activities(data, tallies, games, drills), [data.exclusions, tallies, games, drills]);
  const [kind, setKind] = useState<ActivityKind | 'all'>('all');
  const [n, setN] = useState(60);
  const list = all.filter(a => kind === 'all' || a.kind === kind);
  const days: { day: string; items: Activity[] }[] = [];
  for (const a of list.slice(0, n)) {
    const day = fmtDate(a.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    if (days[days.length - 1]?.day !== day) days.push({ day, items: [] });
    days[days.length - 1].items.push(a);
  }
  const kinds = (['practice', 'railbird', 'tally', 'bowling', 'straight'] as const).filter(k => all.some(a => a.kind === k));
  return (
    <section>
      <h2>Session history</h2>
      <p class="lede">Everything you have done, newest first: Railbird sessions, tallies, games, matches and timed practice.</p>
      <div class="chips" role="group" aria-label="Show">
        <button aria-pressed={kind === 'all'} onClick={() => setKind('all')}>All ({all.length})</button>
        {kinds.map(k => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>)}
      </div>
      {!list.length ? <p class="muted">Nothing here yet.</p> : days.map(d => (
        <div key={d.day} class="card history-day">
          <div class="panel-title" style={{ marginTop: 0 }}>{d.day}</div>
          <ul class="game-list">{d.items.map(a => <ActivityRow key={a.id} a={a} onOpen={onOpen} />)}</ul>
        </div>
      ))}
      {list.length > n && <button class="btn" onClick={() => setN(n + 60)}>Show more</button>}
    </section>
  );
}

export function ActivityRow({ a, onOpen, showDate }: { a: Activity; onOpen: (a: Activity) => void; showDate?: boolean }) {
  return (
    <li>
      <span class={`kind-dot k-${a.kind}`} aria-hidden="true" />
      <div class="grow">
        <div><b>{a.title}</b>{a.live && <span class="live-tag">in progress</span>}</div>
        <div class="small muted">{KIND_LABEL[a.kind]} · {showDate ? `${fmtDate(a.date, { day: 'numeric', month: 'short' })} ` : ''}{fmtTime(a.date)} · {a.detail}</div>
      </div>
      <button class="btn btn-s" onClick={() => onOpen(a)}>{a.live ? 'Resume' : 'Open'}</button>
    </li>
  );
}
