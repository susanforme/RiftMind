import { PreGameNotebook } from '../champion-notes/PreGameNotebook';
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
    <div data-ui="page live-page" className="mx-auto grid w-full max-w-[1600px] gap-6 p-4 md:p-6">
      <div data-ui="page-heading" className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('scouting.live')}</h1>
        <Button variant="outline" onClick={() => void live.refetch()}>
          {t('common.refresh')}
        </Button>
      </div>
      <ErrorNotice
        error={live.error || (s?.error ? { code: s.error } : null) || retry.error || sync.error}
      />
      <div
        data-ui="actions"
        className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm"
        role="status"
      >
        <Badge>{codeName(t, 'phase', s?.phase || 'None')}</Badge>
        {s?.stale && <Badge variant="outline">{t('scouting.stale')}</Badge>}
        {s?.queueId && <span>{queueName(t, s.queueId)}</span>}
        {s?.mode && <span>{codeName(t, 'mode', s.mode)}</span>}
        {s?.updatedAt && (
          <time className="text-muted-foreground text-[12px]">
            {new Date(s.updatedAt).toLocaleTimeString()}
          </time>
        )}
      </div>
      {connection.data?.phase !== 'connected' && (
        <Card>
          <CardContent data-ui="actions" className="flex flex-wrap items-center gap-3 pt-5">
            <span>{t(`connection.${connection.data?.phase || 'disconnected'}`)}</span>
            <Button variant="outline" disabled={retry.isPending} onClick={() => retry.mutate()}>
              {t('common.retry')}
            </Button>
          </CardContent>
        </Card>
      )}
      {!!s?.bans.length && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>{t('scouting.bans')}</span>
          {s.bans.map((id) => (
            <span
              className="inline-flex items-center gap-1.5 me-2.5 align-middle [&_[data-slot='avatar']]:w-6 [&_[data-slot='avatar']]:h-6"
              key={id}
            >
              <GameEntityIcon kind="champion" id={id} label={championName(t, id)} />
              {championName(t, id)}
            </span>
          ))}
        </div>
      )}
      <PreGameNotebook
        key={`${s?.sessionEpoch}:${s?.generation}`}
        snapshot={s}
        epoch={app.data?.workspaceEpoch}
      />
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-2">
        {teams.map((team) => (
          <Card key={team} data-ui="live-team">
            <CardHeader className="border-b border-border py-4">
              <CardTitle>{codeName(t, 'team', team)}</CardTitle>
            </CardHeader>
            <CardContent data-ui="review-stack" className="grid min-w-0 divide-y divide-border p-0">
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
            </CardContent>
          </Card>
        ))}
      </div>
      {!s?.seats.length && (
        <Card>
          <CardContent className="pt-5 text-sm text-muted-foreground">
            {live.isPending ? (
              <Skeleton className="h-24" aria-label={t('common.loading')} />
            ) : (
              t('scouting.noLineup')
            )}
          </CardContent>
        </Card>
      )}
      {s?.phase === 'EndOfGame' && (
        <Card>
          <CardContent data-ui="actions" className="flex flex-wrap items-center gap-3 pt-5">
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
    <Card
      data-ui="live-seat"
      data-current={seat.current}
      className="rounded-none border-0 border-s-2 border-s-transparent bg-transparent data-[current=true]:border-s-primary data-[current=true]:bg-accent/40"
    >
      <CardHeader className="gap-3 p-4 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <GameEntityIcon
            kind="champion"
            id={seat.championId}
            label={championName(t, seat.championId)}
            className="size-12 rounded-lg"
          />
          <div className="min-w-0 flex-1">
            <CardTitle className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {seat.player ? (
                <Button
                  className="h-auto min-w-0 whitespace-normal p-0 text-left font-semibold text-foreground"
                  variant="link"
                  onClick={() => open(seat.player!)}
                >
                  {playerName(t, seat.player)}
                </Button>
              ) : (
                <span>{t('scouting.anonymous')}</span>
              )}
              {seat.current && <Badge variant="secondary">{t('common.current')}</Badge>}
            </CardTitle>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <ChampionNotebookLink championId={seat.championId} />
              <span>{positionName(t, seat.position)}</span>
            </div>
          </div>
          {seat.player && <FavoriteButton playerKey={seat.player.playerKey} />}
          {!!seat.spellIds.length && (
            <div className="flex shrink-0 gap-1" aria-label={t('scouting.spells')}>
              {seat.spellIds.map((id) => (
                <GameEntityIcon
                  key={id}
                  kind="spell"
                  id={id}
                  label={spellName(t, id)}
                  className="size-6"
                />
              ))}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <ErrorNotice error={profile.error} />
        {profile.isFetching && !profile.data && <Skeleton className="h-32" />}
        {profile.data && (
          <div data-ui="profile-stats" className="grid gap-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
              <span>
                {t('scouting.currentRank')}:{' '}
                {profile.data.ranks
                  .filter((rank) => rank.tier)
                  .map((rank) => rankName(t, rank))
                  .join(', ') ||
                  t(profile.data.rankError ? 'scouting.unavailable' : 'scouting.unranked')}
              </span>
              <span>
                {t('scouting.recent', { count: profile.data.games })} ·{' '}
                {queueId ? queueName(t, queueId) : t('matches.allQueues')}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-4 rounded-md bg-muted/40 px-3 py-2.5">
              <div className="grid gap-1">
                <dt className="text-muted-foreground">{t('scouting.winRate')}</dt>
                <dd className="text-lg font-semibold">
                  <MetricValue metric={profile.data.winRate} ratio />
                </dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-muted-foreground">KDA</dt>
                <dd className="text-lg font-semibold">
                  <MetricValue metric={profile.data.kda} />
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-muted-foreground">{t('scouting.commonChampions')}</span>
              {profile.data.champions.slice(0, 3).map((champion) => (
                <span
                  className="inline-flex items-center gap-1.5 tabular-nums"
                  key={champion.championId}
                >
                  <GameEntityIcon
                    kind="champion"
                    id={champion.championId}
                    label={championName(t, champion.championId)}
                    className="size-6"
                  />
                  <span>{champion.games}</span>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-border pt-2.5">
              <span className="text-muted-foreground">
                {t('scouting.thisChampion', { count: profile.data.championGames })}
              </span>
              <MetricValue metric={profile.data.championWinRate} ratio />
              <span className="text-muted-foreground">KDA</span>
              <MetricValue metric={profile.data.championKda} />
            </div>
            <time className="text-muted-foreground">
              {new Date(profile.data.collectedAt).toLocaleString()}
            </time>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChampionNotebookLink({ championId }: { championId: number | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Button
      variant="link"
      className="h-auto p-0 text-xs text-muted-foreground"
      disabled={!championId}
      onClick={() =>
        void navigate({ to: '/notebooks', search: { champion: championId || undefined } })
      }
    >
      {championName(t, championId)} · {t('notebooks.titlePage')}
    </Button>
  );
}
