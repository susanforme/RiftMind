import type { LiveSeat } from '../../generated/contracts';

export function isPartyPhase(phase: string | undefined) {
  return phase === 'Lobby' || phase === 'Matchmaking' || phase === 'ReadyCheck';
}

const positionOrder: Record<string, number> = {
  TOP: 0,
  JUNGLE: 1,
  MIDDLE: 2,
  MID: 2,
  BOTTOM: 3,
  BOT: 3,
  UTILITY: 4,
  SUPPORT: 4,
  FILL: 5,
};

export function sortLiveSeats(seats: LiveSeat[]) {
  return [...seats].sort(
    (left, right) =>
      (positionOrder[left.position?.toUpperCase() || ''] ?? 5) -
        (positionOrder[right.position?.toUpperCase() || ''] ?? 5) || left.seat - right.seat,
  );
}
