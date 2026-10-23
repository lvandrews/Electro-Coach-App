// Anonymous usage counts, sent to Aptabase (aptabase.com), a privacy-first analytics service.
//
// What is sent: which screens are opened (once per screen per launch), which features are
// used (import, timed session, drill tally, games, shot clock, routine edit and so on), the
// app version and platform, and the phone's language setting. Aptabase works out the country
// from the connection and does not store the address. There is no account, device ID, name or
// install ID, and nothing from your data: no shots, scores, notes, names, routine text,
// FargoRate ID or table details. Only the event names and property values listed below can
// be sent; anything else is dropped before sending.

export const FEATURES = [
  'app_started', 'first_open', 'screen',
  'csv_imported', 'session_started', 'session_finished',
  'tally_started', 'tally_finished', 'drill_created',
  'bowling_game_started', 'bowling_game_finished', 'bowling_games_added',
  'straight_pool_started', 'straight_pool_finished', 'scoresheet_pdf',
  'shot_clock_started', 'routine_edited', 'journal_note_added',
  'fargo_lookup', 'backup_made', 'shots_csv_saved', 'reminders_changed', 'feedback_sent',
] as const;
export type UsageEvent = typeof FEATURES[number];
export type UsageProps = Record<string, string | number | boolean>;

/** Property names allowed per event; values are short strings, numbers or true/false. */
const ALLOWED: Partial<Record<UsageEvent, readonly string[]>> = {
  app_started: ['platform'],
  feedback_sent: ['kind'],
  first_open: ['platform'],
  screen: ['screen'],
  csv_imported: ['shots'],
  session_started: ['minutes'],
  tally_started: ['drill'],
  tally_finished: ['drill'],
  reminders_changed: ['nudges', 'recap'],
};

/** Keep only the allowed properties, with strings cut to 40 characters. */
export function cleanProps(name: UsageEvent, props: UsageProps = {}): UsageProps | undefined {
  const keys = ALLOWED[name] ?? [];
  const out: UsageProps = {};
  for (const k of keys) {
    const v = props[k];
    if (typeof v === 'string') out[k] = v.slice(0, 40);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Shot counts are sent in broad bands, never exactly. */
export function shotBand(n: number): string {
  return n < 100 ? 'under 100' : n < 500 ? '100-499' : n < 2000 ? '500-1999' : '2000+';
}

/** Built-in drills are reported by their ID; drills you made yourself only as "custom". */
export function drillLabel(id: string, builtinIds: ReadonlySet<string>): string {
  return builtinIds.has(id) ? id : 'custom';
}

/** Aptabase's endpoint for an app key (A-EU-… or A-US-…); null for a missing or malformed key. */
export function endpointFor(appKey: string): string | null {
  const m = /^A-(EU|US)-\d+$/.exec(appKey.trim());
  return m ? `https://${m[1].toLowerCase()}.aptabase.com/api/v0/event` : null;
}

/**
 * Aptabase's session ID: seconds since 1970 plus 8 random digits, replaced after an hour
 * with no events. It groups one sitting's events and identifies nobody.
 */
export function nextSession(prev: { id: string; last: number } | null, now: number, rand = Math.random): { id: string; last: number } {
  if (prev && now - prev.last <= 3600_000) return { id: prev.id, last: now };
  const id = `${Math.floor(now / 1000)}${String(Math.floor(rand() * 1e8)).padStart(8, '0')}`;
  return { id, last: now };
}

export interface AptabaseEvent {
  timestamp: string;
  sessionId: string;
  eventName: string;
  systemProps: { locale: string; isDebug: boolean; appVersion: string; sdkVersion: string };
  props?: UsageProps;
}

export function buildEvent(name: UsageEvent, props: UsageProps | undefined, ctx: { sessionId: string; now: Date; locale: string; appVersion: string; isDebug: boolean }): AptabaseEvent {
  const ev: AptabaseEvent = {
    timestamp: ctx.now.toISOString(),
    sessionId: ctx.sessionId,
    eventName: name,
    systemProps: { locale: ctx.locale, isDebug: ctx.isDebug, appVersion: ctx.appVersion, sdkVersion: 'electro-coach@1' },
  };
  const p = cleanProps(name, props);
  if (p) ev.props = p;
  return ev;
}
