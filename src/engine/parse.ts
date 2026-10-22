import Papa from 'papaparse';
import { BUILTIN_DRILLS, sessionLabel } from './drills';
import { FIELDS, SPEED_UNITS, normalizeHeader, type FieldSpec, type Shot, type SessionType, type TableSize } from './schema';

export interface CoercionIssue {
  column: string;
  count: number;
  examples: string[];   // up to 5 offending raw values
}

export interface ParseResult {
  fileName: string;
  rowsRead: number;
  shots: Shot[];
  raw: Record<number, Record<string, string>>;   // shotId -> untouched raw row
  rowsWithoutId: number;
  duplicateIdsInFile: number;
  missingColumns: string[];        // known fields absent from this export
  missingRequired: string[];       // required fields absent: import is refused
  unknownColumns: string[];        // headers we don't recognize (kept in raw)
  speedSource: string | null;      // human-readable description of the speed conversion
  issues: CoercionIssue[];
  incomplete: number;              // shots missing a required value
}

// ---------- value coercion ----------

const NULLISH = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', '-', '—', '–']);

/** Strip units, thousands separators and stray symbols, then parse. */
export function toNumber(v: string | undefined | null): number | null | 'bad' {
  if (v == null) return null;
  let s = String(v).trim();
  if (NULLISH.has(s.toLowerCase())) return null;
  s = s.replace(/,/g, '')
       .replace(/\s*(mph|ips|in\/s|inches|inch|in|"|″|deg|degrees|°|ft|%)\s*$/i, '')
       .trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : 'bad';
}

export function toBool(v: string | undefined | null): boolean | null | 'bad' {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (NULLISH.has(s)) return null;
  if (['true', 't', 'yes', 'y', '1', 'make', 'made'].includes(s)) return true;
  if (['false', 'f', 'no', 'n', '0', 'miss', 'missed'].includes(s)) return false;
  return 'bad';
}

/** Railbird timestamps: some carry +00:00, some are naive. Naive ones are UTC. */
export function toIsoDate(v: string | undefined | null): string | null | 'bad' {
  if (v == null) return null;
  let s = String(v).trim();
  if (NULLISH.has(s.toLowerCase())) return null;
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s) && !/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += 'Z';
  // JS Date handles at most millisecond precision; trim microseconds.
  s = s.replace(/(\.\d{3})\d+/, '$1').replace(' ', 'T');
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : 'bad';
}

export function toList(v: string | undefined | null): string[] {
  if (v == null) return [];
  return String(v).split(/[;|]/).map(x => x.trim()).filter(x => x && !NULLISH.has(x.toLowerCase()));
}

// ---------- derived fields ----------

export function tableSizeFromLength(len: number | null): TableSize | null {
  if (len == null) return null;
  if (len < 85) return '7ft';     // 78" surface
  if (len < 95) return '8ft';     // 88" surface
  return '9ft';                   // 100" surface
}

/** Session type from the built-in drill library (custom drills are applied later by the app). */
export function sessionTypeOf(tags: string[], gameTypes: string[], sessionName: string): SessionType {
  return sessionLabel(BUILTIN_DRILLS, tags, gameTypes, sessionName);
}

// ---------- main entry ----------

export function parseExport(csvText: string, fileName = 'export.csv'): ParseResult {
  const parsed = Papa.parse<string[]>(csvText.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
  const rows = parsed.data;
  const header = (rows[0] ?? []).map(normalizeHeader);
  const body = rows.slice(1);

  // Map each known field to a column index (canonical name first, then aliases).
  const colOf = new Map<string, number>();
  const usedCols = new Set<number>();
  let speedHeader: string | null = null;
  for (const f of FIELDS) {
    for (const name of [f.key, ...f.aliases]) {
      const i = header.indexOf(name);
      if (i >= 0) {
        colOf.set(f.key, i); usedCols.add(i);
        if (f.key === 'cue_ball_speed_inches_per_second') speedHeader = name;
        break;
      }
    }
  }
  const missingColumns = FIELDS.filter(f => !colOf.has(f.key)).map(f => f.key);
  const missingRequired = FIELDS.filter(f => f.required && !colOf.has(f.key)).map(f => f.key);
  const unknownColumns = header.filter((h, i) => h && !usedCols.has(i));

  const result: ParseResult = {
    fileName, rowsRead: body.length, shots: [], raw: {}, rowsWithoutId: 0, duplicateIdsInFile: 0,
    missingColumns, missingRequired, unknownColumns,
    speedSource: speedHeader ? `${speedHeader} (${SPEED_UNITS[speedHeader].label}) → mph` : null,
    issues: [], incomplete: 0,
  };
  if (missingRequired.length) return result;

  const issueMap = new Map<string, CoercionIssue>();
  const note = (col: string, val: string) => {
    let it = issueMap.get(col);
    if (!it) { it = { column: col, count: 0, examples: [] }; issueMap.set(col, it); }
    it.count++;
    if (it.examples.length < 5 && !it.examples.includes(val)) it.examples.push(val);
  };
  const seen = new Set<number>();
  const toMph = speedHeader ? SPEED_UNITS[speedHeader].toMph : null;

  for (const row of body) {
    const get = (key: string): string | undefined => {
      const i = colOf.get(key);
      return i == null ? undefined : row[i];
    };
    const val = (f: FieldSpec): unknown => {
      const s = get(f.key);
      let out: unknown;
      switch (f.kind) {
        case 'int': case 'num': {
          const n = toNumber(s);
          if (n === 'bad') { note(f.key, String(s)); return null; }
          if (f.kind === 'int' && n != null && !Number.isInteger(n)) { note(f.key, String(s)); return Math.round(n); }
          return n;
        }
        case 'bool': { const b = toBool(s); if (b === 'bad') { note(f.key, String(s)); return null; } return b; }
        case 'date': { const d = toIsoDate(s); if (d === 'bad') { note(f.key, String(s)); return null; } return d; }
        case 'list': return toList(s);
        case 'enum': {
          if (s == null || NULLISH.has(s.trim().toLowerCase())) return null;
          out = s.trim().toUpperCase();
          if (f.enumValues && !f.enumValues.includes(out as string)) { note(f.key, s); return null; }
          return out;
        }
        default: return s == null ? null : s.trim() || null;
      }
    };
    const v: Record<string, any> = {};
    for (const f of FIELDS) v[f.key] = val(f);

    const shotId = v.shot_id as number | null;
    if (shotId == null) { result.rowsWithoutId++; continue; }
    if (seen.has(shotId)) { result.duplicateIdsInFile++; continue; }
    seen.add(shotId);

    const tags = v.tags as string[];
    const gameTypes = v.game_type as string[];
    const sessionName = (v.session_name as string | null) ?? '';
    const tableLengthIn = v.table_playing_surface_length_inches as number | null;
    const speed = v.cue_ball_speed_inches_per_second as number | null;
    const mph = speed != null && toMph != null ? speed * toMph : null;

    const shot: Shot = {
      shotId,
      sessionId: v.session_id ?? -1,
      sessionName,
      sessionStart: v.session_start_time ?? v.session_created_at ?? v.shot_created_at ?? '',
      shotCreated: v.shot_created_at ?? v.session_start_time ?? '',
      tableLengthIn,
      tableSize: tableSizeFromLength(tableLengthIn),
      pocketSizeIn: v.pocket_size_in,
      tags, gameTypes,
      startFrame: v.start_frame, endFrame: v.end_frame,
      make: v.make,
      cutDeg: v.cue_object_angle_degrees,
      cueObjIn: v.cue_object_distance_inches,
      // Store speed in inches/second regardless of source unit, so all shots share one unit.
      speedIps: mph != null ? mph * 17.6 : null,
      mph,
      objPktIn: v.target_pocket_distance_inches,
      approachDeg: v.target_pocket_angle_degrees,
      pocketType: v.intended_pocket_type,
      difficulty: v.difficulty,
      marginDeg: v.margin_of_error_degrees,
      backcut: v.backcut,
      direction: v.shot_direction,
      spin: v.spin_type,
      fpScore: v.false_positive_score,
      annotationType: v.annotation_type,
      url: v.shot_url,
      sessionType: sessionTypeOf(tags, gameTypes, sessionName),
    };
    if (shot.make == null || shot.cutDeg == null || shot.cueObjIn == null || shot.objPktIn == null) result.incomplete++;
    result.shots.push(shot);
    const rawRow: Record<string, string> = {};
    header.forEach((h, i) => { if (h) rawRow[h] = row[i] ?? ''; });
    result.raw[shotId] = rawRow;
  }
  result.issues = [...issueMap.values()].sort((a, b) => b.count - a.count);
  return result;
}
