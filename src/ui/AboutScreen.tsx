import { useEffect, useRef, useState } from 'preact/hooks';
import { openExternal } from '../platform';
import { isNewer, shouldPrompt, type ReleaseInfo } from '../engine/update';
import { LATEST_APK_URL, canCheckForUpdates, downloadUpdate, fetchLatest, installUpdate, launchCheck, snooze, updateMemory } from '../update';
import { platformName, usageConfigured, usageOn } from '../usage';
import { APP_VERSION, REPO_URL } from '../version';
import { fmtDate } from './format';
import type { Tab } from './nav';
import { RailbirdRole } from './RailbirdRole';

const PLATFORM_LABEL: Record<string, string> = {
  android: 'Android app', ios: 'iPhone app', 'iphone-web': 'iPhone web version', 'iphone-home-screen': 'iPhone home-screen app',
  'web-installed': 'installed web app', 'web-file': 'single-file version', web: 'web version',
};
const versionText = () => (APP_VERSION === 'web' || APP_VERSION === 'dev' ? '' : `Version ${APP_VERSION} · `) + (PLATFORM_LABEL[platformName()] ?? platformName());


/** Open the newest APK in the browser: the fallback when the in-app download can't be used. */
function browserDownload(r: ReleaseInfo | null) { openExternal(r?.apkUrl ?? LATEST_APK_URL); }

/** Lets the back gesture close the update pop-up (app.tsx asks this first). Null when it isn't open. */
export let closeUpdatePrompt: (() => void) | null = null;
let openUpdatePrompt: ((r: ReleaseInfo) => void) | null = null;
/** Open the pop-up for a release found by About → Check for updates. */
export const showUpdatePrompt = (r: ReleaseInfo) => openUpdatePrompt?.(r);

type Stage = { s: 'ask' } | { s: 'downloading'; frac: number | null; mb: number } | { s: 'ready'; path: string }
  | { s: 'permission'; path: string } | { s: 'installing'; path: string } | { s: 'error'; msg: string };

/**
 * The pop-up shown when GitHub has a newer Android release: at launch and whenever the app
 * comes back to the front (GitHub is asked at most twice a day). Update now downloads the APK
 * inside the app and opens Android's installer; Later asks again in a day.
 */
export function UpdatePrompt() {
  const [rel, setRel] = useState<ReleaseInfo | null>(null);
  const [stage, setStage] = useState<Stage>({ s: 'ask' });
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    openUpdatePrompt = r => { setRel(r); setStage({ s: 'ask' }); };
    const demo = import.meta.env.DEV && new URLSearchParams(location.search).get('update-demo');
    if (demo != null) {
      setRel({ version: '0.1.99', apkUrl: null, pageUrl: '', published: null, notes: 'Shot clock: Reset button.\nDaily FargoRate check.' });
      if (demo === 'downloading') setStage({ s: 'downloading', frac: 0.62, mb: 3.1 });
      if (demo === 'ready') setStage({ s: 'ready', path: '' });
      if (demo === 'permission') setStage({ s: 'permission', path: '' });
      return () => { openUpdatePrompt = null; };
    }
    if (!canCheckForUpdates()) return () => { openUpdatePrompt = null; };
    let busy = false;
    const look = async () => {
      if (busy || document.visibilityState === 'hidden') return;
      busy = true;
      try { const r = await launchCheck(); if (shouldPrompt(r, APP_VERSION, updateMemory(), Date.now())) setRel(cur => cur ?? r); }
      finally { busy = false; }
    };
    const t = setTimeout(look, 2500);
    const onVis = () => { if (document.visibilityState === 'visible') void look(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', onVis); openUpdatePrompt = null; };
  }, []);

  const close = () => { setRel(null); setStage({ s: 'ask' }); };
  const later = () => { snooze(); close(); };
  const start = async () => {
    if (!rel) return;
    setStage({ s: 'downloading', frac: 0, mb: 0 });
    try {
      const path = await downloadUpdate(rel, (frac, received) => setStage({ s: 'downloading', frac, mb: received / 1048576 }));
      await install(path);
    } catch (e) { setStage({ s: 'error', msg: e instanceof Error ? e.message : String(e) }); }
  };
  const install = async (path: string) => {
    setStage({ s: 'installing', path });
    try { setStage((await installUpdate(path)) === 'permission' ? { s: 'permission', path } : { s: 'ready', path }); }
    catch (e) { setStage({ s: 'error', msg: e instanceof Error ? e.message : String(e) }); }
  };

  useEffect(() => {
    if (!rel) { closeUpdatePrompt = null; return; }
    // While downloading, back and Escape leave it alone; otherwise they close (Later from the first screen).
    closeUpdatePrompt = stage.s === 'downloading' || stage.s === 'installing' ? () => {} : stage.s === 'ask' ? later : close;
    btn.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') closeUpdatePrompt?.(); };
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); closeUpdatePrompt = null; };
  }, [rel, stage.s]);

  if (!rel) return null;
  const pct = stage.s === 'downloading' && stage.frac != null ? Math.round(stage.frac * 100) : null;
  return (
    <div class="modal-wrap" role="dialog" aria-modal="true" aria-labelledby="update-title">
      <div class="modal-scrim" onClick={() => closeUpdatePrompt?.()} />
      <div class="modal card update-modal">
        {stage.s === 'ask' && <>
          <h3 id="update-title" style={{ marginTop: 0 }}>Update available: version {rel.version}</h3>
          <p class="small" style={{ marginTop: 0 }}>You have {APP_VERSION}. The update installs over this version and keeps all your data.</p>
          {rel.notes && <details class="small" open style={{ margin: '0 0 10px' }}><summary>What's new</summary><div class="release-notes">{rel.notes}</div></details>}
          <div class="row" style={{ gap: '8px' }}>
            <button ref={btn} class="btn primary" onClick={start}>Update now</button>
            <button class="btn" onClick={later}>Later</button>
          </div>
          <p class="small muted" style={{ margin: '8px 0 0' }}>Later asks again tomorrow. About → Check for updates works any time.</p>
        </>}
        {stage.s === 'downloading' && <>
          <h3 id="update-title" style={{ marginTop: 0 }}>Downloading version {rel.version}…</h3>
          <div class="update-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
            <span style={{ width: `${pct ?? 30}%` }} class={pct == null ? 'indeterminate' : ''} /></div>
          <p class="small muted num" style={{ margin: '6px 0 0' }}>{pct != null ? `${pct}% · ` : ''}{stage.mb.toFixed(1)} MB. Keep the app open; the installer opens when it's done.</p>
        </>}
        {stage.s === 'installing' && <h3 id="update-title" style={{ margin: 0 }}>Opening the installer…</h3>}
        {stage.s === 'ready' && <>
          <h3 id="update-title" style={{ marginTop: 0 }}>Ready to install version {rel.version}</h3>
          <p class="small" style={{ marginTop: 0 }}>Android's installer should be open: tap <b>Update</b> (or <b>Install</b>). Electro-Coach closes, updates and keeps your data. If you closed the installer, open it again here.</p>
          <div class="row" style={{ gap: '8px' }}>
            <button ref={btn} class="btn primary" onClick={() => install(stage.path)}>Install</button>
            <button class="btn" onClick={close}>Close</button>
          </div>
        </>}
        {stage.s === 'permission' && <>
          <h3 id="update-title" style={{ marginTop: 0 }}>One-time step: allow updates</h3>
          <p class="small" style={{ marginTop: 0 }}>Android opened a setting for Electro-Coach. Turn on <b>Allow from this source</b>, come back, and tap <b>Install</b>. You only need to do this once.</p>
          <div class="row" style={{ gap: '8px' }}>
            <button ref={btn} class="btn primary" onClick={() => install(stage.path)}>Install</button>
            <button class="btn" onClick={close}>Close</button>
          </div>
        </>}
        {stage.s === 'error' && <>
          <h3 id="update-title" style={{ marginTop: 0 }}>The update didn't download</h3>
          <p class="small" style={{ marginTop: 0 }}>{stage.msg}. Check your connection and try again, or download it in your browser and open the file when it finishes.</p>
          <div class="row" style={{ gap: '8px' }}>
            <button ref={btn} class="btn primary" onClick={start}>Try again</button>
            <button class="btn" onClick={() => browserDownload(rel)}>Download in the browser</button>
            <button class="btn" onClick={close}>Close</button>
          </div>
        </>}
      </div>
    </div>
  );
}

type Check = { state: 'idle' } | { state: 'checking' } | { state: 'current'; rel: ReleaseInfo | null } | { state: 'newer'; rel: ReleaseInfo } | { state: 'error'; msg: string };

export function AboutScreen({ onGo }: { onGo: (t: Tab) => void }) {
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const last = updateMemory().lastCheck;
  async function run() {
    setCheck({ state: 'checking' });
    try {
      const rel = await fetchLatest();
      setCheck(rel && isNewer(rel.version, APP_VERSION) ? { state: 'newer', rel } : { state: 'current', rel });
    } catch (e) { setCheck({ state: 'error', msg: e instanceof Error ? e.message : String(e) }); }
  }
  const native = canCheckForUpdates();

  return (
    <section>
      <h2>About</h2>
      <div class="card">
        <h3 style={{ margin: '0 0 2px' }}>Electro-Coach</h3>
        <p class="small muted" style={{ margin: 0 }}>{versionText()}</p>
        <p class="small" style={{ margin: '8px 0 0' }}>A pool practice coach: timed sessions, drills and tallies, your pre-shot routine, a shot clock,
          straight pool scoring, a journal, and analysis of Railbird shot exports.</p>
      </div>

      <div class="card about-why">
        <h3 style={{ marginTop: 0 }}>Why I built it</h3>
        <p class="small">I love pool, and I built Electro-Coach to help me get better. I wanted to explore my Railbird data in depth and to build a structured practice plan that keeps me honest, with no shortcuts. And the more I use the app, the more it builds on the valuable data I already get from Railbird.</p>
        <p class="small">I added other things I like to have on hand, too: my pre-shot routine and a journal for practice sessions and competition days.</p>
        <p class="small">This is a labor of love and still a work in progress. I hope it helps you too.</p>
        <p class="small" style={{ marginBottom: 0 }}>— Lela</p>
      </div>

      <div class="card">
        <h3>Updates</h3>
        {native ? <>
          <p class="small muted" style={{ marginTop: 0 }}>The app looks for a new release on GitHub when it opens (at most twice a day) and asks before downloading anything.
            {last ? ` Last checked ${fmtDate(new Date(last).toISOString())}.` : ''}</p>
          <div class="row" style={{ gap: '8px' }}>
            <button class="btn" disabled={check.state === 'checking'} onClick={run}>{check.state === 'checking' ? 'Checking…' : 'Check for updates'}</button>
            <button class="btn" onClick={() => openExternal(`${REPO_URL}/releases`)}>All releases</button>
          </div>
          {check.state === 'current' && <p class="small" style={{ margin: '8px 0 0' }}>You have the latest version{check.rel ? ` (${check.rel.version})` : ''}.</p>}
          {check.state === 'error' && <p class="small warn-text" style={{ margin: '8px 0 0' }}>Couldn't reach GitHub ({check.msg}). Try again when you're online.</p>}
          {check.state === 'newer' && <div class="notice update-notice" style={{ marginTop: '10px' }}>
            <p style={{ margin: '0 0 6px' }}><b>Version {check.rel.version} is available.</b> It installs over this version and keeps your data.</p>
            {check.rel.notes && <details class="small" style={{ margin: '0 0 8px' }}><summary>What's new</summary><div class="release-notes">{check.rel.notes}</div></details>}
            <button class="btn primary btn-s" onClick={() => showUpdatePrompt(check.rel)}>Update to {check.rel.version}</button>
          </div>}
        </> : platformName() === 'web-file'
          ? <p class="small muted" style={{ margin: 0 }}>This single-file copy doesn't update itself. The Android app and the web version do.</p>
          : <p class="small muted" style={{ margin: 0 }}>The web version updates itself: the newest version loads the next time you open it while online.</p>}
      </div>

      <div class="card">
        <h3>Feedback</h3>
        <p class="small" style={{ marginTop: 0 }}>Feedback is wanted and makes a real difference: problems, ideas and drills you’d like to see.
          To request a drill, find it on poolbilliards.co and paste the link.</p>
        <button class="btn primary" onClick={() => onGo('feedback')}>Feedback and drill requests</button>
      </div>

      <div class="card">
        <h3>Privacy</h3>
        <p class="small" style={{ marginTop: 0 }}>Everything you enter stays on this device; there's no account. Backups are files you keep.</p>
        <p class="small" style={{ margin: '0 0 8px' }}>
          {usageConfigured() ? <>Anonymous usage counts are <b>{usageOn() ? 'on' : 'off'}</b>. They show which screens and features get used, never what you enter. </> : null}
          {native ? 'The update check asks GitHub for the latest release and sends nothing about you. ' : ''}
          If you link your FargoRate, the app asks FargoRate for your rating at most once a day (only your FargoRate ID is sent); you can turn that off on the FargoRate page.
        </p>
        {usageConfigured() && <button class="btn btn-s" onClick={() => onGo('settings')}>Usage counts in Settings</button>}
      </div>

      <RailbirdRole />

      <div class="card">
        <h3>Independent app</h3>
        <p class="small" style={{ margin: 0 }}>Electro-Coach isn't affiliated with, sponsored by or endorsed by Railbird, FargoRate or any of the
          sites listed in Resources. It reads Railbird's CSV exports and FargoRate's public search.</p>
      </div>

      <p class="small muted" style={{ textAlign: 'center', margin: '14px 0 4px' }}>Copyright © 2026 Lela Andrews. All rights reserved.</p>
      <p class="small" style={{ textAlign: 'center', margin: 0 }}><button class="link-btn" onClick={() => openExternal(REPO_URL)}>Electro-Coach on GitHub</button></p>
    </section>
  );
}
