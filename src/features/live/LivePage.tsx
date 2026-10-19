import { GameEntityIcon } from '../../components/GameEntityIcon';
import {
  codeName,
  queueName,
  positionName,
  championName,
  rankName,
  spellName,
  playerName,
} from '../../lib/display-names';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { transport } from '../../app/runtime';
import type { LiveSeat } from '../../generated/contracts';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { ErrorNotice } from '../../components/ErrorNotice';
import { FavoriteButton } from '../players/FavoriteButton';
import { MetricValue } from '../analysis/MetricValue';
import { useOpenPlayer } from '../players/useOpenPlayer';
export function LivePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const app = useQuery({ queryKey: ['app'], queryFn: () => transport.call('get_app_state', {}) });
  const connection = useQuery({
    queryKey: ['connection'],
    queryFn: () => transport.call('get_connection_state', {}),
  });
  const live = useQuery({
    queryKey: ['live', app.data?.workspaceEpoch, connection.data?.sessionEpoch],
    queryFn: () => transport.call('get_live_snapshot', {}),
    enabled: !!app.data,
    refetchInterval: 5000,
  });
  const retry = useMutation({ mutationFn: () => transport.call('retry_connection', {}) });
  const sync = useMutation({
    mutationFn: () =>
      transport.call('sync_player_matches', {
        playerKey: connection.data!.player!.playerKey,
        pages: 1,
      }),
  });
  const s = live.data;
  const teams = [...new Set(s?.seats.map((p) => p.teamId))];
  return (
    <div className="page live-page">
      <div className="page-heading">
        <h1>{t('scouting.live')}</h1>
        <Button variant="outline" onClick={() => void live.refetch()}>
          {t('common.refresh')}
        </Button>
      </div>
      <ErrorNotice
        error={live.error || (s?.error ? { code: s.error } : null) || retry.error || sync.error}
      />
      <div className="actions" role="status">
        <Badge>{codeName(t, 'phase', s?.phase || 'None')}</Badge>
        {s?.stale && <Badge variant="outline">{t('scouting.stale')}</Badge>}
        {s?.queueId && <span>{queueName(t, s.queueId)}</span>}
        {s?.mode && <span>{codeName(t, 'mode', s.mode)}</span>}
        {s?.updatedAt && <time className="help">{new Date(s.updatedAt).toLocaleTimeString()}</time>}
      </div>
      {connection.data?.phase !== 'connected' && (
        <Card>
          <CardContent className="actions">
            <span>{t(`connection.${connection.data?.phase || 'disconnected'}`)}</span>
            <Button variant="outline" disabled={retry.isPending} onClick={() => retry.mutate()}>
              {t('common.retry')}
            </Button>
          </CardContent>
        </Card>
      )}
      {!!s?.bans.length && (
        <p>
          {t('scouting.bans')}:{' '}
          {s.bans.map((id) => (
            <span className="inline-entity" key={id}>
              <GameEntityIcon kind="champion" id={id} label={championName(t, id)} />
              {championName(t, id)}
            </span>
          ))}
        </p>
      )}
      <div className="live-teams">
        {teams.map((team) => (
          <section key={team}>
            <h2>{codeName(t, 'team', team)}</h2>
            <div className="review-stack">
              {s?.seats
                .filter((p) => p.teamId === team)
                .map((p) => (
                  <SeatCard
                    key={`${s.generation}:${team}:${p.seat}`}
                    seat={p}
                    queueId={s.queueId}
                    epoch={app.data!.workspaceEpoch}
                    session={s.sessionEpoch}
                    stale={s.stale}
                  />
                ))}
            </div>
          </section>
        ))}
      </div>
      {!s?.seats.length && (
        <Card>
          <CardContent>{t(live.isPending ? 'common.loading' : 'scouting.noLineup')}</CardContent>
        </Card>
      )}
      {s?.phase === 'EndOfGame' && (
        <Card>
          <CardContent className="actions">
            {s.matchKey ? (
              <Button
                onClick={() =>
                  void navigate({
                    to: '/matches/$matchKey/review',
                    params: { matchKey: s.matchKey! },
                    search: { player: connection.data?.player?.playerKey },
                  })
                }
              >
                {t('review.open')}
              </Button>
            ) : (
              <>
                <span>{t('scouting.waitingSettlement')}</span>
                <Button
                  variant="outline"
                  disabled={connection.data?.phase !== 'connected' || sync.isPending}
                  onClick={() => sync.mutate()}
                >
                  {t('matches.sync')}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
function SeatCard({
  seat,
  queueId,
  epoch,
  session,
  stale,
}: {
  seat: LiveSeat;
  queueId: number | null;
  epoch: string;
  session: string;
  stale: boolean;
}) {
  const { t } = useTranslation();
  const open = useOpenPlayer();
  const profile = useQuery({
    queryKey: ['player-profile', epoch, session, seat.player?.playerKey, queueId, seat.championId],
    queryFn: () =>
      transport.call('get_player_profile', {
        playerKey: seat.player!.playerKey,
        queueId,
        championId: seat.championId,
      }),
    enabled: !!seat.player && !stale,
    staleTime: 60000,
    retry: false,
  });
  return (
    <Card className={`live-seat ${seat.current ? 'current-player' : ''}`}>
      <CardHeader>
        <CardTitle className="actions">
          <GameEntityIcon
            kind="champion"
            id={seat.championId}
            label={championName(t, seat.championId)}
          />
          {seat.player ? (
            <Button variant="link" onClick={() => open(seat.player!)}>
              {playerName(t, seat.player)}
            </Button>
          ) : (
            <span>{t('scouting.anonymous')}</span>
          )}
          {seat.current && <Badge variant="secondary">{t('common.current')}</Badge>}
          {seat.player && <FavoriteButton playerKey={seat.player.playerKey} />}
        </CardTitle>
        <div className="meta-line">
          <strong>{championName(t, seat.championId)}</strong>
          <span>{positionName(t, seat.position)}</span>
          {!!seat.spellIds.length && (
            <span>
              {t('scouting.spells')}:{' '}
              {seat.spellIds.map((id) => (
                <span className="inline-entity" key={id}>
                  <GameEntityIcon kind="spell" id={id} label={spellName(t, id)} />
                  {spellName(t, id)}
                </span>
              ))}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <ErrorNotice error={profile.error} />
        {profile.isFetching && !profile.data && <Skeleton className="profile-skeleton" />}
        {profile.data && (
          <div className="profile-stats">
            <p>
              {t('scouting.currentRank')}:{' '}
              {profile.data.ranks
                .filter((r) => r.tier)
                .map((r) => rankName(t, r))
                .join(', ') ||
                t(profile.data.rankError ? 'scouting.unavailable' : 'scouting.unranked')}
            </p>
            <p>
              {t('scouting.recent', { count: profile.data.games })} ·{' '}
              {queueId ? queueName(t, queueId) : t('matches.allQueues')}
            </p>
            <p>
              {t('scouting.winRate')}: <MetricValue metric={profile.data.winRate} ratio /> · KDA{' '}
              <MetricValue metric={profile.data.kda} />
            </p>
            <p>
              {t('scouting.commonChampions')}:{' '}
              {profile.data.champions.slice(0, 3).map((champion) => (
                <span className="inline-entity" key={champion.championId}>
                  <GameEntityIcon
                    kind="champion"
                    id={champion.championId}
                    label={championName(t, champion.championId)}
                  />
                  {championName(t, champion.championId)} ({champion.games})
                </span>
              ))}
            </p>
            <p>
              {t('scouting.thisChampion', { count: profile.data.championGames })}:{' '}
              <MetricValue metric={profile.data.championWinRate} ratio /> · KDA{' '}
              <MetricValue metric={profile.data.championKda} />
            </p>
            <time className="help">{new Date(profile.data.collectedAt).toLocaleString()}</time>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
