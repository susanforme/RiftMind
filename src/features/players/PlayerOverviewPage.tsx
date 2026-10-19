import { lazy, Suspense, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWorkspaceNavigate, useWorkspaceSearch } from '../../app/workspace-page-context';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { playerRoute } from '../../app/router';
import { transport } from '../../app/runtime';
import { ErrorNotice } from '../../components/ErrorNotice';
import { GameEntityIcon } from '../../components/GameEntityIcon';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Label } from '../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible';
import {
  championName,
  errorName,
  playerName,
  positionName,
  queueName,
  rankName,
} from '../../lib/display-names';
import { serverName } from '../../lib/server-name';
import { RankEmblem } from '../live/PlayerRankBadge';
import { PlayerAvatar } from './PlayerAvatar';
import { PlayerSearchFavorites } from './PlayerSearchFavorites';
import { overviewPerformance, positionStats, rankScore } from './player-overview';

const OverviewCharts = lazy(() => import('./PlayerOverviewCharts'));

export function PlayerOverviewPage() {
  const { t, i18n } = useTranslation();
  const fieldId = useId();
  const search = useWorkspaceSearch(playerRoute.useSearch({ shouldThrow: false }));
  const navigate = useWorkspaceNavigate();
  const [days, setDays] = useState('30');
  const app = useQuery({ queryKey: ['app'], queryFn: () => transport.call('get_app_state', {}) });
  const connection = useQuery({
    queryKey: ['connection'],
    queryFn: () => transport.call('get_connection_state', {}),
  });
  const players = useQuery({
    queryKey: ['players'],
    queryFn: () => transport.call('list_players', {}),
  });
  const playerKey =
    search.player || connection.data?.player?.playerKey || players.data?.[0]?.playerKey;
  const overview = useQuery({
    queryKey: [
      'player-overview',
      app.data?.workspaceEpoch,
      connection.data?.sessionEpoch,
      playerKey,
      search.queue,
      days,
    ],
    queryFn: () =>
      transport.call('get_player_overview', {
        playerKey: playerKey!,
        queueId: search.queue ?? null,
        days: days === 'all' ? null : Number(days),
      }),
    enabled: app.data?.phase === 'ready' && !!playerKey && !!connection.data,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const result = overview.data;
  const profile = result?.profile;
  const matches = result?.matches || [];
  const stats = overviewPerformance(matches);
  const positions = positionStats(matches);
  const percent = (ratio: number | null) =>
    ratio === null
      ? '—'
      : new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 1 }).format(
          ratio,
        );
  const decimal = (value: number | null) =>
    value === null
      ? '—'
      : new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value);
  const snapshots = (result?.rankHistory || []).filter(
    (snapshot) =>
      !search.queue ||
      (search.queue === 420 && snapshot.rank.queue === 'RANKED_SOLO_5x5') ||
      (search.queue === 440 && snapshot.rank.queue === 'RANKED_FLEX_SR'),
  );
  const hasRankHistory = snapshots.some((snapshot) => rankScore(snapshot.rank) !== null);
  return (
    <div
      data-ui="page player-overview"
      className="mx-auto grid w-full max-w-[1600px] min-w-0 gap-5 p-6 max-[900px]:p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t('players.title')}</h1>
        <Button
          variant="outline"
          disabled={!playerKey || overview.isFetching}
          onClick={() => void overview.refetch()}
        >
          <RefreshCw
            aria-hidden="true"
            className={overview.isFetching ? 'animate-spin motion-reduce:animate-none' : ''}
          />
          {t('common.refresh')}
        </Button>
      </div>
      <PlayerSearchFavorites />
      <ErrorNotice error={overview.error || players.error} />
      {overview.isPending && playerKey ? (
        <div className="grid gap-5" role="status" aria-label={t('common.loading')}>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : profile && result ? (
        <>
          <Card className="grid gap-4 p-5">
            <CardHeader className="flex flex-row flex-wrap items-center gap-4 p-0">
              <PlayerAvatar player={profile.player} />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-2xl font-semibold">{playerName(t, profile.player)}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{serverName(t, profile.player.serverId)}</span>
                  <Badge variant="secondary">
                    {t(result.isSelf ? 'players.savedHistory' : 'players.recent50')}
                  </Badge>
                </div>
              </div>
              <div className="flex flex-wrap gap-4">
                {profile.ranks.map((rank) => (
                  <div key={rank.queue} className="flex items-center gap-2">
                    <RankEmblem rank={rank} large />
                    <div className="grid gap-1 text-xs">
                      <span className="text-muted-foreground">{queueName(t, rank.queue)}</span>
                      <strong>
                        {rankName(t, rank).replace(`${queueName(t, rank.queue)} `, '')}
                      </strong>
                    </div>
                  </div>
                ))}
                {!profile.ranks.length && (
                  <Badge variant="outline">
                    {t(profile.rankError ? 'players.rankUnavailable' : 'scouting.unranked')}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-x-10 gap-y-4 border-t pt-4 px-0 pb-0">
              {[
                [t('scouting.games'), profile.games],
                [t('matches.winRate'), percent(profile.winRate.value)],
                [t('matches.win'), stats.wins],
                [t('matches.loss'), stats.losses],
                ['KDA', decimal(stats.kda)],
                [t('players.csPerMinute'), decimal(stats.csPerMinute)],
              ].map(([label, value]) => (
                <div key={label} className="grid gap-1">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <strong className="text-2xl font-semibold tabular-nums">{value}</strong>
                </div>
              ))}
            </CardContent>
          </Card>
          {result.historyError && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('players.savedFallback')} · {errorName(t, result.historyError)}
            </p>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`overview-queue-${fieldId}`}>{t('matches.queue')}</Label>
              <Select
                value={String(search.queue || 'all')}
                onValueChange={(queue) =>
                  void navigate({
                    to: '/players',
                    search: { ...search, queue: queue === 'all' ? undefined : Number(queue) },
                    replace: true,
                  })
                }
              >
                <SelectTrigger id={`overview-queue-${fieldId}`} className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('matches.allQueues')}</SelectItem>
                  {[420, 440, 450].map((queue) => (
                    <SelectItem key={queue} value={String(queue)}>
                      {queueName(t, queue)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {result.isSelf && (
              <div className="grid gap-1.5">
                <Label htmlFor={`overview-period-${fieldId}`}>{t('players.period')}</Label>
                <Select value={days} onValueChange={setDays}>
                  <SelectTrigger id={`overview-period-${fieldId}`} className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">{t('players.days30')}</SelectItem>
                    <SelectItem value="90">{t('players.days90')}</SelectItem>
                    <SelectItem value="all">{t('players.allHistory')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <span className="pb-2 text-xs text-muted-foreground">
              {t('players.sample', { count: profile.games, decided: profile.winRate.samples })}
            </span>
          </div>
          {!matches.length && (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                {t('players.emptyMatches')}
              </CardContent>
            </Card>
          )}
          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
            <Card className="min-w-0 gap-3">
              <CardHeader>
                <CardTitle>{t('players.positions')}</CardTitle>
              </CardHeader>
              <CardContent>
                {positions.length > 0 ? (
                  <>
                    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                      <OverviewCharts kind="positions" matches={matches} snapshots={snapshots} />
                    </Suspense>
                    <Table aria-label={t('players.positions')}>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('matches.position')}</TableHead>
                          <TableHead>{t('players.share')}</TableHead>
                          <TableHead className="text-right">{t('matches.winRate')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {positions.map((row) => (
                          <TableRow key={row.position}>
                            <TableCell>{positionName(t, row.position)}</TableCell>
                            <TableCell className="tabular-nums">
                              {row.games} · {percent(row.games / matches.length)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {percent(row.winRate)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </>
                ) : (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    {t('players.emptyPositions')}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card className="min-w-0 gap-3">
              <CardHeader>
                <CardTitle>{t('players.rankHistory')}</CardTitle>
              </CardHeader>
              <CardContent>
                {hasRankHistory ? (
                  <>
                    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                      <OverviewCharts kind="rank" matches={matches} snapshots={snapshots} />
                    </Suspense>
                    <Collapsible>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm">
                          {t('players.rankRecords', { count: snapshots.length })}
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="max-h-64 overflow-auto">
                        <Table aria-label={t('players.rankHistory')}>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t('players.observedAt')}</TableHead>
                              <TableHead>{t('players.rank')}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {[...snapshots].reverse().map((snapshot) => (
                              <TableRow key={`${snapshot.collectedAt}:${snapshot.rank.queue}`}>
                                <TableCell>
                                  {new Date(snapshot.collectedAt).toLocaleString(i18n.language)}
                                </TableCell>
                                <TableCell>{rankName(t, snapshot.rank)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CollapsibleContent>
                    </Collapsible>
                  </>
                ) : (
                  <p className="flex min-h-64 items-center justify-center px-4 text-center text-sm text-muted-foreground">
                    {t(result.isSelf ? 'players.emptyRanks' : 'players.visitorRanks')}
                  </p>
                )}
                {hasRankHistory && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('players.observationsOnly')}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
          <Card className="min-w-0 gap-3">
            <CardHeader>
              <CardTitle>{t('players.recentChampions')}</CardTitle>
            </CardHeader>
            <CardContent>
              {profile.champions.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('matches.champion')}</TableHead>
                      <TableHead>{t('scouting.games')}</TableHead>
                      <TableHead>{t('matches.winRate')}</TableHead>
                      <TableHead className="text-right">KDA</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {profile.champions.slice(0, 10).map((champion) => {
                      const performance = overviewPerformance(
                        matches.filter((match) => match.championId === champion.championId),
                      );
                      return (
                        <TableRow key={champion.championId}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <GameEntityIcon
                                kind="champion"
                                id={champion.championId}
                                label={championName(t, champion.championId)}
                                className="size-10"
                              />
                              <span>{championName(t, champion.championId)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="tabular-nums">{champion.games}</TableCell>
                          <TableCell className="tabular-nums">
                            {percent(champion.decided ? champion.wins / champion.decided : null)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {decimal(performance.kda)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {t('players.emptyMatches')}
                </p>
              )}
            </CardContent>
          </Card>
          {matches.length > 0 && (
            <Card className="gap-3">
              <CardHeader>
                <CardTitle>{t('players.recentResults')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {matches.slice(0, 20).map((match) => (
                  <div
                    key={match.matchKey}
                    className="grid justify-items-center gap-1.5 rounded-md border p-2"
                    title={`${new Date(match.startedAt).toLocaleString(i18n.language)} · ${positionName(t, match.position)}`}
                  >
                    <GameEntityIcon
                      kind="champion"
                      id={match.championId}
                      version={match.version}
                      label={championName(t, match.championId)}
                    />
                    <Badge
                      variant="secondary"
                      className={
                        match.outcome === 'win'
                          ? 'text-(--win)'
                          : match.outcome === 'loss'
                            ? 'text-(--loss)'
                            : 'text-muted-foreground'
                      }
                    >
                      {t(`matches.${match.outcome}`)}
                    </Badge>
                    <span className="text-xs tabular-nums">
                      {match.kills ?? '—'}/{match.deaths ?? '—'}/{match.assists ?? '—'}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        !overview.isFetching && (
          <Card>
            <CardContent className="p-10 text-center text-sm text-muted-foreground">
              {t(playerKey ? 'players.loadFailed' : 'players.selectPlayer')}
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}
