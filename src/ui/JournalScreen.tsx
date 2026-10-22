import { useEffect, useMemo, useState } from 'preact/hooks';
import { track } from '../usage';
import type { AppData } from '../app';
import type { DrillDef } from '../engine/drills';
import type { TallySession } from '../engine/tally';
import type { Game } from '../engine/games';
import { NOTE_KIND_LABEL, timelineNotes, type Baseline, type Note, type NoteKind } from '../engine/progress';
import { buildCoachSummary, DEFAULT_COACH, shotsCsv, type CoachOptions } from '../engine/coach';
import { shareText } from '../notify';
import { saveTextFile } from '../platform';
import { rowsFor } from './ProgressScreen';
import { fmtDate, localYmd } from './format';

type Props = {
  data: AppData; notes: Note[]; tallies: TallySession[]; games: Game[]; drills: DrillDef[]; baseline: Baseline | null;
  onNotes: (n: Note[]) => Promise<void>; focus?: string | null;
};

export function JournalScreen(p: Props) {
  const timeline = useMemo(() => timelineNotes(p.notes, p.tallies), [p.notes, p.tallies]);
  const [filter, setFilter] = useState('');
  const shown = [...timeline].reverse().filter(n => !filter.trim() || n.text.toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <section>
      <h2>Journal</h2>
      <p class="lede">Date changes to your game or equipment; each entry is flagged on the Progress charts.</p>
      <NoteForm notes={p.notes} onNotes={p.onNotes} />
      <Share {...p} />
      <div class="card">
        <div class="row" style={{ alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Entries</h3>
          <span class="spacer" />
          {timeline.length > 4 && <input type="search" placeholder="Filter" value={filter} onInput={e => setFilter((e.target as HTMLInputElement).value)} style={{ maxWidth: '180px' }} aria-label="Filter entries" />}
        </div>
        {shown.length ? <EntryList entries={shown} notes={p.notes} onNotes={p.onNotes} focus={p.focus ?? null} />
          : <p class="small muted">{timeline.length ? 'No entries match.' : 'No entries yet.'}</p>}
      </div>
    </section>
  );
}

export function NoteForm({ notes, onNotes, compact, editing, onDone }: { notes: Note[]; onNotes: (n: Note[]) => Promise<void>; compact?: boolean; editing?: Note | null; onDone?: () => void }) {
  const [date, setDate] = useState(editing?.date ?? localYmd(new Date()));
  const [kind, setKind] = useState<NoteKind>(editing?.kind ?? 'technique');
  const [text, setText] = useState(editing?.text ?? '');
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (editing) { setDate(editing.date); setKind(editing.kind); setText(editing.text); } }, [editing?.id]);
  async function save() {
    const t = text.trim(); if (!t) return;
    if (editing) await onNotes(notes.map(n => (n.id === editing.id ? { ...n, date, kind, text: t } : n)));
    else await onNotes([...notes, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, date, kind, text: t }]);
    setText(''); setDate(localYmd(new Date())); setSaved(true); setTimeout(() => setSaved(false), 1600); onDone?.();
  }
  return (
    <div class={compact ? '' : 'card'}>
      {!compact && <h3 style={{ marginTop: 0 }}>{editing ? 'Edit entry' : 'New entry'}</h3>}
      <div class="note-form">
        <label class="small">Date<input type="date" value={date} onInput={e => setDate((e.target as HTMLInputElement).value)} /></label>
        <label class="small">Kind<select value={kind} onChange={e => setKind((e.target as HTMLSelectElement).value as NoteKind)}>
          {(Object.keys(NOTE_KIND_LABEL) as NoteKind[]).map(k => <option key={k} value={k}>{NOTE_KIND_LABEL[k]}</option>)}</select></label>
      </div>
      <label class="field" style={{ marginTop: '8px' }}>{kind === 'coach' ? 'Paste the summary' : 'Entry'}
        <textarea rows={kind === 'coach' ? 6 : 2} value={text} placeholder={kind === 'coach' ? 'Paste what your coach or chatbot wrote…' : 'e.g. Shortened the backswing on stun shots'}
          onInput={e => setText((e.target as HTMLTextAreaElement).value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); }} />
      </label>
      <div class="row" style={{ gap: '8px' }}>
        <button class="btn primary" disabled={!text.trim()} onClick={save}>{editing ? 'Save' : 'Add entry'}</button>
        {editing && <button class="btn" onClick={onDone}>Cancel</button>}
        {saved && <span class="small" style={{ color: 'var(--good)' }}>Saved to the Journal.</span>}
      </div>
    </div>
  );
}

function EntryList({ entries, notes, onNotes, focus }: { entries: ReturnType<typeof timelineNotes>; notes: Note[]; onNotes: (n: Note[]) => Promise<void>; focus: string | null }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set(focus ? [focus] : []));
  useEffect(() => { if (focus) document.getElementById(`note-${focus}`)?.scrollIntoView({ block: 'center' }); }, [focus]);
  return (
    <ol class="note-list">
      {entries.map(n => {
        const long = n.text.length > 220 || n.text.split('\n').length > 3;
        const expanded = open.has(n.id);
        return (
          <li key={n.id} id={`note-${n.id}`} class={focus === n.id ? 'focus' : ''}>
            <span class="note-num num">{n.n}</span>
            <div class="grow">
              <div class="small muted">{fmtDate(`${n.date}T12:00:00`)} · {n.fromTally ? `${n.fromTally} tally` : NOTE_KIND_LABEL[n.kind]}</div>
              {editing === n.id
                ? <NoteForm compact notes={notes} onNotes={onNotes} editing={notes.find(x => x.id === n.id) ?? null} onDone={() => setEditing(null)} />
                : <div class={`note-text ${long && !expanded ? 'clamped' : ''}`}>{n.text}</div>}
              {long && editing !== n.id && <button class="link-btn small" onClick={() => setOpen(s => { const x = new Set(s); x.has(n.id) ? x.delete(n.id) : x.add(n.id); return x; })}>{expanded ? 'Show less' : 'Show all'}</button>}
            </div>
            {!n.fromTally && editing !== n.id && (confirm === n.id
              ? <span class="row" style={{ gap: '6px' }}>
                  <button class="btn btn-s danger" onClick={async () => { await onNotes(notes.filter(x => x.id !== n.id)); setConfirm(null); }}>Delete</button>
                  <button class="btn btn-s" onClick={() => setConfirm(null)}>Keep</button>
                </span>
              : <span class="row" style={{ gap: '6px' }}>
                  <button class="btn btn-s" onClick={() => setEditing(n.id)}>Edit</button>
                  <button class="btn btn-s" onClick={() => setConfirm(n.id)}>Delete</button>
                </span>)}
          </li>
        );
      })}
    </ol>
  );
}

// ---------- share with a coach or chatbot ----------

function Share(p: Props) {
  const [open, setOpen] = useState(false);
  const [o, setO] = useState<CoachOptions>(DEFAULT_COACH);
  const [msg, setMsg] = useState<string | null>(null);
  const text = useMemo(() => (open ? buildCoachSummary(o, { baseline: p.baseline, rows: rowsFor(p.data), notes: p.notes, tallies: p.tallies, games: p.games, drills: p.drills }) : ''), [open, o, p.baseline, p.data.exclusions, p.notes, p.tallies, p.games]);
  const tog = (k: keyof Omit<CoachOptions, 'days'>) => setO({ ...o, [k]: !o[k] });
  return (
    <div class="card">
      <div class="row"><h3 style={{ margin: 0 }}>Share with your coach AI</h3><span class="spacer" /><button class="btn btn-s" onClick={() => { setOpen(!open); setMsg(null); }}>{open ? 'Close' : 'Prepare a summary'}</button></div>
      {!open && <p class="small muted" style={{ margin: '6px 0 0' }}>One summary any chatbot can read: how to read the numbers, your current picture, and journal entries with the numbers around them. To bring a reply back, add it above as a “Coach or chatbot summary” entry.</p>}
      {open && <>
        <div class="controls" style={{ marginTop: '10px' }}>
          <label>Period<select value={String(o.days)} onChange={e => { const v = (e.target as HTMLSelectElement).value; setO({ ...o, days: v === 'null' ? null : Number(v) }); }}>
            <option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option><option value="null">All time</option></select></label>
        </div>
        <div class="share-opts">
          {([['overall', 'Overall trend'], ['plan', 'Targets and strengths'], ['drills', 'Drills and games'], ['journal', 'Journal entries'], ['sessions', 'Recent sessions']] as const).map(([k, l]) => (
            <label key={k} class="small switch-row"><input type="checkbox" checked={o[k]} onChange={() => tog(k)} /> {l}</label>
          ))}
        </div>
        <textarea class="mono" rows={10} readOnly value={text} style={{ marginTop: '8px' }} />
        <div class="row" style={{ gap: '8px', marginTop: '8px' }}>
          <button class="btn primary" onClick={async () => { const r = await shareText('Pool practice summary', text); setMsg(r === 'copied' ? 'Copied: paste it into your chatbot.' : r === 'shared' ? null : 'Could not share; select the text and copy it.'); }}>Share…</button>
          <button class="btn" onClick={async () => { try { await navigator.clipboard.writeText(text); setMsg('Copied: paste it into your chatbot.'); } catch { setMsg('Could not copy; select the text instead.'); } }}>Copy</button>
          <button class="btn" onClick={() => { track('shots_csv_saved'); return saveTextFile(`electro-coach-shots-${localYmd(new Date())}.csv`, shotsCsv(rowsFor(p.data), o.days), 'text/csv'); }}>Save shots as CSV</button>
        </div>
        <p class="small muted" style={{ margin: '6px 0 0' }}>{text.length.toLocaleString()} characters. The CSV holds every kept shot in the period, for a chatbot that reads files.</p>
        {msg && <div class="notice good" style={{ marginTop: '8px' }}>{msg}</div>}
      </>}
    </div>
  );
}
