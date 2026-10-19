import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { PreGameNotebook } from '../champion-notes/PreGameNotebook';
import { GameEntityIcon } from '../../components/GameEntityIcon';
import { codeName, queueName, championName } from '../../lib/display-names';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { transport } from '../../app/runtime';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { ErrorNotice } from '../../components/ErrorNotice';
import { RefreshCw, ShieldBan, Swords, Users } from 'lucide-react';
import { LivePlayerCard } from './LivePlayerCard';
import { isPartyPhase, sortLiveSeats } from './live-roster';
export function LivePage() {
  const { t, i18n } = useTranslation();
  const [metricScope, setMetricScope] = useState<'recent' | 'champion'>('recent');
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
  const snapshot = live.data;
  const partyPhase = isPartyPhase(snapshot?.phase);
  const hasChampions = !!snapshot?.seats.some((seat) => seat.championId);
  const displayedScope = hasChampions ? metricScope : 'recent';
  const teams = [...new Set(snapshot?.seats.map((seat) => seat.teamId))].sort(
    (left, right) => left - right,
  );
  return (
    <div
      data-ui="page live-page"
      className="mx-auto grid w-full max-w-[1800px] min-w-0 gap-4 p-4 md:p-5"
    >
      <div data-ui="page-heading" className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('scouting.live')}</h1>
        <Button variant="outline" disabled={live.isFetching} onClick={() => void live.refetch()}>
          <RefreshCw aria-hidden="true" className={live.isFetching ? 'animate-spin' : ''} />
          {t('common.refresh')}
        </Button>
      </div>
      <ErrorNotice
        error={
          live.error ||
          (snapshot?.error ? { code: snapshot.error } : null) ||
          retry.error ||
          sync.error
        }
      />
      <Card className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg px-4 py-2.5">
        <div data-ui="actions" className="flex flex-wrap items-center gap-3 text-sm" role="status">
          <Badge className="gap-1.5 rounded-md">
            <Swords aria-hidden="true" className="size-3.5" />
            {codeName(t, 'phase', snapshot?.phase || 'None')}
          </Badge>
          {snapshot?.stale && <Badge variant="outline">{t('scouting.stale')}</Badge>}
          {snapshot?.queueId != null && <span>{queueName(t, snapshot.queueId)}</span>}
          {snapshot?.mode && (
            <span className="text-muted-foreground">{codeName(t, 'mode', snapshot.mode)}</span>
          )}
          {snapshot?.updatedAt && (
            <time
              dateTime={snapshot.updatedAt}
              className="text-xs text-muted-foreground tabular-nums"
            >
              {new Date(snapshot.updatedAt).toLocaleTimeString(i18n.language)}
            </time>
          )}
        </div>
        {!!snapshot?.bans.length && !!snapshot.seats.length && (
          <div className="flex flex-wrap items-center gap-2" aria-label={t('scouting.bans')}>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldBan aria-hidden="true" className="size-3.5" />
              {t('scouting.bans')}
            </span>
            {snapshot.bans.map((championId, index) => (
              <GameEntityIcon
                key={`${index}:${championId}`}
                kind="champion"
                id={championId}
                label={championName(t, championId)}
                className="size-7 rounded-sm opacity-70 grayscale"
              />
            ))}
          </div>
        )}
      </Card>
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
      {!!teams.length && (
        <Tabs
          value={displayedScope}
          onValueChange={(value) => setMetricScope(value as 'recent' | 'champion')}
          className="min-w-0"
        >
          <TabsList
            aria-label={t('scouting.statScope')}
            className={!hasChampions ? 'hidden' : undefined}
          >
            <TabsTrigger value="recent">{t('scouting.recentStats')}</TabsTrigger>
            {hasChampions && (
              <TabsTrigger value="champion">{t('scouting.championStats')}</TabsTrigger>
            )}
          </TabsList>
          <TabsContent
            value={displayedScope}
            className="mt-0 grid min-w-0 gap-4 data-[has-champions=true]:mt-3"
            data-has-champions={hasChampions}
          >
            {teams.map((teamId) => {
              const teamSeats = snapshot?.seats.filter((seat) => seat.teamId === teamId) || [];
              const seats = partyPhase
                ? teamSeats.sort(
                    (left, right) =>
                      Number(right.current) - Number(left.current) || left.seat - right.seat,
                  )
                : sortLiveSeats(teamSeats);
              return (
                <Card
                  key={teamId}
                  data-ui="live-team"
                  className="@container overflow-hidden rounded-xl bg-muted/20"
                >
                  <CardHeader
                    className={`flex-row flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2 ${teamId === 100 || teamId === 1 ? 'bg-(--win-bg)' : teamId === 200 || teamId === 2 ? 'bg-(--loss-bg)' : 'bg-muted/40'}`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className={`h-5 w-1 rounded-full ${teamId === 100 || teamId === 1 ? 'bg-(--win)' : teamId === 200 || teamId === 2 ? 'bg-(--loss)' : 'bg-primary'}`}
                      />
                      <CardTitle
                        className={
                          teamId === 100 || teamId === 1
                            ? 'text-(--win)'
                            : teamId === 200 || teamId === 2
                              ? 'text-(--loss)'
                              : ''
                        }
                      >
                        {partyPhase && teamId === 0
                          ? t('scouting.partyMembers')
                          : codeName(t, 'team', teamId)}
                      </CardTitle>
                      {!partyPhase && seats.some((seat) => seat.current) && (
                        <Badge variant="outline" className="bg-card/60 text-xs font-normal">
                          {t('scouting.yourTeam')}
                        </Badge>
                      )}
                    </div>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users aria-hidden="true" className="size-3.5" />
                      {t('scouting.playerCount', { count: seats.length })}
                    </span>
                  </CardHeader>
                  <CardContent
                    className={`grid grid-cols-1 items-stretch gap-3 p-3 ${partyPhase ? '@min-[560px]:grid-cols-2 @min-[900px]:grid-cols-3 @min-[1300px]:grid-cols-4' : '@min-[440px]:grid-cols-2 @min-[720px]:grid-cols-3 @min-[1000px]:grid-cols-5'}`}
                  >
                    {seats.map((seat) => (
                      <LivePlayerCard
                        key={`${snapshot!.generation}:${teamId}:${seat.seat}`}
                        seat={seat}
                        queueId={snapshot!.queueId}
                        epoch={app.data!.workspaceEpoch}
                        session={snapshot!.sessionEpoch}
                        stale={snapshot!.stale}
                        metricScope={displayedScope}
                      />
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>
        </Tabs>
      )}
      {!snapshot?.seats.length && (
        <Card>
          <CardContent className="grid min-h-64 place-content-center justify-items-center gap-3 pt-5 text-sm text-muted-foreground">
            <Swords aria-hidden="true" className="size-10 text-muted-foreground/50" />
            {live.isPending ? (
              <Skeleton className="h-24 w-64 max-w-full" aria-label={t('common.loading')} />
            ) : (
              t('scouting.noLineup')
            )}
          </CardContent>
        </Card>
      )}
      <PreGameNotebook
        key={`${snapshot?.sessionEpoch}:${snapshot?.generation}`}
        snapshot={snapshot}
        epoch={app.data?.workspaceEpoch}
      />
      {snapshot?.phase === 'EndOfGame' && (
        <Card>
          <CardContent data-ui="actions" className="flex flex-wrap items-center gap-3 pt-5">
            {snapshot.matchKey ? (
              <Button
                onClick={() =>
                  void navigate({
                    to: '/matches/$matchKey/review',
                    params: { matchKey: snapshot.matchKey! },
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
