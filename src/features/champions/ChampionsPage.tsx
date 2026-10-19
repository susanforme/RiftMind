import { GameEntityIcon } from '../../components/GameEntityIcon';
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
      className="max-w-[1400px] pt-[30px] px-9 pb-[26px] m-auto max-[1150.01px]:p-[26px] max-[900.01px]:p-[22px] max-[650.01px]:py-[18px] max-[650.01px]:px-4 grid gap-5"
    >
      <div
        data-ui="page-heading"
        className="flex items-center justify-between gap-6 mb-7 max-[650.01px]:mb-[22px] max-[650.01px]:gap-2.5"
      >
        <h1>{t('scouting.champions')}</h1>
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
      <div data-ui="actions" className="flex items-center gap-2">
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
        <Label>
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
          <CardContent className="pt-5">
            <ChartBoundary fallback={t('review.chartFailed')}>
              <Suspense fallback={t('common.loading')}>
                <ChampionGamesChart rows={pool.data.items} />
              </Suspense>
            </ChartBoundary>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent>
          {pool.isPending ? (
            t('common.loading')
          ) : !pool.data?.items.length ? (
            t('scouting.empty')
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    'champion',
                    'games',
                    'win_rate',
                    'kills',
                    'deaths',
                    'assists',
                    'kda',
                    'cs_per_min',
                    'damage_share',
                    'trend',
                  ].map((k) => (
                    <TableHead key={k}>{t(`scouting.${k}`)}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pool.data.items.map((row) => (
                  <TableRow key={row.championId ?? 'unknown'}>
                    <TableCell>
                      <Button
                        variant="link"
                        disabled={!row.championId}
                        onClick={() =>
                          void navigate({
                            to: '/matches',
                            search: { ...search, player, champion: row.championId! },
                          })
                        }
                      >
                        <GameEntityIcon
                          kind="champion"
                          id={row.championId}
                          label={championName(t, row.championId)}
                        />
                        {championName(t, row.championId)}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={!row.championId}
                        onClick={() =>
                          void navigate({ to: '/notebooks', search: { champion: row.championId! } })
                        }
                      >
                        {t('notebooks.titlePage')}
                      </Button>
                    </TableCell>
                    <TableCell>{row.games}</TableCell>
                    {[
                      row.winRate,
                      row.kills,
                      row.deaths,
                      row.assists,
                      row.kda,
                      row.csPerMin,
                      row.damageShare,
                    ].map((m, i) => (
                      <TableCell key={i}>
                        <MetricValue metric={m} ratio={i === 0 || i === 6} />
                      </TableCell>
                    ))}
                    <TableCell>
                      <div className="min-w-40 max-w-[260px] grid gap-2 [&_[data-ui~=actions]]:gap-1">
                        {[...new Set(row.trend.map((p) => p.group))].map((group) => (
                          <div key={group}>
                            <small>{groupName(t, group)}</small>
                            <div data-ui="actions" className="flex items-center gap-2">
                              {row.trend
                                .filter((p) => p.group === group)
                                .map((p) => (
                                  <Badge key={p.matchKey} variant="outline">
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
