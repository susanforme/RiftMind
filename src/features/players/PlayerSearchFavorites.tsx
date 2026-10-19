import { playerName } from '../../lib/display-names';
import { serverName } from '../../lib/server-name';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useRef, useState } from 'react';
import { transport } from '../../app/runtime';
import { queryClient } from '../../app/query-client';
import type { Player } from '../../generated/contracts';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Card, CardContent } from '../../components/ui/card';
import { ErrorNotice } from '../../components/ErrorNotice';
import { FavoriteButton } from './FavoriteButton';
import { useOpenPlayer } from './useOpenPlayer';
export function PlayerSearchFavorites() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<Player | null>(null);
  const sequence = useRef(0);
  const open = useOpenPlayer();
  const app = useQuery({ queryKey: ['app'], queryFn: () => transport.call('get_app_state', {}) });
  const connection = useQuery({
    queryKey: ['connection'],
    queryFn: () => transport.call('get_connection_state', {}),
  });
  const favorites = useQuery({
    queryKey: ['favorites', app.data?.workspaceEpoch],
    queryFn: () => transport.call('list_favorites', {}),
    enabled: !!app.data,
  });
  const search = useMutation({
    mutationFn: async ({ query, seq }: { query: string; seq: number }) => ({
      player: await transport.call('search_player', { query }),
      seq,
      epoch: app.data!.workspaceEpoch,
      session: connection.data!.sessionEpoch,
    }),
    onSuccess: (value) => {
      if (
        sequence.current === value.seq &&
        queryClient.getQueryData<{ workspaceEpoch: string }>(['app'])?.workspaceEpoch ===
          value.epoch &&
        queryClient.getQueryData<{ sessionEpoch: string }>(['connection'])?.sessionEpoch ===
          value.session
      ) {
        setResult(value.player);
        void queryClient.invalidateQueries({ queryKey: ['players'] });
      }
    },
  });
  return (
    <Card className="player-tools">
      <CardContent>
        <form
          className="actions"
          onSubmit={(e) => {
            e.preventDefault();
            setResult(null);
            search.mutate({ query, seq: ++sequence.current });
          }}
        >
          <Label htmlFor="player-search">{t('scouting.searchPlayer')}</Label>
          <Input
            id="player-search"
            value={query}
            maxLength={100}
            onChange={(e) => {
              setQuery(e.target.value);
              sequence.current++;
              setResult(null);
            }}
          />
          <Button
            type="submit"
            disabled={!query.trim() || connection.data?.phase !== 'connected' || search.isPending}
          >
            {t('scouting.search')}
          </Button>
          <span className="help">
            {connection.data?.identification?.serverId
              ? serverName(t, connection.data.identification.serverId)
              : t('connection.disconnected')}
          </span>
        </form>
        <ErrorNotice error={search.error || favorites.error} />
        {result && (
          <div className="actions">
            <Button variant="link" onClick={() => open(result)}>
              {playerName(t, result)} · {serverName(t, result.serverId)}
            </Button>
            <FavoriteButton playerKey={result.playerKey} />
          </div>
        )}
        <div className="actions favorites">
          <strong>{t('scouting.favorites')}</strong>
          {!favorites.data?.length && <span className="help">{t('scouting.empty')}</span>}
          {favorites.data?.map((p) => (
            <div className="actions" key={p.playerKey}>
              <Button variant="outline" size="sm" onClick={() => open(p)}>
                {playerName(t, p)} · {serverName(t, p.serverId)}
              </Button>
              <FavoriteButton playerKey={p.playerKey} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
