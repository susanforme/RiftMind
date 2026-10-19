import { ChevronRight } from 'lucide-react';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '../../components/ui/collapsible';
import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { transport } from '../../app/runtime';
import { queryClient } from '../../app/query-client';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import {
  Table,
  TableBody,
  TableRow,
  TableCell,
  TableHead,
  TableHeader,
} from '../../components/ui/table';
import { ErrorNotice } from '../../components/ErrorNotice';
import { numberText } from '../review/format';
import { ChartBoundary } from '../review/ChartBoundary';
const DistributionChart = lazy(() => import('./PersonalDistributionChart'));
export function PersonalBaselinePanel({
  reportId,
  epoch,
  player,
}: {
  reportId: string;
  epoch: string;
  player: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [allChampions, setAllChampions] = useState(false);
  const baseline = useQuery({
    queryKey: ['personal-baseline', epoch, reportId, allChampions],
    queryFn: () =>
      transport.call('get_personal_baseline', {
        reportId,
        workspaceEpoch: epoch,
        allChampions,
        refresh: false,
      }),
    staleTime: Infinity,
  });
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('training.personalBaseline')}</CardTitle>
      </CardHeader>
      <CardContent data-ui="review-stack" className="grid grid-cols-1 gap-4 min-w-0">
        <div data-ui="actions" className="flex flex-wrap items-center gap-2">
          <Button
            variant={allChampions ? 'outline' : 'default'}
            aria-pressed={!allChampions}
            onClick={() => setAllChampions(false)}
          >
            {t('training.sameChampion')}
          </Button>
          <Button
            variant={allChampions ? 'default' : 'outline'}
            aria-pressed={allChampions}
            onClick={() => setAllChampions(true)}
          >
            {t('training.samePosition')}
          </Button>
          <Button
            variant="outline"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true);
              setRefreshError(null);
              void transport
                .call('get_personal_baseline', {
                  reportId,
                  workspaceEpoch: epoch,
                  allChampions,
                  refresh: true,
                })
                .then((snapshot) =>
                  queryClient.setQueryData(
                    ['personal-baseline', epoch, reportId, allChampions],
                    snapshot,
                  ),
                )
                .catch(setRefreshError)
                .finally(() => setRefreshing(false));
            }}
          >
            {t('common.refresh')}
          </Button>
        </div>
        <ErrorNotice error={baseline.error || refreshError} />
        {baseline.data && (
          <>
            <p>
              {t('training.scanned', { count: baseline.data.scanned })}
              {baseline.data.truncated ? ` · ${t('training.truncated')}` : ''}
            </p>
            <div className="grid min-w-0 gap-6 xl:grid-cols-2">
              {baseline.data.metrics.map((metric) => (
                <div
                  key={metric.id}
                  data-ui="review-stack"
                  className="grid min-w-0 gap-4 rounded-lg border border-border p-4"
                >
                  <h3 className="text-sm font-semibold">
                    {t(`review.metric_${metric.id}`)} · {metric.unit} · n={metric.count}
                  </h3>
                  {metric.median === null ? (
                    <p>{t('training.minimumSamples', { count: metric.count })}</p>
                  ) : (
                    <ChartBoundary fallback={t('review.chartFailed')}>
                      <Suspense fallback={null}>
                        <DistributionChart metric={metric} />
                      </Suspense>
                    </ChartBoundary>
                  )}
                  <Table className="tabular-nums [&_td]:text-right [&_th]:text-right">
                    <TableHeader>
                      <TableRow>
                        {['current', 'median', 'q1', 'q3', 'delta'].map((key) => (
                          <TableHead key={key}>{t(`training.${key}`)}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        {[
                          metric.current,
                          metric.median,
                          metric.lowerQuartile,
                          metric.upperQuartile,
                          metric.delta,
                        ].map((value, index) => (
                          <TableCell key={index}>{numberText(value)}</TableCell>
                        ))}
                      </TableRow>
                    </TableBody>
                  </Table>
                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        className="group h-auto min-h-9 w-full justify-start gap-2 px-0 py-2 text-left text-sm font-normal whitespace-normal text-muted-foreground"
                      >
                        <ChevronRight
                          aria-hidden="true"
                          className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
                        />
                        {t('training.samples')}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent
                      forceMount
                      className="hidden min-w-0 pb-2 data-[state=open]:block"
                    >
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t('review.match')}</TableHead>
                            <TableHead>{t('review.current')}</TableHead>
                            <TableHead>{t('training.selection')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {metric.samples.map((sample) => (
                            <TableRow key={sample.matchKey}>
                              <TableCell>
                                <Button
                                  variant="link"
                                  disabled={!sample.reportId}
                                  onClick={() =>
                                    void navigate({
                                      to: '/matches/$matchKey/review',
                                      params: { matchKey: sample.matchKey },
                                      search: { player, report: sample.reportId || undefined },
                                    })
                                  }
                                >
                                  {sample.matchKey}
                                </Button>
                              </TableCell>
                              <TableCell>{numberText(sample.value)}</TableCell>
                              <TableCell>
                                {sample.reason
                                  ? t(`training.reason_${sample.reason}`, {
                                      defaultValue: t('training.excluded'),
                                    })
                                  : t('training.included')}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
