import type { Shot, SessionType, TableSize } from './schema';
import type { Exclusions, RuleId } from './rules';

export interface SessionSummary {
  sessionId: number;
  name: string;
  start: string;             // ISO UTC
  sessionType: SessionType;
  tags: string[];
  tableSize: TableSize | null;
  pocketSizeIn: number | null;
  shots: number;             // stored
  valid: number;
  makes: number;             // among valid
  makeRate: number | null;
  excludedBy: Partial<Record<RuleId, number>>;
}

export function summarizeSessions(shots: Iterable<Shot>, ex: Exclusions): SessionSummary[] {
  const map = new Map<number, SessionSummary>();
  for (const s of shots) {
    let r = map.get(s.sessionId);
    if (!r) {
      r = { sessionId: s.sessionId, name: s.sessionName, start: s.sessionStart, sessionType: s.sessionType, tags: s.tags,
            tableSize: s.tableSize, pocketSizeIn: s.pocketSizeIn, shots: 0, valid: 0, makes: 0, makeRate: null, excludedBy: {} };
      map.set(s.sessionId, r);
    }
    r.shots++;
    const rs = ex.get(s.shotId);
    if (!rs) { r.valid++; if (s.make) r.makes++; }
    else for (const id of rs) r.excludedBy[id] = (r.excludedBy[id] ?? 0) + 1;
  }
  const out = [...map.values()];
  for (const r of out) r.makeRate = r.valid ? r.makes / r.valid : null;
  return out.sort((a, b) => (a.start < b.start ? 1 : -1));
}
