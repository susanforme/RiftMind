import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowUpRight, BookOpen, Check, X, CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Search } from '../../app/router';
import type { ChampionSkin } from '../../generated/contracts';
import { GameEntityIcon, portraitCatalogueVersion } from '../../components/GameEntityIcon';
import { ChampionArtwork } from '../../components/ChampionArtwork';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Skeleton } from '../../components/ui/skeleton';
import { championName, positionName, queueName } from '../../lib/display-names';
import { matchOutcomeClasses } from '../../lib/match-outcome';
import { MetricValue } from '../analysis/MetricValue';
import { ChampionTableSkeleton } from './ChampionPoolSkeleton';
import { useChampionPool } from './champion-pool';

export function ChampionDetailPage({
  playerKey,
  workspaceEpoch,
  search,
  skin,
}: {
  playerKey: string | undefined;
  workspaceEpoch: string | undefined;
  search: Search;
  skin: ChampionSkin | undefined;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const pool = useChampionPool(playerKey, workspaceEpoch, search, 'games', null, 1);
  const champion = pool.data?.items[0];
  const metrics = [
    { name: 'win_rate', metric: champion?.winRate, ratio: true },
    { name: 'kda', metric: champion?.kda, ratio: false },
    { name: 'cs_per_min', metric: champion?.csPerMin, ratio: false },
    { name: 'damage_share', metric: champion?.damageShare, ratio: true },
  ];
  const dateFormatter = new Intl.DateTimeFormat(i18n.language, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <div
      data-ui="page champion-detail-page"
      className="mx-auto grid w-full max-w-[1600px] min-w-0 gap-4 p-4 md:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          onClick={() => {
            void navigate({ to: '/champions', search: { ...search, champion: undefined } });
          }}
        >
          <ArrowLeft aria-hidden="true" />
          {t('scouting.backToPool')}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            void navigate({ to: '/notebooks', search: { champion: search.champion } });
          }}
        >
          <BookOpen aria-hidden="true" />
          {t('notebooks.titlePage')}
        </Button>
      </div>
      <Card className="relative min-h-52 overflow-hidden p-6" data-ui="champion-detail-banner">
        <ChampionArtwork skin={skin} version={portraitCatalogueVersion} banner />
        <div className="relative flex min-h-40 flex-wrap items-center gap-6">
          <GameEntityIcon
            kind="champion"
            id={search.champion}
            label={championName(t, search.champion)}
            className="size-20 rounded-full border-2 border-primary/60"
          />
          <div className="grid min-w-0 gap-4">
            <h1>{championName(t, search.champion)}</h1>
            <dl className="flex flex-wrap gap-6 tabular-nums">
              <div>
                <dt className="text-xs text-muted-foreground">{t('scouting.games')}</dt>
                <dd className="m-0 text-2xl font-semibold">
                  {pool.isPending ? (
                    <Skeleton className="mt-1 h-7 w-12" />
                  ) : (
                    (champion?.games ?? '—')
                  )}
                </dd>
              </div>
              {metrics.map(({ name, metric, ratio }) => (
                <div key={name}>
                  <dt className="text-xs text-muted-foreground">{t(`scouting.${name}`)}</dt>
                  <dd className="m-0 text-2xl font-semibold">
                    {pool.isPending ? (
                      <Skeleton className="mt-1 h-7 w-16" />
                    ) : metric ? (
                      <MetricValue metric={metric} ratio={ratio} showSamples={false} />
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Card>
      <ErrorNotice error={pool.error} />
      <Card className="grid grid-cols-1 gap-3 py-4" aria-busy={pool.isFetching}>
        <CardHeader className="px-4 py-0">
          <CardTitle>{t('scouting.recentChampionMatches')}</CardTitle>
        </CardHeader>
        <CardContent className="h-[min(65vh,600px)] min-h-[360px] overflow-auto px-0">
          {pool.isPending ? (
            <ChampionTableSkeleton />
          ) : champion?.trend.length ? (
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>{t('scouting.result')}</TableHead>
                  <TableHead>{t('matches.queue')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('scouting.position')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('scouting.patch')}</TableHead>
                  <TableHead>{t('scouting.playedAt')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('review.title')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {champion.trend.map((match) => {
                  const [queue, position, patch] = match.group.split(':');
                  const OutcomeIcon =
                    match.outcome === 'win' ? Check : match.outcome === 'loss' ? X : CircleHelp;
                  return (
                    <TableRow key={match.matchKey} className="h-16">
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`${matchOutcomeClasses[match.outcome]} gap-1 border-transparent bg-(--row-bg) text-(--outcome)`}
                        >
                          <OutcomeIcon aria-hidden="true" className="size-3" />
                          {t(`matches.${match.outcome}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>{queueName(t, queue)}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {positionName(t, position)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{patch}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {dateFormatter.format(new Date(match.startedAt))}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('review.title')}
                          onClick={() => {
                            void navigate({
                              to: '/matches/$matchKey/review',
                              params: { matchKey: match.matchKey },
                              search: { player: playerKey },
                            });
                          }}
                        >
                          <ArrowUpRight aria-hidden="true" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="flex min-h-[472px] items-center justify-center text-sm text-muted-foreground">
              {t('scouting.empty')}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
