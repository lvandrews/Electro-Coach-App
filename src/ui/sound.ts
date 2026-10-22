// Shot-clock sounds, synthesized with Web Audio so they are clean and consistent:
// rounded sine tones with a little second harmonic, short attacks and soft decays
// (in the spirit of tournament shot clocks: clearly audible, never harsh).

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.7;

/** Must run inside a user gesture the first time (browsers start audio suspended). */
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* no audio available */ }
}

export function setVolume(v: number) { volume = Math.max(0, Math.min(1, v)); if (master) master.gain.value = volume; }

function tone(freq: number, start: number, dur: number, peak = 0.5) {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + start;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
  g.gain.setValueAtTime(peak, t0 + Math.max(0.01, dur * 0.55));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  g.connect(master);
  for (const [mult, amp] of [[1, 1], [2, 0.18], [3, 0.05]] as const) {
    const o = ctx.createOscillator(), a = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq * mult; a.gain.value = amp;
    o.connect(a); a.connect(g); o.start(t0); o.stop(t0 + dur + 0.02);
  }
}

export const sounds = {
  /** Ten seconds left: a soft rising two-note chime. */
  warn: () => { unlockAudio(); tone(784, 0, 0.16, 0.42); tone(1047, 0.17, 0.22, 0.42); },
  /** Each of the last five seconds. */
  tick: () => { unlockAudio(); tone(1047, 0, 0.12, 0.5); },
  /** Time: a longer two-tone signal. */
  expire: () => { unlockAudio(); tone(880, 0, 0.32, 0.55); tone(659, 0.34, 0.6, 0.55); },
  /** Extension granted. */
  extend: () => { unlockAudio(); tone(659, 0, 0.12, 0.4); tone(880, 0.12, 0.12, 0.4); tone(1175, 0.24, 0.2, 0.4); },
  /** Clock started for a new shot: a very short, quiet blip. */
  start: () => { unlockAudio(); tone(1319, 0, 0.05, 0.18); },
};
