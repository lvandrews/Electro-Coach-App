// Pre-shot routine reference: a quick card for between shots and longer notes.
// A first draft from Lela's coaching notes; every section can be edited in the app
// (edits are stored under settings key `routine` and override these defaults).

export interface QuickStep { title: string; cue: string }
export type RoutineLink = 'plan' | 'progress' | 'table' | 'predictor' | 'speed';
export type RoutineData = 'speed' | 'selection' | 'tables';
/** `data`: your own numbers shown under the section (computed live, not part of the editable text). */
export interface RoutineSection { id: string; title: string; points: string[]; links?: RoutineLink[]; data?: RoutineData }
export interface Routine { quick: QuickStep[]; sections: RoutineSection[] }

export const ROUTINE: Routine = {
  quick: [
    { title: 'Stand and read', cue: 'Pocket, speed, spin, where the cue ball goes. See it clearly now, standing.' },
    { title: 'Commit', cue: 'One plan. Feel the ball going down before you get down.' },
    { title: 'Set up', cue: 'Contact point and the tail of the line to orient; feel does the aiming.' },
    { title: 'Strokes', cue: 'Soft grip, still head. Compact but loose; arm close to the body.' },
    { title: 'Deliver', cue: 'Step on the tail. Through to the dark side of the moon. Stay down.' },
    { title: 'Reset', cue: 'A neutral look at the result, then the next shot from the top.' },
  ],
  sections: [
    {
      id: 'standing', title: 'Standing: reading the shot',
      points: [
        'Decide everything standing: the pocket, the speed, the spin and where the cue ball should finish.',
        '"See clearly" belongs here, before you commit, not once you are over the ball.',
        'Choose speed now. Under pressure, speed is the first thing to drift.',
        'If you are unsure, stay standing until you are sure.',
      ],
    },
    {
      id: 'commit', title: 'Commitment',
      points: [
        'Feel the ball going down before you get down on the shot.',
        'Once you are down, the decision is locked: no re-deciding mid-stroke.',
        'If the plan changes while you are down, stand up and start the routine again.',
      ],
    },
    {
      id: 'setup', title: 'Setting up',
      points: [
        'Your aiming is feel. The contact point and the tail of the object ball\'s line are anchors that orient you, not a second aiming system.',
        'Changing table size (7-ft to 9-ft on the same day) can throw the anchors off, most on moderate backcuts. Take a few calibration shots first.',
      ],
      links: ['table'], data: 'tables',
    },
    {
      id: 'stroke', title: 'Stroke and delivery',
      points: [
        'Soft grip, still head, compact but loose.',
        'Keep the arm close to the body. On video, the misses are the shots where the cue drifts or the arm comes away.',
        'The backswing arc is where unintended right english starts. Fix the backswing rather than compensating on the way through.',
        'Your follow-through is clean on almost every shot; trust it.',
        'Step on the tail at contact, go through to the dark side of the moon, and stay down until the ball drops. Head movement at completion is the recurring flaw to watch.',
        'Final stillness before the last stroke; one deliberate rehearsal stroke at the speed you will use.',
      ],
    },
    {
      id: 'speed', title: 'Speed',
      points: [
        'Easy pocket speed (about 4–7 mph): the default for most shots.',
        'Firm pocket speed (about 8–11 mph): when you need extra spin or more cue-ball travel.',
        'Hard speed (12 mph and up): power shots only; rarely needed.',
        'Break speed is around 23 mph.',
      ],
      links: ['speed'], data: 'speed',
    },
    {
      id: 'checks', title: 'Quick checks',
      points: [
        'Stop shot: if the cue ball keeps turning left after it stops, you hit right of center.',
        'Film a block in Railbird when something feels off; review the stroke, not just the result.',
      ],
    },
    {
      id: 'selection', title: 'Shot selection',
      points: [
        'Object-ball-to-pocket distance drives make chance most; cue-ball distance second; cut angle only costs much past about 60°.',
        'Most of your misses are long, fairly shallow shots, not steep cuts: give those the full routine.',
        'Side pockets by approach angle: up to 45° fine; 45–55° available but lower percentage; 55–65° makeable but tough; past 65° play elsewhere.',
        'Attack or safety: attack when your make chance is above P* = (value of the safety − value of a miss) ÷ (value of a make − value of a miss). The shot predictor gives your make chance.',
      ],
      links: ['predictor', 'plan'], data: 'selection',
    },
    {
      id: 'reset', title: 'After a miss',
      points: [
        'Sort the error before the next shot: technique, the decision, or the reaction to the moment.',
        'A neutral look, a breath, then the next routine from the top at its normal tempo; do not speed up.',
        'One early mistake is one shot; the next shot is a new one.',
      ],
      links: ['progress'],
    },
    {
      id: 'conditions', title: 'Table conditions',
      points: [
        'Fresh cloth plays faster and spin lasts longer: lags die after the far rail with topspin, and two-rail kicks need adjusting.',
        'One-rail banks are more consistent on fresh cloth.',
      ],
    },
  ],
};

export interface RoutineEdits { quick?: QuickStep[]; sections?: Record<string, { title: string; points: string[] }> }

export function applyRoutineEdits(base: Routine, e: RoutineEdits | null): Routine {
  if (!e) return base;
  return {
    quick: e.quick ?? base.quick,
    sections: base.sections.map(s => (e.sections?.[s.id] ? { ...s, ...e.sections[s.id] } : s)),
  };
}
