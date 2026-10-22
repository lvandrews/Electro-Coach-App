import { useRef, useState } from 'preact/hooks';
import type { AppData } from '../app';
import { RULES, DEFAULT_RULES, tally, type RuleConfig, type RuleId } from '../engine/rules';
import * as store from '../store/db';
import { saveTextFile } from '../platform';
import { int, localYmd } from './format';
import { SLOT_CHOICES, DEFAULT_BAR } from './nav';
import { setPrefs, usePrefs, type DataPalette, type HeatPalette, type ThemePref, type TierPalette } from './prefs';

const THRESHOLDS: Partial<Record<RuleId, { key: keyof RuleConfig; unit: string; step: number }>> = {
  cut: { key: 'maxCutDeg', unit: '°', step: 1 },
  approach: { key: 'maxApproachDeg', unit: '°', step: 1 },
  fp: { key: 'fpScoreExclude', unit: '', step: 0.05 },
  break: { key: 'breakMph', unit: 'mph', step: 0.5 },
};

interface Props { data: AppData; device: string; onDevice: (n: string) => void; onRules: (r: RuleConfig) => void; onRestored: () => Promise<void>; onBackedUp: (iso: string) => void }

export function SettingsScreen({ data, device, onDevice, onRules, onRestored, onBackedUp }: Props) {
  const r = data.rules;
  const counts = Object.fromEntries(tally(data.exclusions).map(t => [t.id, t]));
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<{ name: string; backup: store.Backup } | null>(null);
  const [armErase, setArmErase] = useState(false);

  const setNum = (k: keyof RuleConfig) => (e: Event) => {
    const v = Number((e.target as HTMLInputElement).value);
    if (Number.isFinite(v)) onRules({ ...r, [k]: v });
  };
  const toggle = (id: RuleId) => onRules({ ...r, enabled: { ...r.enabled, [id]: !r.enabled[id] } });

  async function backup() {
    const b = await store.makeBackup();
    await saveTextFile(`electro-coach-backup-${localYmd(new Date())}.json`, JSON.stringify(b));
    const at = new Date().toISOString(); await store.saveLastBackup(at); onBackedUp(at);
    setMsg(`Backup made: ${int(b.shots.length)} shots, ${int(b.imports.length)} import reports, your rule settings.`);
  }
  async function pickRestore(f: File) {
    try {
      const b = JSON.parse(await f.text()) as store.Backup;
      if (b.app !== 'electro-coach') throw new Error('this file is not an Electro-Coach backup');
      setPending({ name: f.name, backup: b }); setMsg(null);
    } catch (e) { setMsg(`Could not read the backup: ${e instanceof Error ? e.message : String(e)}`); }
  }
  async function restore() {
    if (!pending) return;
    await store.restoreBackup(pending.backup); await onRestored();
    setMsg(`Backup restored: ${int(pending.backup.shots.length)} shots.`); setPending(null);
  }
  async function erase() {
    if (!armErase) { setArmErase(true); return; }
    await store.eraseAll(); await onRestored(); setArmErase(false); setMsg('All data deleted.');
  }

  return (
    <section>
      <h2>Settings</h2>
      <p class="lede" style={{ marginBottom: '10px' }}>Appearance, cleaning rules, this device's name, backups.</p>
      {msg && <div class="notice good" role="status">{msg}</div>}

      <Appearance />

      <div class="card">
        <h3>Cleaning rules</h3>
        <p class="small muted" style={{ marginTop: 0 }}>
          These decide which stored shots count. They run over everything you have stored, so changes apply instantly and are reversible.
        </p>
        {RULES.map(rule => {
          const th = THRESHOLDS[rule.id];
          const c = counts[rule.id];
          return (
            <div class="toggle-row" key={rule.id}>
              <div>
                <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 600 }}>
                  <input type="checkbox" checked={r.enabled[rule.id]} onChange={() => toggle(rule.id)} />
                  {rule.label}
                </label>
                <div class="small">{rule.describe(r)}</div>
                <div class="why">{rule.why}</div>
                {r.enabled[rule.id] && c && <div class="small num" style={{ marginTop: '3px' }}>Flags {int(c.flagged)} shots ({int(c.only)} for this reason alone).</div>}
              </div>
              {th && (
                <label class="small muted" style={{ display: 'grid', gap: '2px', justifyItems: 'end' }}>
                  {th.unit || 'score'}
                  <input type="number" step={th.step} value={r[th.key] as number} disabled={!r.enabled[rule.id]} onChange={setNum(th.key)} />
                </label>
              )}
            </div>
          );
        })}
        <div class="row" style={{ marginTop: '12px' }}>
          <button class="btn" onClick={() => onRules(DEFAULT_RULES)}>Reset to workbook rules</button>
        </div>
      </div>

      <div class="card">
        <h3>This device</h3>
        <label class="field">Name shown on tallies recorded here
          <input id="device-name" type="text" value={device} onChange={e => { const v = (e.target as HTMLInputElement).value.trim(); if (v) onDevice(v); }} />
        </label>
      </div>

      <div class="card">
        <h3>Backup</h3>
        <p class="small muted" style={{ marginTop: 0 }}>
          Your data lives only on this device. A backup is one file holding every shot (with Railbird's original values), every import report, your tallies, drill layouts, yardstick, notes, plan, bowling games, matches and these settings.
        </p>
        <div class="row">
          <button class="btn primary" onClick={backup}>Make a backup</button>
          <button class="btn" onClick={() => file.current?.click()}>Restore from backup</button>
          <input ref={file} type="file" accept=".json,application/json" hidden onChange={e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) pickRestore(f); (e.target as HTMLInputElement).value = ''; }} />
        </div>
        {pending && (
          <div class="notice" style={{ marginTop: '12px' }}>
            <p style={{ margin: '0 0 8px' }}>{pending.name} holds {int(pending.backup.shots.length)} shots, made {pending.backup.exportedAt.slice(0, 10)}. Restoring replaces everything stored now.</p>
            <div class="row"><button class="btn primary" onClick={restore}>Replace with this backup</button><button class="btn" onClick={() => setPending(null)}>Cancel</button></div>
          </div>
        )}
      </div>

      <div class="card">
        <h3>Start over</h3>
        <p class="small muted" style={{ marginTop: 0 }}>Deletes everything stored on this device. It takes two taps, and nothing is deleted until the second.</p>
        {!armErase
          ? <button class="btn danger" onClick={erase}>Delete all data…</button>
          : <div class="notice bad">
              <p style={{ margin: '0 0 6px' }}><b>This deletes, on this device:</b> {int(data.shots.size)} shots and their import reports, every tally, drill layout and custom drill,
                your yardstick, notes, tracked segments and practice-plan text, and every bowling game and straight-pool match.</p>
              <p style={{ margin: '0 0 10px' }}>It cannot be undone. Make a backup first if there is any chance you will want it back.</p>
              <div class="row">
                <button class="btn primary" onClick={() => setArmErase(false)}>Keep my data</button>
                <button class="btn danger" onClick={erase}>Yes, delete everything</button>
              </div>
            </div>}
      </div>
    </section>
  );
}

function Choice<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: { id: T; label: string; swatch?: string[] }[]; onPick: (v: T) => void }) {
  return (
    <div class="pref-row">
      <div class="pref-label">{label}</div>
      <div class="seg wrap" role="group" aria-label={label}>
        {options.map(o => (
          <button key={o.id} aria-pressed={value === o.id} onClick={() => onPick(o.id)}>
            {o.swatch && <span class="pref-swatch" aria-hidden="true">{o.swatch.map((c, i) => <i key={i} style={{ background: c }} />)}</span>}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Appearance() {
  const p = usePrefs();
  return (
    <div class="card">
      <h3>Appearance</h3>
      <p class="small muted" style={{ marginTop: 0 }}>Saved on this device only, so a phone and a laptop can differ.</p>
      <Choice<ThemePref> label="Theme" value={p.theme} onPick={v => setPrefs({ theme: v })} options={[
        { id: 'system', label: 'Match the phone' }, { id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }]} />
      <Choice<DataPalette> label="Chart color (dots, lines, meters)" value={p.data} onPick={v => setPrefs({ data: v })} options={[
        { id: 'blue', label: 'Blue', swatch: ['#2a78d6'] }, { id: 'teal', label: 'Teal', swatch: ['#0f8a7e'] },
        { id: 'violet', label: 'Violet', swatch: ['#6a4fc7'] }, { id: 'amber', label: 'Amber', swatch: ['#b06d06'] }]} />
      <Choice<TierPalette> label="Strengths and weaknesses" value={p.tiers} onPick={v => setPrefs({ tiers: v })} options={[
        { id: 'green-red', label: 'Green / red', swatch: ['#2e8b3e', '#8fc271', '#eea15a', '#c63b2f'] },
        { id: 'blue-orange', label: 'Blue / orange (color-blind safe)', swatch: ['#1f6fb5', '#7fb2e0', '#f0a35a', '#c8590f'] }]} />
      <Choice<HeatPalette> label="Table heat map" value={p.heat} onPick={v => setPrefs({ heat: v })} options={[
        { id: 'green-red', label: 'Green → red', swatch: ['#1e7a3c', '#8cc65a', '#f2dc4b', '#f28c28', '#c62828'] },
        { id: 'viridis', label: 'Yellow → purple (color-blind safe)', swatch: ['#fde725', '#35b779', '#26828e', '#3e4a89', '#440154'] }]} />
      <div class="pref-row">
        <div class="pref-label">Bottom bar</div>
        <div class="small muted">Four places one tap away; everything else is under More (or swipe in from the left edge).</div>
        <div class="bar-picks">
          {[0, 1, 2, 3].map(i => (
            <select key={i} value={p.bar[i] ?? ''} aria-label={`Bottom bar slot ${i + 1}`} onChange={e => { const v = (e.target as HTMLSelectElement).value; const bar = [...p.bar]; const j = bar.indexOf(v); if (j >= 0) bar[j] = bar[i]; bar[i] = v; setPrefs({ bar }); }}>
              {SLOT_CHOICES.map(sl => <option key={sl.id} value={sl.id}>{sl.label}</option>)}
            </select>
          ))}
        </div>
        {p.bar.join() !== DEFAULT_BAR.join() && <button class="btn btn-s" style={{ width: 'fit-content' }} onClick={() => setPrefs({ bar: DEFAULT_BAR })}>Restore Home · Practice · Play · Progress</button>}
      </div>
    </div>
  );
}
