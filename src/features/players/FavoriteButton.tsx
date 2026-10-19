import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';
import { transport } from '../../app/runtime';
import { queryClient } from '../../app/query-client';
import { Button } from '../../components/ui/button';
import { ErrorNotice } from '../../components/ErrorNotice';
export function FavoriteButton({ playerKey }: { playerKey: string }) {
  const { t } = useTranslation();
  const app = useQuery({ queryKey: ['app'], queryFn: () => transport.call('get_app_state', {}) });
  const favorites = useQuery({
    queryKey: ['favorites', app.data?.workspaceEpoch],
    queryFn: () => transport.call('list_favorites', {}),
    enabled: !!app.data,
  });
  const favorite = !!favorites.data?.some((p) => p.playerKey === playerKey);
  const save = useMutation({
    mutationFn: () =>
      transport.call('set_favorite', {
        workspaceEpoch: app.data!.workspaceEpoch,
        playerKey,
        favorite: !favorite,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['favorites'] }),
  });
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t(favorite ? 'scouting.unfavorite' : 'scouting.favorite')}
        aria-pressed={favorite}
        disabled={!app.data || save.isPending}
        onClick={() => save.mutate()}
      >
        <Star aria-hidden="true" size={16} fill={favorite ? 'currentColor' : 'none'} />
      </Button>
      <ErrorNotice error={save.error} />
    </>
  );
}
