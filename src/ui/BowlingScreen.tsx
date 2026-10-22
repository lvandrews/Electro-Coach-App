import { useMemo, useState } from 'preact/hooks';
import { addInning, bowlingCard, bowlingStats, bowlingTotal, newGameId, playedText, undoInning, type BowlingGame, type Game, type Played } from '../engine/games';
import { PlayedLine, playedHistory } from './TableFields';
import { TimeChart } from './TimeChart';
import { useWidth } from './useWidth';
import { fmtDate, int, localYmd, pct } from './format';

type Props = { games: Game[]; device: string; onSave: (g: Game) => Promise<void>; onDelete: (id: string) => Promise<void> };

export function BowlingScreen({ games, device, onSave, onDelete }: Props) {
  const bowling = useMemo(() => games.filter((g): g is BowlingGame => g.kind === 'bowling').sort((a, b) => (a.date < b.date ? -1 : 1)), [games]);
  const open = bowling.find(g => g.source === 'scored' && g.frames && !bowlingCard(g.frames).complete) ?? null;
  const [scoringId, setScoringId] = useState<string | null>(null);
  const scoring = bowling.find(g => g.id === scoringId) ?? null;
  const history = useMemo(() => playedHistory(games), [games]);

  async function newGame() {
    const now = new Date().toISOString();
    // Start from where the last scored game was played; a 7-ft table if there's none yet.
    const last = [...bowling].reverse().find(g => g.source === 'scored' && (g.venue || g.table));
    const g: BowlingGame = { id: newGameId(), kind: 'bowling', date: now, updated: now, frames: [], source: 'scored', device,
      venue: last?.venue, table: last?.table ?? { size: '7ft' } };
    await onSave(g); setScoringId(g.id);
  }

  if (scoring) return <Scorer game={scoring} history={history} onSave={onSave} onDelete={async id => { await onDelete(id); setScoringId(null); }} onClose={() => setScoringId(null)} onAnother={newGame} />;

  const done = bowling.filter(g => bowlingTotal(g) != null);
  const recent = bowlingStats(done.slice(-5)), all = bowlingStats(done);
  return (
    <div>
      <p class="lede">A run-out drill scored like bowling: each frame is a rack of ten with two innings.</p>
      <div class="row" style={{ gap: '8px', marginBottom: '12px' }}>
        {open ? <button class="btn primary" onClick={() => setScoringId(open.id)}>Resume the game in progress</button>
          : <button class="btn primary" onClick={newGame}>Start a game</button>}
      </div>

      {done.length > 0 && <>
        <div class="tiles">
          <div class="tile"><div class="tile-title">Average, last 5</div><div class="tile-big num">{recent.average!.toFixed(0)}</div><div class="small muted num">{all.average != null && `all ${int(all.games)} games: ${all.average.toFixed(0)}`}</div></div>
          <div class="tile"><div class="tile-title">Best game</div><div class="tile-big num">{all.best}</div></div>
          <div class="tile"><div class="tile-title">Strikes</div><div class="tile-big num">{all.strikeRate != null ? pct(all.strikeRate) : '—'}</div><div class="small muted">of frames (scored games)</div></div>
          <div class="tile"><div class="tile-title">Spares</div><div class="tile-big num">{all.spareRate != null ? pct(all.spareRate) : '—'}</div><div class="small muted">of frames</div></div>
          <div class="tile"><div class="tile-title">First inning</div><div class="tile-big num">{all.firstInning != null ? all.firstInning.toFixed(1) : '—'}</div><div class="small muted">balls run per rack</div></div>
        </div>
        <ScoreChart games={done} />
      </>}

      <PastGames device={device} onSave={onSave} />

      {bowling.length > 0 && <GameList games={[...bowling].reverse()} onOpen={id => setScoringId(id)} onDelete={onDelete} />}
      <HowToScore />
    </div>
  );
}

function ScoreChart({ games }: { games: BowlingGame[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const pts = games.map(g => ({ t: Date.parse(g.date), y: bowlingTotal(g)!, id: g.id }));
  const t0 = pts[0].t - 5 * 86400000, t1 = pts[pts.length - 1].t + 5 * 86400000;
  const max = Math.max(...pts.map(p => p.y)), min = Math.min(...pts.map(p => p.y));
  const y0 = Math.max(0, Math.floor((min - 20) / 50) * 50), y1 = Math.min(300, Math.ceil((max + 20) / 50) * 50);
  const ticks = []; for (let v = y0; v <= y1; v += 50) ticks.push(v);
  return (
    <div class="card">
      <h3 style={{ marginTop: 0 }}>Scores over time</h3>
      <div ref={ref}>
        <TimeChart width={width} t0={t0} t1={t1} y0={y0} y1={y1} yTicks={ticks} label="10-ball bowling scores over time"
          dots={pts.map(p => ({ key: p.id, t: p.t, y: p.y, r: 3.5 }))}
          line={pts.map((p, i) => { const s = pts.slice(Math.max(0, i - 4), i + 1); return { t: p.t, y: s.reduce((a, b) => a + b.y, 0) / s.length }; })} />
      </div>
      <p class="small muted" style={{ margin: '4px 0 0' }}>Dots: games. Line: average of the last five.</p>
    </div>
  );
}

// ---------- the score sheet ----------

function Sheet({ frames }: { frames: number[][] }) {
  const c = bowlingCard(frames);
  return (
    <div class="bowl-sheet" role="table" aria-label="Score sheet">
      {Array.from({ length: 10 }, (_, f) => {
        const marks = c.marks[f] ?? [];
        const slots = f === 9 ? 3 : 2;
        const current = c.next?.frame === f;
        return (
          <div key={f} class={`bowl-frame ${current ? 'current' : ''}`} role="cell">
            <div class="bowl-n">{f + 1}</div>
            <div class="bowl-marks">{Array.from({ length: slots }, (_, k) => <span key={k}>{marks[k] ?? ''}</span>)}</div>
            <div class="bowl-cum num">{c.cumulative[f] ?? ''}</div>
          </div>
        );
      })}
    </div>
  );
}

function Scorer({ game, history, onSave, onDelete, onClose, onAnother }: { game: BowlingGame; history: Played[]; onSave: (g: Game) => Promise<void>; onDelete: (id: string) => Promise<void>; onClose: () => void; onAnother: () => void }) {
  const frames = game.frames ?? [];
  const c = bowlingCard(frames);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState(game.note ?? '');
  const save = (f: number[][]) => onSave({ ...game, frames: f, updated: new Date().toISOString() });
  const n = c.next;
  const running = c.cumulative.filter(x => x != null).pop() ?? 0;
  return (
    <div>
      <div class="row" style={{ marginBottom: '10px' }}>
        <button class="btn btn-s" onClick={onClose}>Back to games</button>
        <span class="spacer" />
        <span class="small muted">{fmtDate(game.date)}</span>
      </div>
      <PlayedLine value={{ venue: game.venue, table: game.table }} history={history} idPrefix="bowl" onSave={p => onSave({ ...game, venue: p.venue, table: p.table, updated: new Date().toISOString() })} />
      <Sheet frames={frames} />
      {n ? (
        <div class="card" style={{ marginTop: '12px' }}>
          <div class="row" style={{ alignItems: 'baseline' }}>
            <h3 style={{ margin: 0 }}>Frame {n.frame + 1}{n.frame === 9 && n.inning === 2 ? ', bonus inning' : `, inning ${n.inning + 1}`}</h3>
            <span class="spacer" />
            <span class="num"><b>{running}</b> <span class="small muted">so far</span></span>
          </div>
          <p class="small muted" style={{ margin: '4px 0 10px' }}>How many balls did you run{n.max < 10 ? ` (${n.max} left in the rack)` : ''}?</p>
          <div class="bowl-keys">
            {Array.from({ length: 11 }, (_, k) => (
              <button key={k} class={`bowl-key ${k === n.max ? 'all' : ''}`} disabled={k > n.max} onClick={() => save(addInning(frames, k))}>
                {k === 10 && n.inning === 0 ? 'X' : k === n.max && n.max < 10 && k > 0 ? '/' : k}
              </button>
            ))}
          </div>
          <div class="row" style={{ marginTop: '10px', gap: '8px' }}>
            <button class="btn btn-s" disabled={!frames.length} onClick={() => save(undoInning(frames))}>Undo</button>
            {confirm
              ? <><button class="btn btn-s danger" onClick={() => onDelete(game.id)}>Discard this game</button><button class="btn btn-s" onClick={() => setConfirm(false)}>Keep it</button></>
              : <button class="btn btn-s" onClick={() => setConfirm(true)}>Discard…</button>}
          </div>
        </div>
      ) : (
        <div class="card" style={{ marginTop: '12px' }}>
          <div class="pred-big num">{c.total}</div>
          <div class="small muted">Final score</div>
          <label class="field" style={{ marginTop: '10px' }}>Note (optional)
            <input type="text" value={note} placeholder="Conditions, what worked…" onInput={e => setNote((e.target as HTMLInputElement).value)}
              onBlur={() => note !== (game.note ?? '') && onSave({ ...game, note, updated: new Date().toISOString() })} />
          </label>
          <div class="row" style={{ gap: '8px' }}>
            <button class="btn primary" onClick={async () => { await onSave({ ...game, note, updated: new Date().toISOString() }); onAnother(); }}>Start another game</button>
            <button class="btn" onClick={async () => { await onSave({ ...game, note, updated: new Date().toISOString() }); onClose(); }}>Done</button>
            <button class="btn btn-s" onClick={() => save(undoInning(frames))}>Undo last inning</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- past games: one at a time, or a pasted list ----------

function PastGames({ device, onSave }: { device: string; onSave: (g: Game) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(localYmd(new Date()));
  const [score, setScore] = useState('');
  const [paste, setPaste] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const mk = (ymd: string, total: number, source: BowlingGame['source']): BowlingGame => {
    const iso = new Date(`${ymd}T12:00:00`).toISOString();
    return { id: newGameId(), kind: 'bowling', date: iso, updated: new Date().toISOString(), frames: null, total, source, device };
  };
  async function addOne() {
    const v = Number(score);
    if (!Number.isInteger(v) || v < 0 || v > 300) { setMsg('A score is a whole number from 0 to 300.'); return; }
    await onSave(mk(date, v, 'entered')); setScore(''); setMsg(`Added ${v} on ${fmtDate(`${date}T12:00:00`)}.`);
  }
  async function addList() {
    const lines = paste.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const ok: BowlingGame[] = [], bad: string[] = [];
    for (const l of lines) {
      const d = parseDate(l), m = l.replace(/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4}/, ' ').match(/\b(\d{1,3})\b/);
      const v = m ? Number(m[1]) : NaN;
      if (d && v >= 0 && v <= 300) ok.push(mk(d, v, 'imported')); else bad.push(l);
    }
    for (const g of ok) await onSave(g);
    setMsg(`Added ${ok.length} game${ok.length === 1 ? '' : 's'}.${bad.length ? ` Skipped ${bad.length} line${bad.length === 1 ? '' : 's'} without a date and a score: “${bad[0]}”${bad.length > 1 ? '…' : ''}` : ''}`);
    if (!bad.length) setPaste('');
  }
  return (
    <div class="card">
      <div class="row"><h3 style={{ margin: 0 }}>Past games</h3><span class="spacer" /><button class="btn btn-s" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Add past games'}</button></div>
      {!open && <p class="small muted" style={{ margin: '6px 0 0' }}>Bring in games from another app: one at a time, or paste a list.</p>}
      {open && <>
        <div class="note-form" style={{ marginTop: '10px' }}>
          <label class="small">Date<input type="date" value={date} onInput={e => setDate((e.target as HTMLInputElement).value)} /></label>
          <label class="small">Score<input type="number" min={0} max={300} value={score} onInput={e => setScore((e.target as HTMLInputElement).value)} onKeyDown={e => e.key === 'Enter' && addOne()} style={{ width: '90px' }} /></label>
          <button class="btn primary" onClick={addOne} disabled={!score}>Add game</button>
        </div>
        <label class="field" style={{ marginTop: '12px' }}>Or paste a list: one game per line, a date and a score (e.g. “2026-09-14 187” or “9/14/2026, 187”)
          <textarea rows={4} value={paste} onInput={e => setPaste((e.target as HTMLTextAreaElement).value)} />
        </label>
        <button class="btn" onClick={addList} disabled={!paste.trim()}>Add these games</button>
      </>}
      {msg && <div class="notice" style={{ marginTop: '10px' }}>{msg}</div>}
    </div>
  );
}

/** YYYY-MM-DD from "2026-09-14" or US-style "9/14/2026" / "9/14/26". */
function parseDate(s: string): string | null {
  const z = (n: number) => String(n).padStart(2, '0');
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${z(+m[2])}-${z(+m[3])}`;
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return `${y}-${z(+m[1])}-${z(+m[2])}`; }
  return null;
}

function GameList({ games, onOpen, onDelete }: { games: BowlingGame[]; onOpen: (id: string) => void; onDelete: (id: string) => Promise<void> }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const shown = all ? games : games.slice(0, 12);
  return (
    <div class="card">
      <h3 style={{ marginTop: 0 }}>Games</h3>
      <ul class="game-list">
        {shown.map(g => {
          const t = bowlingTotal(g), c = g.frames ? bowlingCard(g.frames) : null;
          const strikes = g.frames?.slice(0, 10).filter(f => f[0] === 10).length;
          return (
            <li key={g.id}>
              <div class="grow">
                <div><b class="num">{t ?? 'In progress'}</b> <span class="small muted">{fmtDate(g.date)}{g.source !== 'scored' ? ` · ${g.source === 'imported' ? 'imported' : 'entered'} total` : c ? ` · ${strikes} strike${strikes === 1 ? '' : 's'}` : ''}</span></div>
                {playedText(g) && <div class="small muted">{playedText(g)}</div>}
                {g.note && <div class="small muted">{g.note}</div>}
              </div>
              {g.frames && <button class="btn btn-s" onClick={() => onOpen(g.id)}>{c?.complete ? 'Sheet' : 'Resume'}</button>}
              {confirm === g.id
                ? <><button class="btn btn-s danger" onClick={async () => { await onDelete(g.id); setConfirm(null); }}>Delete</button><button class="btn btn-s" onClick={() => setConfirm(null)}>Keep</button></>
                : <button class="btn btn-s" onClick={() => setConfirm(g.id)}>Delete</button>}
            </li>
          );
        })}
      </ul>
      {games.length > 12 && <button class="btn btn-s" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${games.length}`}</button>}
    </div>
  );
}

function HowToScore() {
  return (
    <details class="card rules">
      <summary>How to score</summary>
      <ol>
        <li>Rack ten balls (10-ball rack) and break.</li>
        <li>Take ball in hand and run as many balls as you can.</li>
        <li>When you miss, enter the number of balls made, counting any made on the break. If you run the whole rack, that's a strike: enter <b>X</b> (the 10 key).</li>
        <li>If balls remain, take ball in hand again and run as many as you can.</li>
        <li>When you miss, enter the number of additional balls made in this second inning. If you clear the rest of the rack, that's a spare: enter <b>/</b> (the last key, which always equals the balls that were left).</li>
        <li>Rack again for the next frame. Continue until all ten frames are done.</li>
      </ol>
      <h4>Scoring</h4>
      <ul>
        <li>An open frame scores the balls made in its two innings.</li>
        <li>A strike scores 10 plus the balls made in your next two innings; a spare scores 10 plus your next inning.</li>
        <li>A strike or spare in the tenth frame earns bonus innings (two after a strike, one after a spare). 300 is a perfect game.</li>
      </ul>
    </details>
  );
}
