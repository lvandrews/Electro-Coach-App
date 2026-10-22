import type { PlayMode } from './PlayScreen';

// Every place in the app, grouped for the side drawer, with words the drawer's
// search matches. The bottom bar shows four of them (the user's choice) plus More.

export type Tab =
  | 'home' | 'plan' | 'drills' | 'history' | 'session'
  | 'play' | 'progress' | 'model' | 'table' | 'data' | 'sessions'
  | 'journal' | 'routine' | 'resources' | 'fargo' | 'bowling' | 'import' | 'settings';

export type Group = 'Practice' | 'Play' | 'Analysis' | 'Reference' | 'Data and settings';

export interface Dest { id: string; label: string; short: string; group: Group | null; tab: Tab; play?: PlayMode; keywords: string }

export const DESTS: Dest[] = [
  { id: 'home', label: 'Home', short: 'Home', group: null, tab: 'home', keywords: 'dashboard today next last recent' },
  { id: 'plan', label: 'Practice plan and session timer', short: 'Plan', group: 'Practice', tab: 'plan', keywords: 'targets session timer workout makes lost coaching' },
  { id: 'drills', label: 'Drills', short: 'Drills', group: 'Practice', tab: 'drills', keywords: 'library tally tap diagram tag layout transitions spot x-drill mirror' },
  { id: 'history', label: 'Session history', short: 'History', group: 'Practice', tab: 'history', keywords: 'log past recent tallies games practice' },
  { id: 'clock', label: 'Shot clock', short: 'Clock', group: 'Play', tab: 'play', play: 'clock', keywords: 'timer extension match' },
  { id: 'straight', label: 'Straight pool', short: '14.1', group: 'Play', tab: 'play', play: 'straight', keywords: '14.1 continuous match bpi high run score' },
  { id: 'bowling', label: '10-ball bowling drill', short: 'Bowling', group: 'Practice', tab: 'bowling', keywords: 'bowliards strike spare score game drill run-out' },
  { id: 'fargo', label: 'FargoRate rating', short: 'Fargo', group: 'Play', tab: 'fargo', keywords: 'fargo fargorate rating robustness handicap' },
  { id: 'progress', label: 'Progress', short: 'Progress', group: 'Analysis', tab: 'progress', keywords: 'yardstick trend meters segments improvement regression' },
  { id: 'model', label: 'Strengths and shot model', short: 'Model', group: 'Analysis', tab: 'model', keywords: 'forest radar predictor logit expected strengths weaknesses' },
  { id: 'table', label: 'Table heat maps', short: 'Table', group: 'Analysis', tab: 'table', keywords: 'heat map position pocket chance' },
  { id: 'data', label: 'Distributions', short: 'Data', group: 'Analysis', tab: 'data', keywords: 'histogram cut speed distance shots' },
  { id: 'sessions', label: 'Railbird sessions', short: 'Sessions', group: 'Analysis', tab: 'sessions', keywords: 'railbird sessions list' },
  { id: 'routine', label: 'Pre-shot routine', short: 'Routine', group: 'Reference', tab: 'routine', keywords: 'routine stroke delivery cues fundamentals reference' },
  { id: 'journal', label: 'Journal', short: 'Journal', group: 'Reference', tab: 'journal', keywords: 'notes changes equipment technique tip coach chatbot ai share' },
  { id: 'resources', label: 'Resources', short: 'Links', group: 'Reference', tab: 'resources', keywords: 'links websites youtube channels videos instruction railbird salotto poolbilliards' },
  { id: 'import', label: 'Import Railbird data', short: 'Import', group: 'Data and settings', tab: 'import', keywords: 'csv export upload' },
  { id: 'settings', label: 'Settings and backup', short: 'Settings', group: 'Data and settings', tab: 'settings', keywords: 'appearance theme dark light color backup restore rules delete bottom bar reminders notifications nudge recap' },
];
export const GROUPS: Group[] = ['Practice', 'Play', 'Analysis', 'Reference', 'Data and settings'];

// ---------- the bottom bar ----------

export interface Slot { id: string; label: string; tabs: Tab[]; go: Tab }
const PRACTICE: Slot = { id: 'practice', label: 'Practice', tabs: ['plan', 'drills', 'history', 'session', 'bowling'], go: 'plan' };
const PLAY: Slot = { id: 'play', label: 'Play', tabs: ['play'], go: 'play' };

/** Everything the bottom bar can hold. */
export const SLOT_CHOICES: Slot[] = [
  { id: 'home', label: 'Home', tabs: ['home'], go: 'home' },
  PRACTICE, PLAY,
  ...DESTS.filter(d => !['home', 'clock', 'straight', 'bowling'].includes(d.id)).map(d => ({ id: d.id, label: d.short, tabs: [d.tab], go: d.tab })),
];
export const DEFAULT_BAR = ['home', 'practice', 'play', 'progress'];
export const slotById = (id: string) => SLOT_CHOICES.find(s => s.id === id) ?? null;
