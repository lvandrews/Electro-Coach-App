import { useRef, useState } from 'preact/hooks';
import type { AppData, Tab } from '../app';
import { isNative } from '../platform';
import { localDate, type CaptureRow } from '../engine/tally';
import { CaptureLine } from './DrillsScreen';
import type { ImportReport } from '../engine/merge';
import { RULES } from '../engine/rules';
import { fmtDate, fmtTime, int, pct, plural } from './format';

interface Props {
  data: AppData;
  busy: string | null;
  lastReport: ImportReport | null;
  capture: CaptureRow[];
  onFiles: (f: File[]) => void;
  onGo: (t: Tab) => void;
}

export function ImportScreen({ data, busy, lastReport, capture, onFiles, onGo }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const empty = data.shots.size === 0;

  const pick = (list: FileList | null) => { if (list?.length) onFiles([...list]); };

  return (
    <section>
      <h2>Import</h2>
      <p class="lede">
        {empty
          ? 'Export your shot data from Railbird as CSV, then bring it in here. Start with your all-time export; after that, recent exports are enough. Shots you already have are recognized and skipped.'
          : 'Bring in a Railbird CSV export; shots you already have are skipped.'}
      </p>

      <div
        class={`drop ${over ? 'over' : ''}`}
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); pick(e.dataTransfer?.files ?? null); }}
      >
        <button class="btn primary" disabled={!!busy} onClick={() => input.current?.click()}>
          Choose Railbird export
        </button>
        <span class="small muted">{busy ?? 'CSV file. On a computer you can also drop it here.'}</span>
        <input ref={input} type="file" accept={isNative() ? undefined : '.csv,text/csv'} multiple hidden
          onChange={e => { pick((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ''; }} />
      </div>

      {lastReport && <div style={{ marginTop: '16px' }}><ReportView r={lastReport} fresh onGo={onGo} /></div>}
      {lastReport?.dateRange && (() => {
        const lo = localDate(lastReport.dateRange[0]), hi = localDate(lastReport.dateRange[1]);
        const rows = capture.filter(c => c.date >= lo && c.date <= hi);
        return rows.length > 0 && (
          <div class="card">
            <h3>Your tallies against this export</h3>
            {rows.map(c => (
              <div key={c.tallyId} class="tally-row">
                <b>{c.drillName}</b> <span class="small muted">{c.date}</span>
                <CaptureLine c={c} />
              </div>
            ))}
          </div>
        );
      })()}

      {data.imports.length > 0 && (
        <div class="card" style={{ marginTop: '16px' }}>
          <h3>Import history</h3>
          <div class="scroll-x">
            <table>
              <thead><tr><th>When</th><th>File</th><th class="n">New</th><th class="n">Updated</th><th class="n">Kept after</th></tr></thead>
              <tbody>
                {data.imports.map(i => (
                  <tr key={i.id}>
                    <td>{fmtDate(i.importedAt, { day: 'numeric', month: 'short' })} {fmtTime(i.importedAt)}</td>
                    <td style={{ wordBreak: 'break-all' }}>{i.fileName}{i.refused ? ' (refused)' : ''}</td>
                    <td class="n">{int(i.newShots)}</td>
                    <td class="n">{int(i.updatedShots)}</td>
                    <td class="n">{int(i.validAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details style={{ marginTop: '10px' }}>
            <summary class="small">Show the report for an earlier import</summary>
            {data.imports.map(i => <details key={i.id} style={{ margin: '8px 0 0 8px' }}><summary class="small">{i.fileName} — {fmtDate(i.importedAt)}</summary><ReportView r={i} onGo={onGo} /></details>)}
          </details>
        </div>
      )}
    </section>
  );
}

export function ReportView({ r, fresh, onGo }: { r: ImportReport; fresh?: boolean; onGo: (t: Tab) => void }) {
  if (r.refused) {
    return (
      <div class="card">
        <h3>{r.fileName} was not imported</h3>
        <div class="notice bad">
          The file is missing columns the analysis needs: <b>{r.missingRequired.join(', ')}</b>. Check that it is a Railbird shot export,
          not a session summary. Nothing was changed.
        </div>
      </div>
    );
  }
  const rulesNewFlag = r.rulesNew.filter(t => t.flagged > 0);
  const rulesAllFlag = r.rulesAll.filter(t => t.flagged > 0);
  const label = (id: string) => RULES.find(x => x.id === id)?.label ?? id;
  const keptDelta = r.validAfter - r.validBefore;

  return (
    <div class="card">
      <h3>{fresh ? 'Import complete' : 'Import report'}: {r.fileName}</h3>
      <p style={{ margin: '0 0 12px' }}>
        {r.newShots === 0 && r.updatedShots === 0
          ? `Nothing new: all ${int(r.unchangedShots)} shots in this file were already stored.`
          : <>
              {plural(r.newShots, 'new shot')}
              {r.newSessions.length > 0 && <> from {plural(r.newSessions.length, 'new session')}</>}
              {r.dateRange && <>, {fmtDate(r.dateRange[0])}{r.dateRange[0].slice(0, 10) !== r.dateRange[1].slice(0, 10) && <> to {fmtDate(r.dateRange[1])}</>}</>}.
              {' '}{int(keptDelta)} added to the analysis{r.makeRateNewValid != null && <>, made {pct(r.makeRateNewValid)}</>}.
              {r.updatedShots > 0 && <> {plural(r.updatedShots, 'stored shot')} updated with Railbird's newer values.</>}
            </>}
      </p>

      <dl class="facts">
        <div><dt>Rows in file</dt><dd>{int(r.rowsRead)}</dd></div>
        <div><dt>New</dt><dd>{int(r.newShots)}</dd></div>
        <div><dt>Already stored</dt><dd>{int(r.unchangedShots + r.updatedShots)}</dd></div>
        <div><dt>Kept, all shots</dt><dd>{int(r.validAfter)}</dd></div>
      </dl>

      {rulesNewFlag.length > 0 && (
        <>
          <div class="panel-title" style={{ marginTop: '16px' }}>Excluded from the new shots</div>
          <table>
            <tbody>
              {rulesNewFlag.map(t => (
                <tr key={t.id}><td>{label(t.id)}</td><td class="n">{int(t.flagged)}</td></tr>
              ))}
            </tbody>
          </table>
          <p class="small muted" style={{ margin: '6px 0 0' }}>Excluded shots stay stored. Change or switch off a rule in Settings and they return.</p>
        </>
      )}

      <div class="panel-title" style={{ marginTop: '16px' }}>Checks</div>
      <ul class="small" style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
        <li>Speed: {r.speedSource ?? <b>no speed column found — break shots can't be filtered by speed</b>}</li>
        {r.missingSpeed > 0 && <li>{plural(r.missingSpeed, 'new shot')} with no speed value.</li>}
        {r.missingPocketSize > 0 && <li>{plural(r.missingPocketSize, 'new shot')} with no pocket size (normal for exports before Dec 2025).</li>}
        {r.issues.length === 0 ? <li>Every value converted cleanly.</li> : r.issues.map(i => (
          <li key={i.column}><b>{i.column}</b>: {plural(i.count, 'value')} could not be read as the expected type, e.g. {i.examples.map(e => `"${e}"`).join(', ')}. Treated as blank.</li>
        ))}
        {r.rowsWithoutId > 0 && <li>{plural(r.rowsWithoutId, 'row')} had no shot ID and were skipped.</li>}
        {r.duplicateIdsInFile > 0 && <li>{plural(r.duplicateIdsInFile, 'row')} repeated a shot ID within the file; the first was used.</li>}
        {r.unknownColumns.length > 0 && <li>New columns Railbird added: {r.unknownColumns.join(', ')}. Stored with the raw data; not yet analyzed.</li>}
        {r.missingColumns.length > 0 && <li>Optional columns not in this file: {r.missingColumns.join(', ')}.</li>}
        {r.geometryWarnings > 0 && <li>{plural(r.geometryWarnings, 'kept shot')} with a distance longer than the table diagonal (see the optional geometry rule in Settings).</li>}
      </ul>

      {rulesAllFlag.length > 0 && (
        <details style={{ marginTop: '12px' }}>
          <summary class="small">Exclusions across all {int(r.totalAfter)} stored shots</summary>
          <table>
            <thead><tr><th>Rule</th><th class="n">Flagged</th><th class="n">Only reason</th></tr></thead>
            <tbody>
              {rulesAllFlag.map(t => <tr key={t.id}><td>{label(t.id)}</td><td class="n">{int(t.flagged)}</td><td class="n">{int(t.only)}</td></tr>)}
              <tr><td><b>Shots excluded</b></td><td class="n"><b>{int(r.totalAfter - r.validAfter)}</b></td><td /></tr>
            </tbody>
          </table>
          <p class="small muted">Some shots fail more than one rule, so flags add up to more than the shots excluded.</p>
        </details>
      )}

      {fresh && r.newShots > 0 && (
        <div class="row" style={{ marginTop: '14px' }}>
          <button class="btn" onClick={() => onGo('sessions')}>See sessions</button>
          <button class="btn" onClick={() => onGo('data')}>Explore the data</button>
        </div>
      )}
    </div>
  );
}
