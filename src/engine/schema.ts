// Canonical shot record and the mapping from Railbird export columns onto it.
// The engine is pure TypeScript with no DOM or storage dependencies, so it can be
// unit-tested in Node and ported (e.g. to Kotlin) without touching the UI.

export type Direction = 'LEFT' | 'RIGHT';
export type PocketType = 'CORNER' | 'SIDE';
export type Spin = 'FOLLOW' | 'CENTER' | 'DRAW' | 'UNKNOWN';
export type TableSize = '7ft' | '8ft' | '9ft';
/** Drill name (from the drill library), 'Other drill' or 'Free play'. */
export type SessionType = string;

/** One shot after parsing, coercion and derivation. Nulls mean "not in this export". */
export interface Shot {
  shotId: number;
  sessionId: number;
  sessionName: string;
  sessionStart: string;      // ISO, UTC
  shotCreated: string;       // ISO, UTC
  tableLengthIn: number | null;
  tableSize: TableSize | null;
  pocketSizeIn: number | null;
  tags: string[];
  gameTypes: string[];
  startFrame: number | null;
  endFrame: number | null;
  make: boolean | null;
  cutDeg: number | null;          // cue_object_angle_degrees
  cueObjIn: number | null;        // cue_object_distance_inches
  speedIps: number | null;        // as exported, inches per second
  mph: number | null;             // derived
  objPktIn: number | null;        // target_pocket_distance_inches
  approachDeg: number | null;     // target_pocket_angle_degrees
  pocketType: PocketType | null;
  difficulty: number | null;
  marginDeg: number | null;
  backcut: boolean | null;
  direction: Direction | null;
  spin: Spin | null;
  fpScore: number | null;
  annotationType: string | null;
  url: string | null;
  sessionType: SessionType;
}

export type FieldKind = 'int' | 'num' | 'bool' | 'text' | 'date' | 'list' | 'enum';

export interface FieldSpec {
  key: string;                 // canonical export header
  aliases: string[];           // other headers accepted for the same field
  kind: FieldKind;
  required?: boolean;          // shot cannot be analyzed without it
  enumValues?: string[];
}

/**
 * Railbird export columns as of the 2026-10-18 export. Aliases cover plausible
 * renames; anything unknown is reported, never silently dropped.
 */
export const FIELDS: FieldSpec[] = [
  { key: 'session_id', aliases: [], kind: 'int', required: true },
  { key: 'session_name', aliases: [], kind: 'text' },
  { key: 'session_start_time', aliases: ['session_start'], kind: 'date' },
  { key: 'session_created_at', aliases: [], kind: 'date' },
  { key: 'table_playing_surface_length_inches', aliases: ['table_length_inches'], kind: 'num' },
  { key: 'pocket_size_in', aliases: ['pocket_size_inches', 'pocket_size'], kind: 'num' },
  { key: 'tags', aliases: [], kind: 'list' },
  { key: 'player_id', aliases: [], kind: 'int' },
  { key: 'player_username', aliases: [], kind: 'text' },
  { key: 'shot_id', aliases: ['id'], kind: 'int', required: true },
  { key: 'start_frame', aliases: [], kind: 'int' },
  { key: 'end_frame', aliases: [], kind: 'int' },
  { key: 'shot_created_at', aliases: [], kind: 'date' },
  { key: 'make', aliases: ['made', 'is_make'], kind: 'bool', required: true },
  { key: 'cue_object_angle_degrees', aliases: ['cut_angle_degrees', 'cut_angle'], kind: 'num', required: true },
  { key: 'cue_object_distance_inches', aliases: [], kind: 'num', required: true },
  { key: 'cue_ball_speed_inches_per_second', aliases: ['cue_ball_speed_mph', 'cue_ball_speed_meters_per_second', 'cue_ball_speed_feet_per_second', 'cue_ball_speed'], kind: 'num' },
  { key: 'target_pocket_distance_inches', aliases: [], kind: 'num', required: true },
  { key: 'target_pocket_angle_degrees', aliases: [], kind: 'num' },
  { key: 'intended_pocket_type', aliases: ['pocket_type'], kind: 'enum', enumValues: ['CORNER', 'SIDE'] },
  { key: 'difficulty', aliases: [], kind: 'num' },
  { key: 'margin_of_error_degrees', aliases: [], kind: 'num' },
  { key: 'backcut', aliases: [], kind: 'bool' },
  { key: 'shot_direction', aliases: ['direction'], kind: 'enum', enumValues: ['LEFT', 'RIGHT'] },
  { key: 'spin_type', aliases: ['spin'], kind: 'enum', enumValues: ['FOLLOW', 'CENTER', 'DRAW', 'UNKNOWN'] },
  { key: 'false_positive_score', aliases: [], kind: 'num' },
  { key: 'annotation_type', aliases: [], kind: 'text' },
  { key: 'annotation_notes', aliases: [], kind: 'text' },
  { key: 'shot_url', aliases: [], kind: 'text' },
  { key: 'game_type', aliases: [], kind: 'list' },
];

/** Speed headers and the factor that converts each to mph. */
export const SPEED_UNITS: Record<string, { label: string; toMph: number }> = {
  cue_ball_speed_inches_per_second: { label: 'inches/second', toMph: 1 / 17.6 },
  cue_ball_speed_feet_per_second: { label: 'feet/second', toMph: 3600 / 5280 },
  cue_ball_speed_meters_per_second: { label: 'meters/second', toMph: 2.2369362920544 },
  cue_ball_speed_mph: { label: 'mph', toMph: 1 },
  // Bare "cue_ball_speed" is ambiguous; treated as inches/second (Railbird's native unit)
  // and flagged in the import report.
  cue_ball_speed: { label: 'unlabeled (assumed inches/second)', toMph: 1 / 17.6 },
};

export function normalizeHeader(h: string): string {
  return h.replace(/^﻿/, '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}
