import type { Game } from '../engine/games';
import { ShotClock } from './ShotClock';
import { StraightPoolScreen } from './StraightPoolScreen';

export type PlayMode = 'clock' | 'straight';
const MODES: { id: PlayMode; label: string }[] = [
  { id: 'clock', label: 'Shot clock' }, { id: 'straight', label: 'Straight pool' },
];

type Props = { mode: PlayMode; onMode: (m: PlayMode) => void; games: Game[]; device: string; onSaveGame: (g: Game) => Promise<void>; onDeleteGame: (id: string) => Promise<void> };

export function PlayScreen({ mode, onMode, games, device, onSaveGame, onDeleteGame }: Props) {
  return (
    <section>
      <h2>Play</h2>
      <div class="seg wrap" role="group" aria-label="Tool" style={{ margin: '6px 0 14px' }}>
        {MODES.map(m => <button key={m.id} aria-pressed={mode === m.id} onClick={() => onMode(m.id)}>{m.label}</button>)}
      </div>
      {mode === 'clock' && <ShotClock />}
      {mode === 'straight' && <StraightPoolScreen games={games} device={device} onSave={onSaveGame} onDelete={onDeleteGame} />}
    </section>
  );
}
