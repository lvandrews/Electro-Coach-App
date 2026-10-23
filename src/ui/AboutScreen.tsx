import { useEffect, useState } from 'preact/hooks';
import { openExternal } from '../platform';
import { isNewer, shouldPrompt, type ReleaseInfo } from '../engine/update';
import { canCheckForUpdates, fetchLatest, launchCheck, skipVersion, snooze, updateMemory } from '../update';
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


function startDownload(r: ReleaseInfo) { openExternal(r.apkUrl ?? r.pageUrl); }

/** The prompt shown at launch when GitHub has a newer Android release. */
export function UpdateBanner() {
  const [rel, setRel] = useState<ReleaseInfo | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!canCheckForUpdates()) return;
    const t = setTimeout(async () => {
      const r = await launchCheck();
      if (shouldPrompt(r, APP_VERSION, updateMemory(), Date.now())) { setRel(r); setShown(true); }
    }, 2500);
    return () => clearTimeout(t);
  }, []);
  if (!shown || !rel) return null;
  return (
    <div class="notice update-notice" role="region" aria-label="Update available">
      <p style={{ margin: '0 0 6px' }}><b>Update available: version {rel.version}.</b> You have {APP_VERSION}.
        Download it, then open the file to install. It installs over this version and keeps your data.</p>
      {rel.notes && <details class="small" style={{ margin: '0 0 8px' }}><summary>What's new</summary><div class="release-notes">{rel.notes}</div></details>}
      <div class="row" style={{ gap: '8px' }}>
        <button class="btn primary btn-s" onClick={() => { startDownload(rel); setShown(false); }}>Download</button>
        <button class="btn btn-s" onClick={() => { snooze(); setShown(false); }}>Not now</button>
        <button class="btn btn-s" onClick={() => { skipVersion(rel.version); setShown(false); }}>Skip this version</button>
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
            <p style={{ margin: '0 0 6px' }}><b>Version {check.rel.version} is available.</b> Download it, then open the file to install; your data is kept.</p>
            {check.rel.notes && <details class="small" style={{ margin: '0 0 8px' }}><summary>What's new</summary><div class="release-notes">{check.rel.notes}</div></details>}
            <button class="btn primary btn-s" onClick={() => startDownload(check.rel)}>Download {check.rel.version}</button>
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
