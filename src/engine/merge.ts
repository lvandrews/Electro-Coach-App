import type { Shot } from './schema';
import type { ParseResult, CoercionIssue } from './parse';
import { evaluate, tally, tableDiagonalIn, type RuleConfig, type RuleTally, type Exclusions } from './rules';

export interface ImportReport {
  id: string;                    // timestamp-based
  importedAt: string;
  fileName: string;
  rowsRead: number;
  rowsWithoutId: number;
  duplicateIdsInFile: number;
  refused: boolean;              // required columns missing — nothing imported
  missingRequired: string[];
  missingColumns: string[];
  unknownColumns: string[];
  speedSource: string | null;
  issues: CoercionIssue[];
  newShots: number;
  updatedShots: number;          // same shot ID, some value changed (newer export wins)
  unchangedShots: number;
  newSessions: number[];
  newShotIds: number[];
  dateRange: [string, string] | null;   // of shots in this file
  totalAfter: number;
  validAfter: number;
  validBefore: number;
  rulesAll: RuleTally[];         // across the whole record after import
  rulesNew: RuleTally[];         // among the shots this file added
  missingSpeed: number;          // new shots with no speed (break rule can't apply)
  missingPocketSize: number;     // new shots without pocket size
  geometryWarnings: number;      // new valid shots with a distance beyond the table diagonal
  makeRateNewValid: number | null;
}

const COMPARE: (keyof Shot)[] = ['make', 'cutDeg', 'cueObjIn', 'speedIps', 'objPktIn', 'approachDeg', 'pocketSizeIn',
  'tableLengthIn', 'difficulty', 'direction', 'spin', 'backcut', 'fpScore', 'sessionName', 'startFrame'];

function sameShot(a: Shot, b: Shot): boolean {
  if (COMPARE.some(k => a[k] !== b[k])) return false;
  return a.tags.join('|') === b.tags.join('|') && a.gameTypes.join('|') === b.gameTypes.join('|');
}

/**
 * Merge a parsed export into the stored record. Idempotent: re-importing the same
 * or an overlapping export adds nothing new. For a shot ID seen before, the newer
 * file's values replace the old ones (Railbird occasionally corrects shots).
 */
export function mergeImport(
  existing: Map<number, Shot>, parsed: ParseResult, cfg: RuleConfig, now = new Date(),
): { shots: Map<number, Shot>; exclusions: Exclusions; report: ImportReport } {
  const before = existing.size ? evaluate([...existing.values()], cfg) : new Map();
  const validBefore = existing.size - before.size;

  const base: ImportReport = {
    id: now.toISOString(), importedAt: now.toISOString(), fileName: parsed.fileName,
    rowsRead: parsed.rowsRead, rowsWithoutId: parsed.rowsWithoutId, duplicateIdsInFile: parsed.duplicateIdsInFile,
    refused: parsed.missingRequired.length > 0, missingRequired: parsed.missingRequired,
    missingColumns: parsed.missingColumns, unknownColumns: parsed.unknownColumns,
    speedSource: parsed.speedSource, issues: parsed.issues,
    newShots: 0, updatedShots: 0, unchangedShots: 0, newSessions: [], newShotIds: [], dateRange: null,
    totalAfter: existing.size, validAfter: validBefore, validBefore,
    rulesAll: tally(before), rulesNew: tally(new Map()),
    missingSpeed: 0, missingPocketSize: 0, geometryWarnings: 0, makeRateNewValid: null,
  };
  if (base.refused) return { shots: existing, exclusions: before, report: base };

  const shots = new Map(existing);
  const knownSessions = new Set([...existing.values()].map(s => s.sessionId));
  const newSessions = new Set<number>();
  let lo = '', hi = '';
  for (const s of parsed.shots) {
    if (s.sessionStart) { if (!lo || s.sessionStart < lo) lo = s.sessionStart; if (!hi || s.sessionStart > hi) hi = s.sessionStart; }
    const old = shots.get(s.shotId);
    if (!old) {
      base.newShots++; base.newShotIds.push(s.shotId);
      if (!knownSessions.has(s.sessionId)) newSessions.add(s.sessionId);
      if (s.mph == null) base.missingSpeed++;
      if (s.pocketSizeIn == null) base.missingPocketSize++;
    } else if (sameShot(old, s)) { base.unchangedShots++; continue; }
    else base.updatedShots++;
    shots.set(s.shotId, s);
  }
  base.newSessions = [...newSessions].sort((a, b) => a - b);
  base.dateRange = lo ? [lo, hi] : null;

  const exclusions = evaluate([...shots.values()], cfg);
  const newSet = new Set(base.newShotIds);
  base.totalAfter = shots.size;
  base.validAfter = shots.size - exclusions.size;
  base.rulesAll = tally(exclusions);
  base.rulesNew = tally(exclusions, newSet);

  let n = 0, m = 0;
  for (const id of base.newShotIds) {
    if (exclusions.has(id)) continue;
    const s = shots.get(id)!;
    n++; if (s.make) m++;
    const d = tableDiagonalIn(s);
    if (d != null && ((s.cueObjIn ?? 0) > d || (s.objPktIn ?? 0) > d)) base.geometryWarnings++;
  }
  base.makeRateNewValid = n ? m / n : null;
  return { shots, exclusions, report: base };
}
