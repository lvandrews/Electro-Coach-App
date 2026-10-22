import { useEffect, useState } from 'preact/hooks';
import { hostOf, newResourceId, normalizeUrl, STARTER_RESOURCES, type ResourceGroup, type ResourceLink } from '../engine/resources';
import { openExternal } from '../platform';

type Props = { groups: ResourceGroup[] | null; onGroups: (g: ResourceGroup[] | null) => Promise<void>; focus?: string | null };

export function ResourcesScreen({ groups: saved, onGroups, focus }: Props) {
  const groups = saved ?? STARTER_RESOURCES;
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);     // group id
  const [editLink, setEditLink] = useState<string | null>(null); // link id
  const [newGroup, setNewGroup] = useState('');
  useEffect(() => { if (focus) document.getElementById(`res-${focus}`)?.scrollIntoView({ block: 'center' }); }, [focus]);
  const save = (g: ResourceGroup[]) => onGroups(g);
  const setGroup = (id: string, fn: (g: ResourceGroup) => ResourceGroup | null) =>
    save(groups.map(g => (g.id === id ? fn(g) : g)).filter((g): g is ResourceGroup => !!g));
  const move = (gid: string, i: number, d: -1 | 1) => setGroup(gid, g => {
    const links = [...g.links]; const j = i + d; if (j < 0 || j >= links.length) return g;
    [links[i], links[j]] = [links[j], links[i]]; return { ...g, links };
  });

  return (
    <section>
      <h2>Resources</h2>
      <p class="lede">Sites and channels worth keeping close. Links open in your browser.</p>
      <div class="row" style={{ gap: '8px', marginBottom: '12px' }}>
        <button class="btn" aria-pressed={editing} onClick={() => { setEditing(!editing); setAdding(null); setEditLink(null); }}>{editing ? 'Done editing' : 'Edit list'}</button>
        {editing && saved && <button class="btn" onClick={() => onGroups(null)}>Restore the starter list</button>}
      </div>

      {groups.map(g => (
        <div key={g.id} class="card">
          <div class="row" style={{ alignItems: 'baseline' }}>
            {editing
              ? <input type="text" value={g.title} aria-label="Group name" onChange={e => setGroup(g.id, x => ({ ...x, title: (e.target as HTMLInputElement).value.trim() || x.title }))} style={{ flex: 1, minWidth: 0, fontWeight: 700 }} />
              : <h3 style={{ margin: 0 }}>{g.title}</h3>}
            {editing && !g.links.length && <button class="btn btn-s danger" onClick={() => setGroup(g.id, () => null)}>Remove group</button>}
          </div>
          <ul class="res-list">
            {g.links.map((l, i) => (
              <li key={l.id} id={`res-${l.id}`} class={focus === l.id ? 'focus' : ''}>
                {editLink === l.id
                  ? <LinkForm link={l} onCancel={() => setEditLink(null)} onSave={async v => { await setGroup(g.id, x => ({ ...x, links: x.links.map(y => (y.id === l.id ? { ...y, ...v } : y)) })); setEditLink(null); }}
                      onDelete={async () => { await setGroup(g.id, x => ({ ...x, links: x.links.filter(y => y.id !== l.id) })); setEditLink(null); }} />
                  : <>
                    <button class="res-link" onClick={() => openExternal(l.url)}>
                      <span class="res-name">{l.name}</span>
                      <span class="small muted">{hostOf(l.url)}{l.note ? ` · ${l.note}` : ''}</span>
                    </button>
                    {editing && <span class="row" style={{ gap: '4px', flexWrap: 'nowrap' }}>
                      <button class="btn btn-s" aria-label={`Move ${l.name} up`} disabled={i === 0} onClick={() => move(g.id, i, -1)}>↑</button>
                      <button class="btn btn-s" aria-label={`Move ${l.name} down`} disabled={i === g.links.length - 1} onClick={() => move(g.id, i, 1)}>↓</button>
                      <button class="btn btn-s" onClick={() => setEditLink(l.id)}>Edit</button>
                    </span>}
                  </>}
              </li>
            ))}
          </ul>
          {editing && (adding === g.id
            ? <LinkForm onCancel={() => setAdding(null)} onSave={async v => { await setGroup(g.id, x => ({ ...x, links: [...x.links, { id: newResourceId(), ...v }] })); setAdding(null); }} />
            : <button class="btn btn-s" onClick={() => setAdding(g.id)}>Add a link</button>)}
        </div>
      ))}

      {editing && (
        <div class="card">
          <label class="field">New group
            <div class="row" style={{ gap: '8px', flexWrap: 'nowrap' }}>
              <input type="text" value={newGroup} placeholder="e.g. Rules and leagues" onInput={e => setNewGroup((e.target as HTMLInputElement).value)} style={{ flex: 1, minWidth: 0 }} />
              <button class="btn primary" disabled={!newGroup.trim()} onClick={async () => { await save([...groups, { id: newResourceId(), title: newGroup.trim(), links: [] }]); setNewGroup(''); }}>Add</button>
            </div>
          </label>
        </div>
      )}
    </section>
  );
}

function LinkForm({ link, onSave, onCancel, onDelete }: {
  link?: ResourceLink; onSave: (v: Omit<ResourceLink, 'id'>) => void; onCancel: () => void; onDelete?: () => void;
}) {
  const [name, setName] = useState(link?.name ?? '');
  const [url, setUrl] = useState(link?.url ?? '');
  const [note, setNote] = useState(link?.note ?? '');
  const [arm, setArm] = useState(false);
  const u = normalizeUrl(url);
  return (
    <div class="res-form">
      <label class="field">Name<input type="text" value={name} onInput={e => setName((e.target as HTMLInputElement).value)} /></label>
      <label class="field">Web address<input type="url" inputMode="url" value={url} placeholder="https://" onInput={e => setUrl((e.target as HTMLInputElement).value)} />
        {url.trim() && !u && <span class="small warn-text">That doesn't look like a web address.</span>}</label>
      <label class="field">Note (optional)<input type="text" value={note} placeholder="What it's good for" onInput={e => setNote((e.target as HTMLInputElement).value)} /></label>
      <div class="row" style={{ gap: '8px' }}>
        <button class="btn primary" disabled={!name.trim() || !u} onClick={() => onSave({ name: name.trim(), url: u!, note: note.trim() || undefined })}>Save</button>
        <button class="btn" onClick={onCancel}>Cancel</button>
        {onDelete && (arm ? <button class="btn danger" onClick={onDelete}>Yes, remove it</button> : <button class="btn danger" onClick={() => setArm(true)}>Remove…</button>)}
      </div>
    </div>
  );
}
