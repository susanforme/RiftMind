import { lazy, Suspense, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWorkspaceNavigate, useWorkspaceSearch } from '../../app/workspace-page-context';
import { useTranslation } from 'react-i18next';
import { ChevronRight, LoaderCircle } from 'lucide-react';
import { championsRoute, type Search } from '../../app/router';
import { transport } from '../../app/runtime';
import { GameEntityIcon, portraitCatalogueVersion } from '../../components/GameEntityIcon';
import { ChampionArtwork, selectedChampionSkin } from '../../components/ChampionArtwork';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { ChampionSelect } from '../../components/ChampionSelect';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { championName, playerName } from '../../lib/display-names';
import { serverName } from '../../lib/server-name';
import { MetricValue } from '../analysis/MetricValue';
import { PlayerAvatar } from '../players/PlayerAvatar';
import { ChartBoundary } from '../review/ChartBoundary';
import { ChampionPoolFilters } from './ChampionPoolFilters';
import { ChampionChartSkeleton, ChampionTableSkeleton } from './ChampionPoolSkeleton';
import { championPageSize, useChampionPool } from './champion-pool';
import { ChampionDetailPage } from './ChampionDetailPage';

const ChampionGamesChart = lazy(() => import('./ChampionGamesChart'));

export function ChampionsPage() {
  const { t, i18n } = useTranslation();
  const search = useWorkspaceSearch(championsRoute.useSearch({ shouldThrow: false }));
  const navigate = useWorkspaceNavigate();
  const app = useQuery({ queryKey: ['app'], queryFn: () => transport.call('get_app_state', {}) });
  const players = useQuery({
    queryKey: ['players'],
    queryFn: () => transport.call('list_players', {}),
  });
  const connection = useQuery({
    queryKey: ['connection'],
    queryFn: () => transport.call('get_connection_state', {}),
  });
  const playerKey =
    search.player || connection.data?.player?.playerKey || players.data?.[0]?.playerKey;
  useEffect(() => {
    if (!search.player && playerKey)
      void navigate({ to: '/champions', search: { ...search, player: playerKey }, replace: true });
  }, [navigate, playerKey, search]);
  const connectedPlayer = connection.data?.player;
  const player =
    players.data?.find((candidate) => candidate.playerKey === playerKey) ||
    (connectedPlayer?.playerKey === playerKey ? connectedPlayer : undefined) ||
    undefined;
  const cursor = search.championCursor ?? 0;
  const sort = search.championSort || 'games';
  const pool = useChampionPool(
    playerKey,
    app.data?.workspaceEpoch,
    search,
    sort,
    cursor,
    championPageSize,
    !search.champion,
  );
  const chart = useChampionPool(
    playerKey,
    app.data?.workspaceEpoch,
    search,
    'games',
    null,
    6,
    !search.champion,
  );
  const openChampion = useCallback(
    (championId: number) => {
      void navigate({
        to: '/champions',
        search: { ...search, player: playerKey, champion: championId },
      });
    },
    [navigate, search, playerKey],
  );
  const bannerChampionId = search.champion || chart.data?.items[0]?.championId;
  const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';
  const skins = useQuery({
    queryKey: ['champion-skins', portraitCatalogueVersion, locale, bannerChampionId],
    queryFn: () =>
      transport.call('get_champion_skins', {
        championId: bannerChampionId!,
        version: portraitCatalogueVersion,
        locale,
      }),
    enabled: !!bannerChampionId,
    staleTime: Infinity,
    retry: false,
  });
  function changeFilters(next: Search) {
    void navigate({
      to: '/champions',
      search: { ...next, player: playerKey, champion: undefined, championCursor: undefined },
    });
  }
  const rows = pool.data?.items || [];
  const waitingForPlayer = players.isPending || connection.isPending;
  if (search.champion)
    return (
      <ChampionDetailPage
        playerKey={playerKey}
        workspaceEpoch={app.data?.workspaceEpoch}
        search={search}
        skin={selectedChampionSkin(skins.data?.skins || [], undefined)}
      />
    );
  return (
    <div
      data-ui="page champions-page"
      className="mx-auto grid w-full max-w-[1600px] min-w-0 gap-4 p-4 md:p-6"
    >
      <Card
        className="relative flex min-h-36 items-center overflow-hidden bg-card p-5 sm:min-h-36 sm:p-6"
        data-ui="champion-pool-banner"
      >
        <ChampionArtwork
          skin={selectedChampionSkin(skins.data?.skins || [], undefined)}
          version={portraitCatalogueVersion}
          banner
        />
        <div className="relative flex min-w-0 items-center gap-4">
          <PlayerAvatar player={player} className="size-16 sm:size-20" />
          <div className="grid min-w-0 gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{t('scouting.champions')}</h1>
            <Select
              value={playerKey || ''}
              onValueChange={(player) => {
                void navigate({
                  to: '/champions',
                  search: { ...search, player, championCursor: undefined },
                });
              }}
            >
              <SelectTrigger
                aria-label={t('matches.openPlayer')}
                className="w-[min(16rem,45vw)] max-w-full border-0 bg-transparent px-0 text-lg font-semibold shadow-none"
              >
                <SelectValue placeholder={t('matches.selectPlayer')} />
              </SelectTrigger>
              <SelectContent>
                {players.data?.map((candidate) => (
                  <SelectItem key={candidate.playerKey} value={candidate.playerKey}>
                    {playerName(t, candidate)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">
              {player ? serverName(t, player.serverId) : '—'}
            </span>
          </div>
        </div>
      </Card>
      <ChampionPoolFilters search={search} onChange={changeFilters} />
      <ErrorNotice error={pool.error || chart.error || players.error} />
      <Card
        data-ui="champion-chart-panel"
        className="grid grid-cols-1 gap-2 py-3"
        aria-busy={chart.isFetching}
      >
        <CardHeader className="flex-row items-center justify-between px-4 py-0">
          <CardTitle>{t('scouting.championUsage')}</CardTitle>
          <span className="text-xs text-muted-foreground">{t('scouting.games')}</span>
        </CardHeader>
        <CardContent className="h-56 min-w-0 px-4 py-0">
          <ChartBoundary fallback={t('review.chartFailed')}>
            {chart.isPending && (!!playerKey || waitingForPlayer) ? (
              <ChampionChartSkeleton />
            ) : chart.data?.items.length ? (
              <Suspense fallback={<ChampionChartSkeleton />}>
                <ChampionGamesChart rows={chart.data.items} onChampion={openChampion} />
              </Suspense>
            ) : (
              <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
                {t('scouting.empty')}
              </div>
            )}
          </ChartBoundary>
        </CardContent>
      </Card>
      <Card
        data-ui="champion-table-panel"
        className="grid grid-cols-1 gap-2 py-3"
        aria-busy={pool.isFetching}
      >
        <CardHeader className="flex flex-wrap items-center justify-between gap-3 px-4 py-0 sm:flex-row">
          <CardTitle>{t('scouting.championData')}</CardTitle>
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div
              role="status"
              className="flex size-5 items-center justify-center"
              aria-label={pool.isFetching ? t('common.loading') : undefined}
            >
              {pool.isFetching && (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
              )}
            </div>
            <div className="w-48">
              <ChampionSelect
                onValueChange={(championId) => {
                  if (championId) openChampion(championId);
                }}
              />
            </div>
            <Select
              value={sort}
              onValueChange={(championSort) => {
                void navigate({
                  to: '/champions',
                  search: { ...search, championSort, championCursor: undefined },
                });
              }}
            >
              <SelectTrigger aria-label={t('scouting.sort')} className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['games', 'win_rate', 'kda', 'cs_per_min', 'damage_share'].map((metric) => (
                  <SelectItem key={metric} value={metric}>
                    {t(`scouting.${metric}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="min-h-[328px] px-0 py-0">
          {pool.isPending && (!!playerKey || waitingForPlayer) ? (
            <ChampionTableSkeleton />
          ) : (
            <Table className="table-fixed tabular-nums [&_td]:px-4 [&_td]:py-1 [&_th]:px-4">
              <TableHeader className="h-10 bg-muted/40">
                <TableRow>
                  <TableHead className="w-48 sm:w-56">{t('scouting.champion')}</TableHead>
                  <TableHead className="w-20 text-right">{t('scouting.games')}</TableHead>
                  <TableHead className="w-28 text-right">{t('scouting.win_rate')}</TableHead>
                  <TableHead className="w-24 text-right">KDA</TableHead>
                  <TableHead className="hidden w-32 text-right lg:table-cell">
                    {t('scouting.cs_per_min')}
                  </TableHead>
                  <TableHead className="hidden w-32 text-right xl:table-cell">
                    {t('scouting.damage_share')}
                  </TableHead>
                  <TableHead className="w-14">
                    <span className="sr-only">{t('scouting.viewChampion')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((champion) => (
                  <TableRow key={champion.championId ?? 'unknown'} className="h-12">
                    <TableCell>
                      <Button
                        variant="ghost"
                        aria-label={championName(t, champion.championId)}
                        className="h-10 w-full justify-start gap-3 px-0 text-left font-semibold"
                        disabled={!champion.championId}
                        onClick={() => openChampion(champion.championId!)}
                      >
                        <GameEntityIcon
                          kind="champion"
                          id={champion.championId}
                          label={championName(t, champion.championId)}
                          className="size-8 rounded-full"
                        />
                        <span className="truncate">{championName(t, champion.championId)}</span>
                      </Button>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{champion.games}</TableCell>
                    <TableCell className="text-right">
                      <MetricValue metric={champion.winRate} ratio showSamples={false} />
                    </TableCell>
                    <TableCell className="text-right">
                      <MetricValue metric={champion.kda} showSamples={false} />
                    </TableCell>
                    <TableCell className="hidden text-right lg:table-cell">
                      <MetricValue metric={champion.csPerMin} showSamples={false} />
                    </TableCell>
                    <TableCell className="hidden text-right xl:table-cell">
                      <MetricValue metric={champion.damageShare} ratio showSamples={false} />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!champion.championId}
                        aria-label={t('scouting.viewChampionNamed', {
                          champion: championName(t, champion.championId),
                        })}
                        onClick={() => openChampion(champion.championId!)}
                      >
                        <ChevronRight aria-hidden="true" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow>
                    <TableCell colSpan={7} className="h-72 text-center text-muted-foreground">
                      {t('scouting.empty')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
        <div className="flex items-center justify-end gap-2 px-4">
          <Button
            variant="outline"
            disabled={!cursor || pool.isFetching}
            onClick={() => {
              void navigate({
                to: '/champions',
                search: { ...search, championCursor: Math.max(0, cursor - championPageSize) },
              });
            }}
          >
            {t('scouting.previousPage')}
          </Button>
          <span className="min-w-8 text-center text-sm tabular-nums">
            {Math.floor(cursor / championPageSize) + 1}
          </span>
          <Button
            variant="outline"
            disabled={pool.isFetching || pool.data?.nextCursor == null}
            onClick={() => {
              void navigate({
                to: '/champions',
                search: { ...search, championCursor: pool.data!.nextCursor! },
              });
            }}
          >
            {t('matches.next')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
