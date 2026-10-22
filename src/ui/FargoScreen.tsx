import { useMemo, useState } from 'preact/hooks';
import { addEntry, changeOver, ESTABLISHED, FARGO_API, FARGO_SITE, latestEntry, parseFargo, type FargoData, type FargoPlayer } from '../engine/fargo';
import { timelineNotes, type Note } from '../engine/progress';
import type { TallySession } from '../engine/tally';
import { getJson, openExternal } from '../platform';
import { TimeChart, type TMarker } from './TimeChart';
import { useWidth } from './useWidth';
import { fmtDate, int, localYmd } from './format';

type Props = { fargo: FargoData; onFargo: (f: FargoData) => Promise<void>; notes: Note[]; tallies: TallySession[] };

const ymdMs = (ymd: string) => Date.parse(`${ymd}T12:00:00`);

async function search(q: string): Promise<FargoPlayer[]> {
  const enc = encodeURIComponent(q.trim());
  return parseFargo(await getJson(`${FARGO_API}${enc}`, `/fargo-api/indexsearch?q=${enc}`));
}

export function FargoScreen({ fargo, onFargo, notes, tallies }: Props) {
  const last = latestEntry(fargo);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [finding, setFinding] = useState(!fargo.id && !fargo.entries.length);

  const update = async () => {
    if (!fargo.id) return;
    setBusy(true); setMsg(null);
    try {
      const p = (await search(fargo.id)).find(x => x.id === fargo.id);
      if (!p || p.rating == null) throw new Error('FargoRate did not return a rating for your ID');
      await onFargo(addEntry({ ...fargo, name: p.name, location: p.location }, { date: localYmd(new Date()), rating: p.rating, robustness: p.robustness ?? undefined, provisional: p.provisional, source: 'lookup' }));
      setMsg({ text: last && last.rating === p.rating ? `Still ${p.rating}.` : `Rating ${p.rating} recorded for today.` });
    } catch (e) {
      setMsg({ bad: true, text: `Could not reach FargoRate (${e instanceof Error ? e.message : String(e)}). Add the rating by hand below, or check it on the FargoRate site.` });
    } finally { setBusy(false); }
  };

  return (
    <section>
      <h2>FargoRate</h2>
      <p class="lede">Your rating over time, with your Journal entries flagged on the chart.</p>

      <div class="card">
        <div class="row" style={{ alignItems: 'baseline' }}>
          <div class="grow">
            {last ? <>
              <div class="tile-title">{fargo.name ?? 'Your rating'}{fargo.id ? ` · ID ${fargo.id}` : ''}</div>
              <div class="tile-big num">{last.rating}{last.provisional && <span class="small"> provisional</span>}</div>
              <div class="small muted">{fmtDate(`${last.date}T12:00:00`)}{last.robustness != null ? ` · robustness ${int(last.robustness)}${last.robustness < ESTABLISHED ? ' (not yet established)' : ''}` : ''}{fargo.location ? ` · ${fargo.location}` : ''}</div>
            </> : <div class="muted">No rating recorded yet.</div>}
          </div>
        </div>
        <div class="row" style={{ gap: '8px', marginTop: '10px' }}>
          {fargo.id && <button class="btn primary" disabled={busy} onClick={update}>{busy ? 'Checking…' : 'Update from FargoRate'}</button>}
          <button class="btn" onClick={() => setFinding(!finding)}>{finding ? 'Close search' : fargo.id ? 'Change player' : 'Find me on FargoRate'}</button>
          <button class="btn" onClick={() => openExternal(FARGO_SITE)}>Open FargoRate</button>
        </div>
        {msg && <div class={`notice ${msg.bad ? 'bad' : 'good'}`} role="status">{msg.text}</div>}
        {finding && <Finder current={fargo} onPick={async p => {
          const next: FargoData = { ...fargo, id: p.id, name: p.name, location: p.location };
          await onFargo(p.rating != null ? addEntry(next, { date: localYmd(new Date()), rating: p.rating, robustness: p.robustness ?? undefined, provisional: p.provisional, source: 'lookup' }) : next);
          setFinding(false); setMsg({ text: `Linked to ${p.name}.${p.rating != null ? ` Rating ${p.rating} recorded for today.` : ''}` });
        }} />}
      </div>

      <Chart fargo={fargo} notes={notes} tallies={tallies} />
      <ManualEntry fargo={fargo} onFargo={onFargo} />
      <EntryList fargo={fargo} onFargo={onFargo} />

      <p class="small muted">
        FargoRate has no published API. The lookup uses the same search the open-source fargo command-line tool uses, so it may stop working if FargoRate changes it; entering the rating by hand always works.
        Ratings on fewer than {ESTABLISHED} games are not yet established, so expect them to move.
      </p>
    </section>
  );
}

function Finder({ current, onPick }: { current: FargoData; onPick: (p: FargoPlayer) => void }) {
  const [q, setQ] = useState(current.name ?? '');
  const [res, setRes] = useState<FargoPlayer[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!q.trim()) return;
    setBusy(true); setErr(null); setRes(null);
    try { setRes(await search(q)); }
    catch (e) { setErr(`Could not reach FargoRate (${e instanceof Error ? e.message : String(e)}). Look yourself up on the FargoRate site and enter your rating below.`); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ marginTop: '12px' }}>
      <label class="field">Your name or FargoRate ID
        <div class="row" style={{ gap: '8px', flexWrap: 'nowrap' }}>
          <input type="search" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} onKeyDown={e => { if (e.key === 'Enter') go(); }} style={{ flex: 1, minWidth: 0 }} />
          <button class="btn primary" disabled={busy || !q.trim()} onClick={go}>{busy ? 'Searching…' : 'Search'}</button>
        </div>
      </label>
      {err && <div class="notice bad">{err}</div>}
      {res && (res.length ? (
        <ul class="game-list">
          {res.slice(0, 12).map(p => (
            <li key={p.id}>
              <div class="grow"><b>{p.name}</b> <span class="num">{p.rating ?? '—'}</span>{p.provisional && <span class="small muted"> provisional</span>}
                <div class="small muted">{p.location || 'No location'} · ID {p.id}{p.robustness != null ? ` · robustness ${int(p.robustness)}` : ''}</div></div>
              <button class="btn btn-s" onClick={() => onPick(p)}>This is me</button>
            </li>
          ))}
        </ul>
      ) : <p class="small muted">No players found.</p>)}
    </div>
  );
}

function Chart({ fargo, notes, tallies }: { fargo: FargoData; notes: Note[]; tallies: TallySession[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const timeline = useMemo(() => timelineNotes(notes, tallies), [notes, tallies]);
  const e = fargo.entries;
  if (!e.length) return null;
  const ts = e.map(x => ymdMs(x.date));
  const span = Math.max(30 * 86400000, ts[ts.length - 1] - ts[0]);
  const t0 = ts[0] - span * 0.05, t1 = ts[ts.length - 1] + span * 0.05;
  const lo = Math.min(...e.map(x => x.rating)), hi = Math.max(...e.map(x => x.rating));
  const step = hi - lo > 60 ? 20 : 10;
  const y0 = Math.floor((lo - 10) / step) * step, y1 = Math.ceil((hi + 10) / step) * step;
  const ticks: number[] = []; for (let v = y0; v <= y1; v += step) ticks.push(v);
  const markers: TMarker[] = timeline.filter(n => { const t = ymdMs(n.date); return t >= t0 && t <= t1; })
    .map(n => ({ t: ymdMs(n.date), n: n.n, title: `${n.n}. ${fmtDate(`${n.date}T12:00:00`)}: ${n.text}` }));
  const ch = changeOver(fargo, 90);
  return (
    <div class="card">
      <h3 style={{ marginTop: 0 }}>Rating over time</h3>
      {ch && <p class="small" style={{ marginTop: 0 }}>Over the last 90 days: <b class="num">{ch.diff >= 0 ? '+' : '−'}{Math.abs(ch.diff)}</b> (from {ch.from.rating} on {fmtDate(`${ch.from.date}T12:00:00`)}).</p>}
      <div ref={ref}>
        <TimeChart width={width} t0={t0} t1={t1} y0={y0} y1={y1} yTicks={ticks} yFmt={v => String(v)} label="FargoRate rating over time" markers={markers}
          dots={e.map((x, i) => ({ key: i, t: ts[i], y: x.rating, r: 4, hollow: x.provisional || (x.robustness != null && x.robustness < ESTABLISHED) }))}
          line={e.map((x, i) => ({ t: ts[i], y: x.rating }))} />
      </div>
      <p class="small muted" style={{ margin: '4px 0 0' }}>Dots: recorded ratings (hollow when not yet established). Numbered flags: Journal entries.</p>
    </div>
  );
}

function ManualEntry({ fargo, onFargo }: { fargo: FargoData; onFargo: (f: FargoData) => Promise<void> }) {
  const [date, setDate] = useState(localYmd(new Date()));
  const [rating, setRating] = useState('');
  const [rob, setRob] = useState('');
  const r = Number(rating), rb = rob.trim() ? Number(rob) : undefined;
  const ok = rating.trim() !== '' && Number.isFinite(r) && r > 0 && r < 1000 && (rb == null || (Number.isFinite(rb) && rb >= 0)) && !!date;
  return (
    <details class="card">
      <summary>Add a rating by hand</summary>
      <div class="note-form" style={{ marginTop: '8px' }}>
        <label class="small">Date<input type="date" value={date} onInput={e => setDate((e.target as HTMLInputElement).value)} /></label>
        <label class="small">Rating<input type="number" inputMode="numeric" min={1} max={999} value={rating} onInput={e => setRating((e.target as HTMLInputElement).value)} /></label>
        <label class="small">Robustness (optional)<input type="number" inputMode="numeric" min={0} value={rob} onInput={e => setRob((e.target as HTMLInputElement).value)} /></label>
      </div>
      <button class="btn primary" style={{ marginTop: '8px' }} disabled={!ok} onClick={async () => {
        await onFargo(addEntry(fargo, { date, rating: Math.round(r), robustness: rb, source: 'manual' })); setRating(''); setRob('');
      }}>Add</button>
      <p class="small muted" style={{ margin: '6px 0 0' }}>One rating per day; a new one for the same day replaces it. Robustness is the number of games behind the rating, shown on your FargoRate profile.</p>
    </details>
  );
}

function EntryList({ fargo, onFargo }: { fargo: FargoData; onFargo: (f: FargoData) => Promise<void> }) {
  const [arm, setArm] = useState<string | null>(null);
  if (!fargo.entries.length) return null;
  return (
    <details class="card">
      <summary>All recorded ratings ({fargo.entries.length})</summary>
      <ul class="game-list" style={{ marginTop: '8px' }}>
        {[...fargo.entries].reverse().map(e => (
          <li key={e.date}>
            <div class="grow"><b class="num">{e.rating}</b> <span class="small muted">· {fmtDate(`${e.date}T12:00:00`)}{e.robustness != null ? ` · robustness ${int(e.robustness)}` : ''} · {e.source === 'lookup' ? 'from FargoRate' : 'entered'}</span></div>
            {arm === e.date
              ? <><button class="btn btn-s danger" onClick={async () => { await onFargo({ ...fargo, entries: fargo.entries.filter(x => x.date !== e.date) }); setArm(null); }}>Delete</button><button class="btn btn-s" onClick={() => setArm(null)}>Keep</button></>
              : <button class="btn btn-s" onClick={() => setArm(e.date)}>Delete</button>}
          </li>
        ))}
      </ul>
    </details>
  );
}
