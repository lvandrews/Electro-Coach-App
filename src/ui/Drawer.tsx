import { useEffect, useRef, useState } from 'preact/hooks';
import type { DrillDef } from '../engine/drills';
import type { Note } from '../engine/progress';
import { ROUTINE } from '../engine/routine';
import { hostOf, type ResourceGroup } from '../engine/resources';
import { DESTS, GROUPS, type Dest, type Tab } from './nav';
import { fmtDate } from './format';

export type DrawerPick =
  | { kind: 'dest'; dest: Dest }
  | { kind: 'drill'; id: string }
  | { kind: 'note'; id: string }
  | { kind: 'routine'; id: string }
  | { kind: 'resource'; id: string };

interface Props {
  open: boolean; current: Tab; drills: DrillDef[]; notes: Note[]; resources: ResourceGroup[];
  onPick: (p: DrawerPick) => void; onClose: () => void;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Left-side drawer with every destination, grouped, and a search box at the top. */
export function Drawer({ open, current, drills, notes, resources, onPick, onClose }: Props) {
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => { if (!open) setQ(''); }, [open]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);

  const words = norm(q).split(/\s+/).filter(Boolean);
  const hit = (text: string) => words.every(w => norm(text).includes(w));
  const results = words.length ? {
    dests: DESTS.filter(d => hit(`${d.label} ${d.short} ${d.keywords} ${d.group ?? ''}`)),
    drills: drills.filter(d => hit(`${d.name} ${d.short ?? ''} ${d.tags.map(t => t.value).join(' ')} ${d.setup.join(' ')}`)).slice(0, 6),
    notes: notes.filter(n => hit(`${n.text} ${n.date}`)).slice(0, 6),
    routine: ROUTINE.sections.filter(s => hit(`${s.title} ${s.points.join(' ')}`)).slice(0, 4),
    links: resources.flatMap(g => g.links.map(l => ({ ...l, group: g.title }))).filter(l => hit(`${l.name} ${l.url} ${l.note ?? ''} ${l.group}`)).slice(0, 6),
  } : null;

  return (
    <div class={`drawer-wrap ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div class="drawer-scrim" onClick={onClose} />
      <div ref={panel} class="drawer" role="dialog" aria-label="All sections"
        onTouchStart={e => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
        onTouchEnd={e => {
          const t = touch.current; touch.current = null; if (!t) return;
          const dx = e.changedTouches[0].clientX - t.x, dy = e.changedTouches[0].clientY - t.y;
          if (dx < -60 && Math.abs(dy) < 50) onClose();
        }}>
        <div class="drawer-head">
          <input ref={input} type="search" placeholder="Search: pages, drills, notes…" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} aria-label="Search the app" />
          <button class="x-btn" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div class="drawer-body">
          {results ? (
            <>
              {!results.dests.length && !results.drills.length && !results.notes.length && !results.routine.length && !results.links.length && <p class="small muted">Nothing matches “{q}”.</p>}
              {results.dests.length > 0 && <DrawerGroup title="Pages">{results.dests.map(d => <Item key={d.id} label={d.label} active={false} onClick={() => onPick({ kind: 'dest', dest: d })} />)}</DrawerGroup>}
              {results.drills.length > 0 && <DrawerGroup title="Drills">{results.drills.map(d => <Item key={d.id} label={d.name} onClick={() => onPick({ kind: 'drill', id: d.id })} />)}</DrawerGroup>}
              {results.notes.length > 0 && <DrawerGroup title="Journal">{results.notes.map(n => <Item key={n.id} label={n.text.length > 70 ? `${n.text.slice(0, 70)}…` : n.text} sub={fmtDate(`${n.date}T12:00:00`)} onClick={() => onPick({ kind: 'note', id: n.id })} />)}</DrawerGroup>}
              {results.links.length > 0 && <DrawerGroup title="Resources">{results.links.map(l => <Item key={l.id} label={l.name} sub={`${l.group} · ${hostOf(l.url)}`} onClick={() => onPick({ kind: 'resource', id: l.id })} />)}</DrawerGroup>}
              {results.routine.length > 0 && <DrawerGroup title="Pre-shot routine">{results.routine.map(s => <Item key={s.id} label={s.title} onClick={() => onPick({ kind: 'routine', id: s.id })} />)}</DrawerGroup>}
            </>
          ) : (
            <>
              <Item label="Home" active={current === 'home'} onClick={() => onPick({ kind: 'dest', dest: DESTS[0] })} />
              {GROUPS.map(g => (
                <DrawerGroup key={g} title={g}>
                  {DESTS.filter(d => d.group === g).map(d => <Item key={d.id} label={d.label} active={!d.play && current === d.tab} onClick={() => onPick({ kind: 'dest', dest: d })} />)}
                </DrawerGroup>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DrawerGroup({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return <div class="drawer-group"><div class="drawer-title">{title}</div>{children}</div>;
}
function Item({ label, sub, active, onClick }: { label: string; sub?: string; active?: boolean; onClick: () => void }) {
  return (
    <button class={`drawer-item ${active ? 'active' : ''}`} onClick={onClick}>
      <span class="diamond" aria-hidden="true" />
      <span class="grow">{label}{sub && <span class="small muted"> · {sub}</span>}</span>
    </button>
  );
}
