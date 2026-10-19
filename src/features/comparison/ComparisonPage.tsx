import { GameEntityIcon, skillResourceId } from '../../components/GameEntityIcon';
import { codeName, queueName, matchName, championName, skillName } from '../../lib/display-names';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { compareRoute, type Search } from '../../app/router';
import { transport } from '../../app/runtime';
import { queryClient } from '../../app/query-client';
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
import { ChartBoundary } from '../review/ChartBoundary';
import { matchTime, numberText } from '../review/format';
import type { ReviewData } from '../../generated/contracts';
const ReviewChart = lazy(() => import('../review/ReviewChart'));
export function ComparisonPage() {
  const { t } = useTranslation();
  const search = compareRoute.useSearch();
  const navigate = useNavigate();
  const [metric, setMetric] = useState<'gold' | 'cs'>('gold');
  const app = useQuery({ queryKey: ['app'], queryFn: () => transport.call('get_app_state', {}) });
  const epoch = app.data?.workspaceEpoch;
  const leftPlayer = search.leftPlayer || search.player;
  const rightPlayer = search.rightPlayer || search.player;
  const comparison = useQuery({
    queryKey: ['comparison', epoch, search],
    queryFn: () =>
      transport.call('compare_matches', {
        left: {
          matchKey: search.left!,
          playerKey: leftPlayer!,
          inputRevision: search.leftRevision ?? null,
          reportId: search.leftReport || null,
        },
        right: {
          matchKey: search.right!,
          playerKey: rightPlayer!,
          inputRevision: search.rightRevision ?? null,
          reportId: search.rightReport || null,
        },
      }),
    enabled: !!epoch && !!search.left && !!search.right && !!leftPlayer && !!rightPlayer,
    staleTime: Infinity,
  });
  const data = comparison.data;
  useEffect(() => {
    if (
      !data ||
      (search.leftReport &&
        search.rightReport &&
        search.leftRevision != null &&
        search.rightRevision != null)
    )
      return;
    void navigate({
      to: '/compare',
      replace: true,
      search: {
        ...search,
        leftPlayer,
        rightPlayer,
        leftRevision: data.left.input?.revision ?? 0,
        rightRevision: data.right.input?.revision ?? 0,
        leftReport: data.left.report?.id || 'none',
        rightReport: data.right.report?.id || 'none',
      },
    });
  }, [data, search, navigate, leftPlayer, rightPlayer]);
  const leftChart = useQuery({
    queryKey: ['compare-chart', epoch, 'left', search.left, leftPlayer, data?.left.input?.revision],
    queryFn: () =>
      transport.call('get_match_metrics', {
        matchKey: search.left!,
        playerKey: leftPlayer!,
        inputRevision: data!.left.input!.revision,
        fromMs: 0,
        toMs: data!.left.input!.context.durationMs,
        maxPoints: 300,
      }),
    enabled: !!data?.left.input,
  });
  const rightChart = useQuery({
    queryKey: [
      'compare-chart',
      epoch,
      'right',
      search.right,
      rightPlayer,
      data?.right.input?.revision,
    ],
    queryFn: () =>
      transport.call('get_match_metrics', {
        matchKey: search.right!,
        playerKey: rightPlayer!,
        inputRevision: data!.right.input!.revision,
        fromMs: 0,
        toMs: data!.right.input!.context.durationMs,
        maxPoints: 300,
      }),
    enabled: !!data?.right.input,
  });
  function swap() {
    void navigate({
      to: '/compare',
      search: {
        ...search,
        left: search.right,
        right: search.left,
        leftPlayer: rightPlayer,
        rightPlayer: leftPlayer,
        leftRevision: search.rightRevision,
        rightRevision: search.leftRevision,
        leftReport: search.rightReport,
        rightReport: search.leftReport,
      },
    });
  }
  function replace(side: 'left' | 'right', key: string) {
    const next: Search = {
      ...search,
      [side]: key,
      [`${side}Revision`]: undefined,
      [`${side}Report`]: undefined,
    };
    void navigate({ to: '/compare', search: next });
  }
  return (
    <div className="page compare-page">
      <div className="page-heading">
        <h1>{t('scouting.compare')}</h1>
        <Button variant="outline" onClick={swap} disabled={!data}>
          {t('scouting.swap')}
        </Button>
      </div>
      <ErrorNotice error={comparison.error || leftChart.error || rightChart.error} />
      {!search.left || !search.right ? (
        <Card>
          <CardContent>
            <Button
              variant="link"
              onClick={() => void navigate({ to: '/matches', search: { player: search.player } })}
            >
              {t('scouting.selectTwo')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        data && (
          <>
            <div className="actions">
              {data.differences.map((d) => (
                <Badge variant="outline" key={d}>
                  {t(`scouting.different_${d}`)}
                </Badge>
              ))}
            </div>
            <div className="compare-sides">
              {(['left', 'right'] as const).map((side) => (
                <CompareSide
                  key={`${side}:${data[side].summary.matchKey}`}
                  data={data[side]}
                  side={side}
                  epoch={epoch!}
                  other={data[side === 'left' ? 'right' : 'left'].summary.matchKey}
                  onReplace={(key) => replace(side, key)}
                />
              ))}
            </div>
            <Card>
              <CardHeader>
                <CardTitle>{t('scouting.metrics')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="compare-values">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {['metric', 'left', 'right', 'delta'].map((k) => (
                          <TableHead key={k}>{t(`scouting.${k}`)}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.metrics.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell>
                            {t(`review.metric_${m.id}`, {
                              defaultValue: t('labels.unknownMetric'),
                            })}
                          </TableCell>
                          <TableCell>
                            {numberText(m.left, m.id === 'kda' ? undefined : m.unit)}
                          </TableCell>
                          <TableCell>
                            {numberText(m.right, m.id === 'kda' ? undefined : m.unit)}
                          </TableCell>
                          <TableCell title={m.reason ? t(`scouting.${m.reason}`) : undefined}>
                            {numberText(m.delta, m.id === 'kda' ? undefined : m.unit)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('scouting.elapsed')}</CardTitle>
                <div className="actions">
                  {(['gold', 'cs'] as const).map((m) => (
                    <Button
                      key={m}
                      size="sm"
                      variant={metric === m ? 'default' : 'outline'}
                      onClick={() => setMetric(m)}
                    >
                      {t(`review.${m === 'gold' ? 'gold' : 'cs'}`)}
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                {(leftChart.data || rightChart.data) && (
                  <ChartBoundary fallback={t('review.chartFailed')}>
                    <Suspense fallback={t('common.loading')}>
                      <ReviewChart
                        data={leftChart.data || { points: [], limitations: [] }}
                        comparison={rightChart.data || { points: [], limitations: [] }}
                        maxTime={data.durationMs}
                        metric={metric}
                        onSelect={() => {}}
                      />
                    </Suspense>
                  </ChartBoundary>
                )}
                <div className="compare-values">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('scouting.elapsed')}</TableHead>
                        <TableHead>{t('scouting.left')}</TableHead>
                        <TableHead>{t('scouting.right')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[
                        ...new Set(
                          [
                            ...(leftChart.data?.points || []),
                            ...(rightChart.data?.points || []),
                          ].map((p) => p.timestampMs),
                        ),
                      ]
                        .sort((a, b) => a - b)
                        .map((ms) => (
                          <TableRow key={ms}>
                            <TableCell>{matchTime(ms)}</TableCell>
                            <TableCell>
                              {numberText(
                                leftChart.data?.points.find((p) => p.timestampMs === ms)?.[metric],
                              )}
                            </TableCell>
                            <TableCell>
                              {numberText(
                                rightChart.data?.points.find((p) => p.timestampMs === ms)?.[metric],
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )
      )}
    </div>
  );
}
function CompareSide({
  data,
  side,
  epoch,
  other,
  onReplace,
}: {
  data: ReviewData;
  side: 'left' | 'right';
  epoch: string;
  other: string;
  onReplace: (key: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [showEvents, setShowEvents] = useState(false);
  const [kind, setKind] = useState('all');
  const [cursor, setCursor] = useState<number | null>(null);
  const [matchCursor, setMatchCursor] = useState<string | null>(null);
  const m = data.summary;
  const i = data.input;
  const candidates = useQuery({
    queryKey: ['compare-candidates', epoch, m.playerKey, matchCursor],
    queryFn: () =>
      transport.call('list_matches', {
        playerKey: m.playerKey,
        queueId: null,
        championId: null,
        from: null,
        to: null,
        cursor: matchCursor,
        pageSize: 50,
      }),
  });
  const events = useQuery({
    queryKey: ['compare-events', epoch, m.matchKey, m.playerKey, i?.revision, kind, cursor],
    queryFn: () =>
      transport.call('get_timeline_slice', {
        matchKey: m.matchKey,
        playerKey: m.playerKey,
        inputRevision: i!.revision,
        fromMs: 0,
        toMs: i!.context.durationMs,
        kinds:
          kind === 'all'
            ? []
            : kind === 'items'
              ? ['ITEM_PURCHASED', 'ITEM_SOLD', 'ITEM_UNDO']
              : kind === 'skills'
                ? ['SKILL_LEVEL_UP']
                : ['ELITE_MONSTER_KILL', 'BUILDING_KILL'],
        cursor,
        limit: 30,
      }),
    enabled: !!i && showEvents,
  });
  const itemIds = [
    ...new Set([
      ...(m.items || []),
      ...(events.data?.events.flatMap((e) => (e.itemId ? [e.itemId] : [])) || []),
    ]),
  ];
  const assets = useQuery({
    queryKey: ['compare-assets', m.version, i18n.language, itemIds],
    queryFn: () =>
      transport.call('resolve_assets', {
        version: m.version,
        locale: i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US',
        championIds: m.championId ? [m.championId] : [],
        resourceIds: itemIds.map((id) => ({ kind: 'item' as const, id })),
      }),
    enabled: m.version !== 'unknown',
    staleTime: Infinity,
    retry: false,
  });
  const connection = useQuery({
    queryKey: ['connection'],
    queryFn: () => transport.call('get_connection_state', {}),
  });
  const fetch = useMutation({
    mutationFn: () =>
      transport.call('fetch_match_details', { matchKey: m.matchKey, playerKey: m.playerKey }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['review-data'] }),
  });
  function open(evidence?: string, at?: number) {
    void navigate({
      to: '/matches/$matchKey/review',
      params: { matchKey: m.matchKey },
      search: { player: m.playerKey, report: data.report?.id, evidence, at },
    });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="actions">
          <GameEntityIcon
            kind="champion"
            id={m.championId}
            version={m.version}
            label={championName(t, m.championId)}
          />
          {t(`scouting.${side}`)} · {matchName(t, m.matchKey)}
        </CardTitle>
        <div className="meta-line">
          {t(`matches.${m.outcome}`)} · {m.kills ?? '—'}/{m.deaths ?? '—'}/{m.assists ?? '—'} ·{' '}
          {matchTime((m.duration || 0) * 1000)} · {m.version} · {queueName(t, m.queueId)} ·{' '}
          {assets.data?.find((a) => a.resourceId === `champion:${m.championId}`)?.name ||
            championName(t, m.championId)}
        </div>
        <span className="help">
          {t('scouting.fixedRevision')}: {i?.revision ?? '—'} /{' '}
          {data.report ? t('labels.reportRevision', { n: data.report.revision }) : '—'}
        </span>
      </CardHeader>
      <CardContent className="review-stack">
        <ErrorNotice error={events.error || fetch.error || candidates.error} />
        <div className="actions">
          <Button variant="outline" onClick={() => open()}>
            {t('review.open')}
          </Button>
          <Button
            variant="outline"
            disabled={
              m.playerKey !== connection.data?.player?.playerKey ||
              connection.data?.phase !== 'connected' ||
              fetch.isPending
            }
            onClick={() => fetch.mutate()}
          >
            {t('review.fetch')}
          </Button>
          {fetch.isSuccess && (
            <Button variant="link" onClick={() => open()}>
              {t('review.newData')}
            </Button>
          )}
        </div>
        <Label>
          {t('scouting.replace')}
          <Select value="" onValueChange={onReplace}>
            <SelectTrigger>
              <SelectValue placeholder={t('scouting.replace')} />
            </SelectTrigger>
            <SelectContent>
              {candidates.data?.items
                .filter((c) => c.matchKey !== m.matchKey && c.matchKey !== other)
                .map((c) => (
                  <SelectItem key={c.matchKey} value={c.matchKey}>
                    {matchName(t, c.matchKey)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Label>
        {candidates.data?.nextCursor && (
          <Button variant="outline" onClick={() => setMatchCursor(candidates.data!.nextCursor)}>
            {t('matches.next')}
          </Button>
        )}
        <Button
          variant="outline"
          aria-expanded={showEvents}
          onClick={() => setShowEvents((v) => !v)}
        >
          {t('scouting.events')}
        </Button>
        {showEvents && (
          <div className="compare-events">
            <Label>
              {t('scouting.events')}
              <Select
                value={kind}
                onValueChange={(v) => {
                  setKind(v);
                  setCursor(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['all', 'items', 'skills', 'objectives'].map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`scouting.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
            {!events.data?.events.length && <span className="help">{t('scouting.noEvents')}</span>}
            {events.data?.events.map((e) => (
              <div className="actions" key={e.id}>
                <Button
                  variant="link"
                  onClick={() =>
                    open(data.report?.evidence.find((r) => r.id === e.id)?.id, e.timestampMs)
                  }
                >
                  {matchTime(e.timestampMs)}
                </Button>
                <span>
                  {t(`review.event_${e.kind}`, { defaultValue: t('labels.unknownEvent') })}
                </span>
                {e.itemId && (
                  <span className="inline-entity">
                    <GameEntityIcon
                      kind="item"
                      id={e.itemId}
                      version={m.version}
                      label={
                        assets.data?.find((asset) => asset.resourceId === `item:${e.itemId}`)
                          ?.name || t('labels.item', { id: e.itemId })
                      }
                    />
                    {assets.data?.find((asset) => asset.resourceId === `item:${e.itemId}`)?.name ||
                      t('labels.item', { id: e.itemId })}
                  </span>
                )}
                {e.skillSlot && (
                  <span className="inline-entity">
                    <GameEntityIcon
                      kind="skill"
                      id={skillResourceId(
                        i?.context.participants.find(
                          (participant) => participant.id === e.participantId,
                        )?.championId,
                        e.skillSlot,
                      )}
                      version={m.version}
                      label={skillName(t, e.skillSlot)}
                    />
                    {skillName(t, e.skillSlot)}
                  </span>
                )}
                {e.monster && <span>{codeName(t, 'monster', e.monster)}</span>}
              </div>
            ))}
            {events.data?.nextCursor != null && (
              <Button variant="outline" onClick={() => setCursor(events.data!.nextCursor)}>
                {t('matches.next')}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
