import { useNavigate } from '@tanstack/react-router';
import { useWorkspace } from '../../stores/workspace-tabs';
import type { Player } from '../../generated/contracts';
export function useOpenPlayer() { const navigate = useNavigate(); return (p: Player) => { const id = `matches:${p.playerKey}`; useWorkspace.getState().open({ id, kind: 'matches', playerKey: p.playerKey, search: '{}' }); void navigate({ to: '/matches', search: { player: p.playerKey, tab: id } }); }; }
