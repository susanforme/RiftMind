import { useNavigate } from '@tanstack/react-router';
import { useWorkspace } from '../../stores/workspace-tabs';
import type { Player } from '../../generated/contracts';
export function useOpenPlayer() {
  const navigate = useNavigate();
  return (player: Pick<Player, 'playerKey'>) => {
    const id = `players:${player.playerKey}`;
    useWorkspace
      .getState()
      .open({ id, kind: 'players', playerKey: player.playerKey, search: '{}' });
    void navigate({ to: '/players', search: { player: player.playerKey, tab: id } });
  };
}
