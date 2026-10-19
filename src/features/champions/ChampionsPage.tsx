import { GameEntityIcon } from '../../components/GameEntityIcon';
import { matchOutcomeClasses } from '../../lib/match-outcome';
import { championName, groupName } from '../../lib/display-names';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { lazy, Suspense, useState } from 'react';
import { championsRoute } from '../../app/router';
import { transport } from '../../app/runtime';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
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
import { Badge } from '../../components/ui/badge';
import { ErrorNotice } from '../../components/ErrorNotice';
import { AnalysisFilters } from '../analysis/AnalysisFilters';
import { MetricValue } from '../analysis/MetricValue';
import { toAnalysisFilter } from '../analysis/analysis-filter';
import { ChartBoundary } from '../review/ChartBoundary';
const ChampionGamesChart = lazy(() => import('./ChampionGamesChart'));
export function ChampionsPage() {
  const { t } = useTranslation();
  const search = championsRoute.useSearch();
  const navigate = useNavigate();
  const [sort, setSort] = useState('games');
  const [cursor, setCursor] = useState<number | null>(null);
  const app = useQuery({ queryKey: ['app'], queryFn: () => transport.call('get_app_state', {}) });
  const players = useQuery({
    queryKey: ['players'],
    queryFn: () => transport.call('list_players', {}),
  });
  const connection = useQuery({
    queryKey: ['connection'],
    queryFn: () => transport.call('get_connection_state', {}),
  });
  const player =
    search.player || connection.data?.player?.playerKey || players.data?.[0]?.playerKey;
  const pool = useQuery({
    queryKey: ['champion-pool', app.data?.workspaceEpoch, player, search, sort, cursor],
    queryFn: () =>
      transport.call('get_champion_pool', {
        filter: toAnalysisFilter(player!, search),
        sort,
        cursor,
        limit: 50,
      }),
    enabled: !!player && !!app.data,
  });
  return (
    <div
      data-ui="page champions-page"
      className="mx-auto grid w-full max-w-[1600px] gap-6 p-4 md:p-6"
    >
      <div
        data-ui="page-heading"
        className="flex min-w-0 flex-wrap items-center justify-between gap-4"
      >
        <h1 className="text-2xl font-semibold tracking-tight">{t('scouting.champions')}</h1>
      </div>
      <AnalysisFilters
        key={JSON.stringify(search)}
        search={search}
        player={player}
        players={players.data}
        onPlayer={(player) => {
          setCursor(null);
          void navigate({ to: '/champions', search: { ...search, player } });
        }}
        onChange={(s) => {
          setCursor(null);
          void navigate({ to: '/champions', search: { ...s, player } });
        }}
      />
      <ErrorNotice error={pool.error || players.error} />
      <div data-ui="actions" className="flex flex-wrap items-center gap-3">
        <Badge variant="outline">
          {t('scouting.localCoverage', { count: pool.data?.cachedMatches || 0 })}
        </Badge>
        {pool.data?.from && (
          <span className="text-muted-foreground text-[12px]">
            {new Date(pool.data.from).toLocaleDateString()} –{' '}
            {new Date(pool.data.to!).toLocaleDateString()}
          </span>
        )}
        {pool.data?.truncated && <Badge variant="outline">{t('scouting.limited')}</Badge>}
        <Label className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
          {t('scouting.sort')}
          <Select
            value={sort}
            onValueChange={(v) => {
              setSort(v);
              setCursor(null);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['games', 'win_rate', 'kda', 'cs_per_min', 'damage_share'].map((v) => (
                <SelectItem value={v} key={v}>
                  {t(`scouting.${v}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>
      </div>
      {!!pool.data?.items.length && (
        <Card>
          <CardContent className="pt-4 pb-3">
            <ChartBoundary fallback={t('review.chartFailed')}>
              <Suspense fallback={t('common.loading')}>
                <ChampionGamesChart rows={pool.data.items} />
              </Suspense>
            </ChartBoundary>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-0">
          {pool.isPending ? (
            <div className="p-5 text-sm text-muted-foreground">{t('common.loading')}</div>
          ) : !pool.data?.items.length ? (
            <div className="p-5 text-sm text-muted-foreground">{t('scouting.empty')}</div>
          ) : (
            <Table className="tabular-nums [&_td]:px-4 [&_td]:py-4 [&_th]:px-4">
              <TableHeader className="bg-muted/40">
                <TableRow>
                  {[
                    'champion',
                    'games',
                    'win_rate',
                    'combat',
                    'kda',
                    'cs_per_min',
                    'damage_share',
                    'trend',
                  ].map((k) => (
                    <TableHead
                      key={k}
                      className={k === 'champion' || k === 'trend' ? '' : 'text-right'}
                    >
                      {k === 'combat'
                        ? `${t('scouting.kills')} / ${t('scouting.deaths')} / ${t('scouting.assists')}`
                        : t(`scouting.${k}`)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pool.data.items.map((row) => (
                  <TableRow key={row.championId ?? 'unknown'}>
                    <TableCell className="min-w-40">
                      <div className="flex items-center gap-3">
                        <GameEntityIcon
                          kind="champion"
                          id={row.championId}
                          label={championName(t, row.championId)}
                          className="size-12 rounded-lg"
                        />
                        <div className="grid justify-items-start gap-1">
                          <Button
                            variant="link"
                            className="h-auto p-0 font-semibold text-foreground"
                            disabled={!row.championId}
                            onClick={() =>
                              void navigate({
                                to: '/matches',
                                search: { ...search, player, champion: row.championId! },
                              })
                            }
                          >
                            {championName(t, row.championId)}
                          </Button>
                          <Button
                            variant="link"
                            className="h-auto p-0 text-xs text-muted-foreground"
                            disabled={!row.championId}
                            onClick={() =>
                              void navigate({
                                to: '/notebooks',
                                search: { champion: row.championId! },
                              })
                            }
                          >
                            {t('notebooks.titlePage')}
                          </Button>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{row.games}</TableCell>
                    <TableCell className="text-right">
                      <MetricValue metric={row.winRate} ratio />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2 whitespace-nowrap">
                        <MetricValue metric={row.kills} />
                        <span className="text-muted-foreground">/</span>
                        <MetricValue metric={row.deaths} />
                        <span className="text-muted-foreground">/</span>
                        <MetricValue metric={row.assists} />
                      </div>
                    </TableCell>
                    {[row.kda, row.csPerMin, row.damageShare].map((metric, index) => (
                      <TableCell key={index} className="text-right">
                        <MetricValue metric={metric} ratio={index === 2} />
                      </TableCell>
                    ))}
                    <TableCell>
                      <div className="min-w-40 max-w-[260px] grid gap-2 [&_[data-ui~=actions]]:gap-1">
                        {[...new Set(row.trend.map((p) => p.group))].map((group) => (
                          <div key={group}>
                            <small>{groupName(t, group)}</small>
                            <div data-ui="actions" className="flex flex-wrap items-center gap-1">
                              {row.trend
                                .filter((p) => p.group === group)
                                .map((p) => (
                                  <Badge
                                    key={p.matchKey}
                                    variant="outline"
                                    className={`${matchOutcomeClasses[p.outcome]} border-transparent bg-(--row-bg) text-(--outcome)`}
                                  >
                                    {t(`matches.${p.outcome}`)}
                                  </Badge>
                                ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <div data-ui="actions" className="flex items-center gap-2">
        <Button variant="outline" disabled={!cursor} onClick={() => setCursor(null)}>
          {t('matches.first')}
        </Button>
        <Button
          variant="outline"
          disabled={!pool.data?.nextCursor}
          onClick={() => setCursor(pool.data!.nextCursor)}
        >
          {t('matches.next')}
        </Button>
      </div>
    </div>
  );
}
