import { useEffect, useState } from 'preact/hooks';
import { acceptNotice, noticeAnswered, onUsageChange, setUsageOn, usageConfigured, usageOn } from '../usage';

function useUsageState() {
  const [, bump] = useState(0);
  useEffect(() => onUsageChange(() => bump(v => v + 1)), []);
  return { configured: usageConfigured(), on: usageOn(), answered: noticeAnswered() };
}

/** One-time note on first launch saying what is counted, with a way to turn it off. */
export function UsageNotice() {
  const u = useUsageState();
  if (!u.configured || u.answered || !u.on) return null;
  return (
    <div class="notice usage-notice" role="region" aria-label="Anonymous usage counts">
      <p style={{ margin: '0 0 8px' }}>
        <b>Anonymous usage counts.</b> To decide what to improve, Electro-Coach counts which screens and features get used, and in which country.
        It never sends your shots, scores, notes, names or anything else you enter, and there's no account or device ID.
      </p>
      <div class="row" style={{ gap: '8px' }}>
        <button class="btn primary btn-s" onClick={acceptNotice}>OK</button>
        <button class="btn btn-s" onClick={() => setUsageOn(false)}>Turn off</button>
      </div>
    </div>
  );
}

/** Settings card: the switch, exactly what is and isn't sent, and the app version. */
export function UsageSettings() {
  const u = useUsageState();
  return (
    <div class="card">
      <h3>Anonymous usage counts</h3>
      {!u.configured
        ? <p class="small muted" style={{ marginTop: 0 }}>Not active in this copy of the app: nothing is sent.</p>
        : <>
          <label class="small switch-row"><input type="checkbox" checked={u.on} onChange={() => setUsageOn(!u.on)} />
            <span><b>Share anonymous usage counts</b> to help decide what to improve.</span></label>
          <details class="small" style={{ marginTop: '8px' }}>
            <summary>What is and isn't sent</summary>
            <p style={{ margin: '6px 0 4px' }}><b>Sent:</b> which screens are opened (once each per launch), which features are used (an import,
              a timed session, a drill tally, a game, the shot clock, a routine edit and similar), the app version, the kind of device
              (Android, iPhone, computer), the phone's language setting, and the country, which the counting service works out from the
              connection without storing the address.</p>
            <p style={{ margin: 0 }}><b>Never sent:</b> your shots, scores, notes, journal, routine text, drill names you made, player names,
              venues, FargoRate ID, or any account or device ID. The counts go to Aptabase (aptabase.com), a privacy-first analytics service.</p>
          </details>
        </>}
    </div>
  );
}
