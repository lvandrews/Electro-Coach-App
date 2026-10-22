import { useMemo, useState } from 'preact/hooks';
import { bpi, newGameId, playedText, spBall, spBreakChoice, spEnd, spState, spUndo, type Game, type Played, type StraightPoolMatch } from '../engine/games';
import { opponentKey, opponents, scoresheetPdf, scoresheetText, type OpponentRecord } from '../engine/scoresheet';
import { cleanPlayed, playedHistory, PlayedLine, TableFields } from './TableFields';
import { shareFile } from '../platform';
import { shareText } from '../notify';
import { TimeChart } from './TimeChart';
import { useWidth } from './useWidth';
import { fmtDate, int } from './format';

type Props = { games: Game[]; device: string; onSave: (g: Game) => Promise<void>; onDelete: (id: string) => Promise<void> };

export function StraightPoolScreen({ games, device, onSave, onDelete }: Props) {
  const matches = useMemo(() => games.filter((g): g is StraightPoolMatch => g.kind === 'straight-pool').sort((a, b) => (a.date < b.date ? -1 : 1)), [games]);
  const live = matches.find(m => !m.ended) ?? null;
  const [openId, setOpenId] = useState<string | null>(null);
  const [setup, setSetup] = useState<string | true | null>(null);   // true, or the opponent to play again
  const [oppKey, setOppKey] = useState<string | null>(null);
  const opps = useMemo(() => opponents(matches.filter(m => m.innings.length)), [matches]);
  const open = matches.find(m => m.id === openId) ?? null;
  const opp = opps.find(o => o.key === oppKey) ?? null;
  const history = useMemo(() => playedHistory(games), [games]);
  if (open) return <Match m={open} history={history} onSave={onSave} onDelete={async id => { await onDelete(id); setOpenId(null); }} onClose={() => setOpenId(null)} />;
  if (setup) return <NewMatch device={device} last={matches[matches.length - 1]} opponents={opps} history={history} against={setup === true ? undefined : setup}
    onCancel={() => setSetup(null)} onStart={async m => { await onSave(m); setSetup(null); setOppKey(null); setOpenId(m.id); }} />;
  if (opp) return <Opponent o={opp} onBack={() => setOppKey(null)} onOpen={setOpenId} onPlay={live ? null : () => setSetup(opp.name)} />;

  const done = matches.filter(m => m.ended && m.innings.length);
  return (
    <div>
      <p class="lede">Scored ball by ball; balls per inning and high run are the numbers to watch.</p>
      <div class="row" style={{ gap: '8px', marginBottom: '12px' }}>
        {live ? <button class="btn primary" onClick={() => setOpenId(live.id)}>Resume the match in progress</button>
          : <button class="btn primary" onClick={() => setSetup(true)}>Start a match</button>}
      </div>
      {done.length > 0 && <History matches={done} />}
      {opps.length > 0 && <OpponentList opps={opps} onOpen={setOppKey} />}
      {matches.length > 0 && <MatchList matches={[...matches].reverse()} onOpen={setOpenId} onDelete={onDelete} />}
      <Rules />
    </div>
  );
}

function NewMatch({ device, last, opponents: opps, history, against, onStart, onCancel }: {
  device: string; last?: StraightPoolMatch; opponents: OpponentRecord[]; history: Played[]; against?: string;
  onStart: (m: StraightPoolMatch) => void; onCancel: () => void;
}) {
  const [me, setMe] = useState(last?.players[0] ?? 'Me');
  const [pick, setPick] = useState<string>(against ? opponentKey(against) : opps.length ? opps[0].key : '');   // '' = a new opponent
  const [them, setThem] = useState('');
  const [race, setRace] = useState(last?.raceTo ?? 100);
  const [first, setFirst] = useState<0 | 1>(0);
  // Straight pool defaults to a 9-ft table; otherwise start from where the last match was played.
  const [played, setPlayed] = useState<Played>(last ? { venue: last.venue, table: last.table ?? { size: '9ft' } } : { table: { size: '9ft' } });
  const oppName = pick ? opps.find(o => o.key === pick)?.name ?? '' : them.trim();
  const clash = !pick && them.trim() ? opps.find(o => o.key === opponentKey(them)) : undefined;
  return (
    <div class="card">
      <h3 style={{ marginTop: 0 }}>New match</h3>
      <div class="clock-settings">
        <label>You<input type="text" value={me} onInput={e => setMe((e.target as HTMLInputElement).value)} /></label>
        {opps.length > 0 && <label>Opponent<select value={pick} onChange={e => setPick((e.target as HTMLSelectElement).value)}>
          {opps.map(o => <option key={o.key} value={o.key}>{o.name} ({o.wins}–{o.losses})</option>)}
          <option value="">New opponent…</option></select></label>}
        {!pick && <label>{opps.length ? 'New opponent' : 'Opponent'}<input type="text" value={them} placeholder="Name" onInput={e => setThem((e.target as HTMLInputElement).value)} /></label>}
        <label>Race to<select value={String(race)} onChange={e => setRace(Number((e.target as HTMLSelectElement).value))}>
          {[25, 50, 75, 100, 125, 150, 200].map(r => <option key={r} value={r}>{r} points</option>)}</select></label>
        <label>Opening break<select value={String(first)} onChange={e => setFirst(Number((e.target as HTMLSelectElement).value) as 0 | 1)}>
          <option value="0">{me || 'You'} to break</option><option value="1">{oppName || 'Opponent'} to break</option></select></label>
      </div>
      <div class="panel-title">Where and on what</div>
      <TableFields value={played} onChange={setPlayed} history={history} idPrefix="sp-new" />
      {clash && <p class="small muted" style={{ margin: '8px 0 0' }}>{clash.name} is already in your list; this match will join their record.</p>}
      <div class="row" style={{ gap: '8px', marginTop: '12px' }}>
        <button class="btn primary" onClick={() => {
          const now = new Date().toISOString();
          onStart({ id: newGameId(), kind: 'straight-pool', date: now, updated: now, players: [me.trim() || 'Me', (clash?.name ?? oppName) || 'Opponent'], raceTo: race, first, innings: [], device, ...cleanPlayed(played) });
        }}>Start</button>
        <button class="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Match({ m, history, onSave, onDelete, onClose }: { m: StraightPoolMatch; history: Played[]; onSave: (g: Game) => Promise<void>; onDelete: (id: string) => Promise<void>; onClose: () => void }) {
  const s = spState(m);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState(m.note ?? '');
  const put = (next: StraightPoolMatch) => onSave({ ...next, updated: new Date().toISOString() });
  const over = s.winner != null || !!m.ended;
  const fmtBpi = (p: 0 | 1) => { const v = bpi(s, p); return v == null ? '—' : v.toFixed(2); };
  return (
    <div>
      <div class="row" style={{ marginBottom: '10px' }}>
        <button class="btn btn-s" onClick={onClose}>Back to matches</button>
        <span class="spacer" />
        <span class="small muted">Race to {m.raceTo} · {fmtDate(m.date)}</span>
      </div>
      <PlayedLine value={{ venue: m.venue, table: m.table }} history={history} idPrefix="sp-match" onSave={p => put({ ...m, venue: p.venue, table: p.table })} />
      <div class="sp-players">
        {([0, 1] as const).map(p => (
          <div key={p} class={`sp-player ${s.shooter === p && !over ? 'at-table' : ''} ${s.winner === p ? 'winner' : ''}`}>
            <div class="sp-name">{m.players[p]}{s.shooter === p && !over ? ' · at the table' : ''}{s.winner === p ? ' · wins' : ''}</div>
            <div class="sp-score num">{s.score[p]}</div>
            <div class="small num">needs {Math.max(0, m.raceTo - s.score[p])}</div>
            <div class="small muted num">innings {s.innings[p]} · BPI {fmtBpi(p)} · high run {s.highRun[p]}</div>
            {s.consecutiveFouls[p] > 0 && <div class="small sp-fouls">{s.consecutiveFouls[p] === 1 ? 'On one foul' : 'On two fouls: a third costs 15 more'}</div>}
          </div>
        ))}
      </div>

      {!over && s.breakChoice && (
        <div class="notice" style={{ marginTop: '12px' }}>
          <b>Break foul.</b> {m.players[(1 - m.innings[m.innings.length - 1].p) as 0 | 1]} can take the table as it lies or make {m.players[m.innings[m.innings.length - 1].p]} break again.
          <div class="row" style={{ gap: '8px', marginTop: '8px' }}>
            <button class="btn btn-s" onClick={() => put(spBreakChoice(m, false))}>Accept the table</button>
            <button class="btn btn-s" onClick={() => put(spBreakChoice(m, true))}>Break again</button>
          </div>
        </div>
      )}
      {!over ? (
        <div class="card" style={{ marginTop: '12px' }}>
          <div class="row" style={{ alignItems: 'baseline' }}>
            <div><span class="small muted">Current run</span> <b class="num" style={{ fontSize: '1.6rem' }}>{s.run}</b></div>
            <span class="spacer" />
            <div class={`small ${s.rerack || (s.opening && m.innings.length) ? 'sp-rerack' : 'muted'}`}>{s.rerack ? 'Re-rack 14 balls' : s.opening && m.innings.length ? 'Rack all 15: break again' : `${s.onTable} balls on the table`}</div>
          </div>
          <button class="sp-ball" onClick={() => put(spBall(m))}>+1 ball</button>
          <div class="sp-ends">
            <button class="btn" onClick={() => put(spEnd(m, 'miss'))}>Miss</button>
            <button class="btn" onClick={() => put(spEnd(m, 'safety'))}>Safety</button>
            <button class="btn danger" onClick={() => put(spEnd(m, 'foul'))}>Foul −1</button>
            {s.opening && <button class="btn danger" onClick={() => put(spEnd(m, 'breakFoul'))}>Break foul −2</button>}
          </div>
          <div class="row" style={{ gap: '8px', marginTop: '10px' }}>
            <button class="btn btn-s" disabled={!m.innings.length} onClick={() => put(spUndo(m))}>Undo</button>
            {confirm
              ? <><button class="btn btn-s" onClick={() => onSave({ ...m, ended: new Date().toISOString(), updated: new Date().toISOString() }).then(onClose)}>End here (keep it)</button>
                  <button class="btn btn-s danger" onClick={() => onDelete(m.id)}>Discard it</button>
                  <button class="btn btn-s" onClick={() => setConfirm(false)}>Keep playing</button></>
              : <button class="btn btn-s" onClick={() => setConfirm(true)}>End match…</button>}
          </div>
          <p class="small muted" style={{ margin: '8px 0 0' }}>Tap +1 for each ball pocketed, then how the inning ended. Balls pocketed on a foul are spotted: don't count them.</p>
        </div>
      ) : (
        <div class="card" style={{ marginTop: '12px' }}>
          <h3 style={{ marginTop: 0 }}>{s.winner != null ? `${m.players[s.winner]} wins ${s.score[s.winner]}–${s.score[1 - s.winner as 0 | 1]}` : `Ended at ${s.score[0]}–${s.score[1]}`}</h3>
          <label class="field">Note (optional)
            <input type="text" value={note} placeholder="Conditions, what decided it…" onInput={e => setNote((e.target as HTMLInputElement).value)} />
          </label>
          <div class="row" style={{ gap: '8px' }}>
            <button class="btn primary" onClick={() => onSave({ ...m, note: note || undefined, ended: m.ended ?? new Date().toISOString(), updated: new Date().toISOString() }).then(onClose)}>Save match</button>
            {s.winner != null && !m.ended && <button class="btn btn-s" onClick={() => put(spUndo(m))}>Undo last ball</button>}
            {m.ended && s.winner == null && <button class="btn btn-s" onClick={() => put({ ...m, ended: undefined })}>Resume it</button>}
          </div>
          <ShareSheet m={{ ...m, note: note || undefined }} />
        </div>
      )}
      {!over && <Rules />}
    </div>
  );
}

function History({ matches }: { matches: StraightPoolMatch[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const pts = matches.map(m => { const s = spState(m); return { id: m.id, t: Date.parse(m.date), bpi: bpi(s, 0), high: s.highRun[0] }; }).filter(p => p.bpi != null);
  if (!pts.length) return null;
  const t0 = pts[0].t - 5 * 86400000, t1 = pts[pts.length - 1].t + 5 * 86400000;
  const ymax = Math.max(2, Math.ceil(Math.max(...pts.map(p => p.bpi!)) + 0.5));
  const best = Math.max(...pts.map(p => p.high));
  const avg = pts.reduce((a, p) => a + p.bpi!, 0) / pts.length;
  const ticks = Array.from({ length: ymax + 1 }, (_, i) => i).filter(v => ymax <= 6 || v % 2 === 0);
  return (
    <>
      <div class="tiles">
        <div class="tile"><div class="tile-title">Matches</div><div class="tile-big num">{int(matches.length)}</div></div>
        <div class="tile"><div class="tile-title">Your BPI, average</div><div class="tile-big num">{avg.toFixed(2)}</div><div class="small muted">balls per inning</div></div>
        <div class="tile"><div class="tile-title">Your high run</div><div class="tile-big num">{best}</div></div>
      </div>
      <div class="card">
        <h3 style={{ marginTop: 0 }}>Your balls per inning</h3>
        <div ref={ref}>
          <TimeChart width={width} t0={t0} t1={t1} y0={0} y1={ymax} yTicks={ticks} yFmt={v => v.toFixed(0)} label="Balls per inning by match"
            dots={pts.map(p => ({ key: p.id, t: p.t, y: p.bpi!, r: 3.5 }))}
            line={pts.map((p, i) => { const s = pts.slice(Math.max(0, i - 4), i + 1); return { t: p.t, y: s.reduce((a, b) => a + b.bpi!, 0) / s.length }; })} />
        </div>
        <p class="small muted" style={{ margin: '4px 0 0' }}>Dots: matches. Line: average of the last five.</p>
      </div>
    </>
  );
}

function MatchList({ matches, onOpen, onDelete }: { matches: StraightPoolMatch[]; onOpen: (id: string) => void; onDelete: (id: string) => Promise<void> }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <div class="card">
      <h3 style={{ marginTop: 0 }}>Matches</h3>
      <ul class="game-list">
        {matches.map(m => {
          const s = spState(m);
          const v = bpi(s, 0);
          return (
            <li key={m.id}>
              <div class="grow">
                <div><b class="num">{s.score[0]}–{s.score[1]}</b> vs {m.players[1]} <span class="small muted">· race to {m.raceTo} · {fmtDate(m.date)}{!m.ended ? ' · in progress' : ''}</span></div>
                {playedText(m) && <div class="small muted">{playedText(m)}</div>}
                <div class="small muted num">Your BPI {v == null ? '—' : v.toFixed(2)} · high run {s.highRun[0]}{m.note ? ` · ${m.note}` : ''}</div>
              </div>
              <button class="btn btn-s" onClick={() => onOpen(m.id)}>{m.ended ? 'Open' : 'Resume'}</button>
              {confirm === m.id
                ? <><button class="btn btn-s danger" onClick={async () => { await onDelete(m.id); setConfirm(null); }}>Delete</button><button class="btn btn-s" onClick={() => setConfirm(null)}>Keep</button></>
                : <button class="btn btn-s" onClick={() => setConfirm(m.id)}>Delete</button>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- sharing ----------

function ShareSheet({ m }: { m: StraightPoolMatch }) {
  const [msg, setMsg] = useState<string | null>(null);
  const base = `straight-pool-${m.date.slice(0, 10)}-${m.players[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'match'}`;
  return (
    <div style={{ marginTop: '12px' }}>
      <div class="panel-title">Share the scoresheet</div>
      <div class="row" style={{ gap: '8px' }}>
        <button class="btn" onClick={async () => { try { await shareFile(`${base}.pdf`, scoresheetPdf(m), 'application/pdf', 'Straight pool scoresheet'); } catch (e) { setMsg(`Could not share the PDF: ${e instanceof Error ? e.message : String(e)}`); } }}>PDF</button>
        <button class="btn" onClick={async () => { const r = await shareText('Straight pool scoresheet', scoresheetText(m)); setMsg(r === 'copied' ? 'Copied: paste it into an email or message.' : r === 'failed' ? 'Could not share or copy the text.' : null); }}>Text (email, messages)</button>
      </div>
      <p class="small muted" style={{ margin: '6px 0 0' }}>Date, players, race, final score, innings, balls per inning, high runs, fouls, and every inning with the score after it.</p>
      {msg && <p class="small" role="status">{msg}</p>}
    </div>
  );
}

// ---------- opponents ----------

function OpponentList({ opps, onOpen }: { opps: OpponentRecord[]; onOpen: (key: string) => void }) {
  return (
    <div class="card">
      <h3 style={{ marginTop: 0 }}>Opponents</h3>
      <ul class="game-list">
        {opps.map(o => (
          <li key={o.key}>
            <div class="grow">
              <div><b>{o.name}</b> <span class="num">{o.wins}–{o.losses}</span>{o.unfinished ? <span class="small muted"> · {o.unfinished} unfinished</span> : null}</div>
              <div class="small muted num">{o.matches.length} {o.matches.length === 1 ? 'match' : 'matches'} · last {fmtDate(o.last)} · your BPI {o.bpi[0] == null ? '—' : o.bpi[0].toFixed(2)}, theirs {o.bpi[1] == null ? '—' : o.bpi[1].toFixed(2)}</div>
            </div>
            <button class="btn btn-s" onClick={() => onOpen(o.key)}>Open</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Opponent({ o, onBack, onOpen, onPlay }: { o: OpponentRecord; onBack: () => void; onOpen: (id: string) => void; onPlay: (() => void) | null }) {
  const me = o.matches[o.matches.length - 1].players[0];
  const f = (x: number | null) => (x == null ? '—' : x.toFixed(2));
  return (
    <div>
      <div class="row" style={{ marginBottom: '10px' }}>
        <button class="btn btn-s" onClick={onBack}>Back to matches</button>
        <span class="spacer" />
        {onPlay && <button class="btn btn-s primary" onClick={onPlay}>Play {o.name}</button>}
      </div>
      <h3 style={{ margin: '0 0 8px' }}>{me} vs {o.name}</h3>
      <div class="tiles">
        <div class="tile"><div class="tile-title">Record</div><div class="tile-big num">{o.wins}–{o.losses}</div><div class="small muted">{o.matches.length} {o.matches.length === 1 ? 'match' : 'matches'}{o.unfinished ? `, ${o.unfinished} unfinished` : ''}</div></div>
        <div class="tile"><div class="tile-title">Balls per inning</div><div class="tile-big num">{f(o.bpi[0])}</div><div class="small muted">you · {o.name} {f(o.bpi[1])}</div></div>
        <div class="tile"><div class="tile-title">High run</div><div class="tile-big num">{o.highRun[0]}</div><div class="small muted">you · {o.name} {o.highRun[1]}</div></div>
      </div>
      {o.venues.length > 0 && <p class="small muted">Played at {o.venues.join(', ')}.</p>}
      <div class="card">
        <h3 style={{ marginTop: 0 }}>Matches</h3>
        <ul class="game-list">
          {[...o.matches].reverse().map(m => {
            const s = spState(m);
            return (
              <li key={m.id}>
                <div class="grow">
                  <div><b class="num">{s.score[0]}–{s.score[1]}</b> <span class="small">{s.winner === 0 ? 'won' : s.winner === 1 ? 'lost' : m.ended ? 'unfinished' : 'in progress'}</span> <span class="small muted">· race to {m.raceTo} · {fmtDate(m.date)}</span></div>
                  {playedText(m) && <div class="small muted">{playedText(m)}</div>}
                  <div class="small muted num">BPI {f(bpi(s, 0))} vs {f(bpi(s, 1))} · high runs {s.highRun[0]} and {s.highRun[1]}</div>
                </div>
                <button class="btn btn-s" onClick={() => onOpen(m.id)}>Open</button>
              </li>
            );
          })}
        </ul>
        <p class="small muted" style={{ margin: '4px 0 0' }}>Balls per inning here pools every inning against this opponent.</p>
      </div>
    </div>
  );
}

// ---------- rules ----------

function Rules() {
  return (
    <details class="card rules">
      <summary>Straight pool rules</summary>
      <h4>Scoring</h4>
      <ul>
        <li>Call the ball and the pocket on every shot. Each called ball pocketed legally is one point; you keep shooting until you miss, play a safety or foul.</li>
        <li>Extra balls that drop along with the called ball score too. If the called ball doesn't go in, anything pocketed on that shot is spotted and doesn't score; the same goes for balls pocketed on a safety or a foul.</li>
        <li>The first player to reach the race wins.</li>
      </ul>
      <h4>Opening break</h4>
      <ul>
        <li>Cue ball in hand behind the head string. Either pocket a called ball, or after the cue ball hits the rack, drive the cue ball and two object balls to a rail.</li>
        <li>Otherwise it's a <b>break foul: −2</b>. The opponent takes the table as it lies or makes the breaker break again (each further break foul is another −2).</li>
        <li>Break fouls don't count toward three fouls in a row.</li>
      </ul>
      <h4>Fouls</h4>
      <ul>
        <li>A foul is <b>−1</b>, and the turn passes. The incoming player plays the cue ball where it lies.</li>
        <li>After a scratch or the cue ball leaving the table: cue ball in hand behind the head string.</li>
        <li>Object balls pocketed on the foul, or driven off the table, are spotted.</li>
        <li><b>Three fouls in a row</b> by the same player: −1 for the third, then a further <b>−15</b>. The count starts again, all fifteen balls are racked, and the offender breaks under the opening-break rules.</li>
      </ul>
      <h4>Spotting balls</h4>
      <ul>
        <li>On the foot spot, or if it's taken, on the long string as close to it as possible toward the foot rail, frozen to the ball in the way. If that line is full, in front of the foot spot (toward the center).</li>
        <li>With the cue ball in hand behind the head string and every object ball behind it too, you can ask for the ball nearest the head string to be spotted.</li>
      </ul>
      <h4>Re-racking</h4>
      <ul>
        <li>When fourteen balls are down, play stops and the fourteen are racked with the apex spot empty. The shooter continues and may play any ball.</li>
        <li>If the 15th ball went in on the shot that made the 14th: rack all fifteen.</li>
        <li>If the cue ball and the 15th ball are both in the rack area: rack all fifteen; cue ball in hand behind the head string.</li>
        <li>If only the 15th ball is in the rack area: it goes on the head spot (the center spot if the cue ball is in the way).</li>
        <li>If only the cue ball is in the rack area: with the 15th ball on or past the head string (toward the rack), cue ball in hand behind the head string; with the 15th ball behind the head string, cue ball on the head spot (the center spot if that's taken).</li>
      </ul>
      <p class="small muted">From the WPA Rules of Play (October 2026). Leagues and halls may play local variations; agree on them before the match.</p>
    </details>
  );
}
