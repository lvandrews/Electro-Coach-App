import { useState } from 'preact/hooks';
import { playedText, POCKET_SIZES as POCKETS, type Game, type Played, type TableInfo } from '../engine/games';
export { playedText, type Played };

// Where a game was played and on what: venue, table brand and model, size, pocket size.
// Brands and models are free text with suggestions; picking a venue you've played at
// before fills in the table you last recorded there.

const BRANDS = ['Diamond', 'Brunswick', 'Olhausen', 'Rasson', 'Predator', 'Valley', 'Dynamic', 'Wiraka', 'Chevillotte'];
const MODELS: Record<string, string[]> = {
  diamond: ['Professional', 'Pro-Am', 'Blue Label', 'Smart Table'],
  brunswick: ['Gold Crown VI', 'Gold Crown VII', 'Metro', 'Centurion'],
  rasson: ['Victory II', 'OX'],
  predator: ['Arcadia'],
};
const SIZES: NonNullable<TableInfo['size']>[] = ['7ft', '8ft', '9ft', '10ft'];
const sizeLabel = (s: string) => s.replace('ft', ' ft');

const norm = (s?: string) => (s ?? '').trim().toLowerCase();

export function TableFields({ value, onChange, history, idPrefix }: { value: Played; onChange: (p: Played) => void; history: Played[]; idPrefix: string }) {
  const t = value.table ?? {};
  const set = (patch: Partial<TableInfo>) => onChange({ ...value, table: { ...t, ...patch } });
  const venues = [...new Set(history.map(h => h.venue?.trim()).filter((v): v is string => !!v))];
  const brands = [...new Set([...history.map(h => h.table?.brand?.trim()).filter((v): v is string => !!v), ...BRANDS])];
  const models = [...new Set([
    ...history.filter(h => norm(h.table?.brand) === norm(t.brand)).map(h => h.table?.model?.trim()).filter((v): v is string => !!v),
    ...(MODELS[norm(t.brand)] ?? []),
  ])];
  return (
    <div class="clock-settings table-fields">
      <label>Venue (optional)
        <input type="text" value={value.venue ?? ''} list={`${idPrefix}-venues`} placeholder="Where you're playing" onInput={e => {
          const v = (e.target as HTMLInputElement).value;
          const known = history.find(h => norm(h.venue) === norm(v) && h.table);
          onChange(known ? { venue: v, table: { ...known.table } } : { ...value, venue: v });
        }} />
        <datalist id={`${idPrefix}-venues`}>{venues.map(v => <option key={v} value={v} />)}</datalist>
      </label>
      <label>Table brand
        <input type="text" value={t.brand ?? ''} list={`${idPrefix}-brands`} placeholder="e.g. Diamond" onInput={e => set({ brand: (e.target as HTMLInputElement).value })} />
        <datalist id={`${idPrefix}-brands`}>{brands.map(v => <option key={v} value={v} />)}</datalist>
      </label>
      <label>Model or line
        <input type="text" value={t.model ?? ''} list={`${idPrefix}-models`} placeholder="e.g. Gold Crown VII" onInput={e => set({ model: (e.target as HTMLInputElement).value })} />
        <datalist id={`${idPrefix}-models`}>{models.map(v => <option key={v} value={v} />)}</datalist>
      </label>
      <label>Table size
        <select value={t.size ?? ''} onChange={e => set({ size: ((e.target as HTMLSelectElement).value || undefined) as TableInfo['size'] })}>
          <option value="">Not noted</option>{SIZES.map(s => <option key={s} value={s}>{sizeLabel(s)}</option>)}
        </select>
      </label>
      <label>Pocket size
        <select value={t.pocketIn != null ? String(t.pocketIn) : ''} onChange={e => { const v = (e.target as HTMLSelectElement).value; set({ pocketIn: v ? Number(v) : undefined }); }}>
          <option value="">Not noted</option>{POCKETS.map(p => <option key={p.v} value={String(p.v)}>{p.label}</option>)}
        </select>
      </label>
    </div>
  );
}

/** Tidy a Played value before saving: trim text, drop empty fields. */
export function cleanPlayed(p: Played): Played {
  const t = p.table ?? {};
  const table: TableInfo = {};
  if (t.brand?.trim()) table.brand = t.brand.trim();
  if (t.model?.trim()) table.model = t.model.trim();
  if (t.size) table.size = t.size;
  if (t.pocketIn) table.pocketIn = t.pocketIn;
  return { venue: p.venue?.trim() || undefined, table: Object.keys(table).length ? table : undefined };
}

/** A one-line summary with an Edit button that opens the fields. */
export function PlayedLine({ value, history, idPrefix, onSave }: { value: Played; history: Played[]; idPrefix: string; onSave: (p: Played) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Played>(value);
  const text = playedText(value);
  return (
    <div class="played">
      {!open ? (
        <div class="row" style={{ gap: '8px', alignItems: 'baseline' }}>
          <span class="small grow" style={{ minWidth: 0 }}>{text || <span class="muted">Venue and table not noted.</span>}</span>
          <button class="btn btn-s" onClick={() => { setDraft(value); setOpen(true); }}>{text ? 'Edit table' : 'Add venue and table'}</button>
        </div>
      ) : <>
        <TableFields value={draft} onChange={setDraft} history={history} idPrefix={idPrefix} />
        <div class="row" style={{ gap: '8px', marginTop: '8px' }}>
          <button class="btn primary btn-s" onClick={() => { onSave(cleanPlayed(draft)); setOpen(false); }}>Save</button>
          <button class="btn btn-s" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      </>}
    </div>
  );
}

/** Venues and tables from every game, newest first (for suggestions and auto-fill). */
export function playedHistory(games: Game[]): Played[] {
  return [...games].sort((a, b) => (a.date < b.date ? 1 : -1))
    .filter((g): g is Extract<Game, { venue?: string }> => g.kind === 'straight-pool' || g.kind === 'bowling')
    .map(g => ({ venue: g.venue, table: g.table })).filter(p => p.venue || p.table);
}

