import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { transport } from '../../app/runtime';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import {
  Table,
  TableBody,
  TableRow,
  TableCell,
  TableHead,
  TableHeader,
} from '../../components/ui/table';
import { GameEntityIcon, skillResourceId } from '../../components/GameEntityIcon';
import { ErrorNotice } from '../../components/ErrorNotice';
import { championName, codeName } from '../../lib/display-names';
import { matchTime, numberText } from './format';
import { ChartBoundary } from './ChartBoundary';
const ReviewChart = lazy(() => import('./ReviewChart'));
export function ReviewEventContext({
  reportId,
  epoch,
  at,
  evidenceId,
  onSelect,
}: {
  reportId: string;
  epoch: string;
  at?: number;
  evidenceId?: string;
  onSelect: (ms: number, evidence?: string) => void;
}) {
  const { t } = useTranslation();
  const [category, setCategory] = useState(evidenceId?.startsWith('event-') ? 'all' : 'death');
  const [eventId, setEventId] = useState<string | null>(
    evidenceId?.startsWith('event-') ? evidenceId : null,
  );
  const [radius, setRadius] = useState(60);
  const [metric, setMetric] = useState<'gold' | 'cs'>('gold');
  const context = useQuery({
    queryKey: ['event-context', epoch, reportId, eventId, at, category, radius],
    queryFn: () =>
      transport.call('get_review_event_context', {
        reportId,
        eventId,
        atMs: eventId ? null : (at ?? null),
        radiusMs: radius * 1000,
        category,
      }),
    retry: false,
  });
  const snapshot = context.data;
  const participant = (id: number | null) => {
    const participant = snapshot?.participants.find((participant) => participant.id === id);
    return participant ? (
      <span className="inline-flex items-center gap-1.5 me-2.5 align-middle [&_[data-slot='avatar']]:w-6 [&_[data-slot='avatar']]:h-6">
        <GameEntityIcon
          kind="champion"
          id={participant.championId}
          label={championName(t, participant.championId)}
        />
        {championName(t, participant.championId)}
      </span>
    ) : (
      t('labels.unknownPlayer')
    );
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('training.eventContext')}</CardTitle>
      </CardHeader>
      <CardContent data-ui="review-stack" className="grid grid-cols-1 gap-4 min-w-0">
        <div data-ui="actions" className="flex items-center gap-2">
          {['all', 'death', 'objective'].map((kind) => (
            <Button
              key={kind}
              variant={category === kind ? 'default' : 'outline'}
              aria-pressed={category === kind}
              onClick={() => {
                setCategory(kind);
                setEventId(null);
              }}
            >
              {t(`training.events_${kind}`)}
            </Button>
          ))}
          <Label>
            {t('training.windowSeconds')}
            <Input
              type="number"
              min={1}
              max={600}
              aria-label={t('training.windowSeconds')}
              value={radius}
              onChange={(event) =>
                setRadius(Math.min(600, Math.max(1, Number(event.target.value) || 60)))
              }
            />
          </Label>
          <Button
            variant="outline"
            disabled={!snapshot?.previousId}
            onClick={() => {
              setEventId(snapshot!.previousId);
            }}
          >
            {t('training.previousEvent')}
          </Button>
          <Button
            variant="outline"
            disabled={!snapshot?.nextId}
            onClick={() => {
              setEventId(snapshot!.nextId);
            }}
          >
            {t('training.nextEvent')}
          </Button>
        </div>
        <ErrorNotice error={context.error} />
        {snapshot && (
          <>
            <p>
              {matchTime(snapshot.fromMs)} – {matchTime(snapshot.toMs)}
            </p>
            {!snapshot.focus && <p>{t('training.noEvents')}</p>}
            {snapshot.focus && (
              <div data-ui="actions" className="flex items-center gap-2">
                <strong>{matchTime(snapshot.focus.timestampMs)}</strong>
                <Badge>
                  {t(`review.event_${snapshot.focus.kind}`, {
                    defaultValue: t('labels.unknownEvent'),
                  })}
                </Badge>
                {snapshot.focus.monster && (
                  <span>{codeName(t, 'monster', snapshot.focus.monster)}</span>
                )}
                {snapshot.focus.victimId && participant(snapshot.focus.victimId)}
                {snapshot.focus.killerId && participant(snapshot.focus.killerId)}
                {snapshot.focus.assistingIds.map((id) => (
                  <span key={id}>{participant(id)}</span>
                ))}
                {snapshot.enemyJunglerIds.length > 0 && (
                  <Badge variant="outline">{t('training.junglerInvolved')}</Badge>
                )}
                <Button
                  variant="outline"
                  onClick={() =>
                    onSelect(
                      snapshot.focus!.timestampMs,
                      snapshot.evidenceIds.includes(snapshot.focus!.id)
                        ? snapshot.focus!.id
                        : undefined,
                    )
                  }
                >
                  {t('review.locate')}
                </Button>
              </div>
            )}
            <div data-ui="actions" className="flex items-center gap-2">
              {(['gold', 'cs'] as const).map((kind) => (
                <Button
                  key={kind}
                  variant={metric === kind ? 'default' : 'outline'}
                  onClick={() => setMetric(kind)}
                >
                  {t(`review.${kind}`)}
                </Button>
              ))}
            </div>
            <ChartBoundary fallback={t('training.eventChartFailed')}>
              <Suspense fallback={null}>
                <ReviewChart
                  data={snapshot.chart}
                  label={t(`training.contextChart_${metric}`)}
                  failureLabel={t('training.eventChartFailed')}
                  metric={metric}
                  maxTime={snapshot.toMs}
                  minTime={snapshot.fromMs}
                  highlight={[snapshot.fromMs, snapshot.toMs]}
                  onSelect={(timestamp) => onSelect(timestamp)}
                />
              </Suspense>
            </ChartBoundary>
            <details>
              <summary>{t('training.numericTable')}</summary>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('review.time')}</TableHead>
                    <TableHead>{t('review.gold')}</TableHead>
                    <TableHead>{t('review.cs')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.chart.points.map((point) => (
                    <TableRow key={point.timestampMs}>
                      <TableCell>{matchTime(point.timestampMs)}</TableCell>
                      <TableCell>{numberText(point.gold)}</TableCell>
                      <TableCell>{numberText(point.cs)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </details>
            {Object.entries(snapshot.capabilities)
              .filter(([, capability]) => capability?.status !== 'ready')
              .map(([kind, capability]) => (
                <p className="text-muted-foreground text-[12px]" key={kind}>
                  {t('training.missingRange', {
                    kind,
                    from: capability?.fromMs == null ? '—' : matchTime(capability?.fromMs),
                    to: capability?.toMs == null ? '—' : matchTime(capability?.toMs),
                  })}
                </p>
              ))}
            <div className="max-h-[340px] overflow-auto">
              {snapshot.events.map((event) => (
                <div
                  data-selected={event.id === snapshot.focus?.id}
                  className="flex flex-wrap gap-y-2 gap-x-4 items-center text-[12px] py-2 px-0 border-b border-b-border last:border-b-0 [&_[data-slot=button]]:justify-start [&_[data-slot=button]]:text-primary [&_[data-slot=button]]:py-0 [&_[data-slot=button]]:px-1 [&_[data-slot=button]]:text-[12px] [&_>_span]:text-muted-foreground data-[selected=true]:bg-accent data-[selected=true]:rounded-[var(--radius)]"
                  key={event.id}
                >
                  <Button
                    variant="link"
                    onClick={() =>
                      onSelect(
                        event.timestampMs,
                        snapshot.evidenceIds.find((id) => id === event.id),
                      )
                    }
                  >
                    {matchTime(event.timestampMs)} ·{' '}
                    {t(`review.event_${event.kind}`, { defaultValue: t('labels.unknownEvent') })}
                  </Button>
                  {event.victimId && participant(event.victimId)}
                  {event.killerId && participant(event.killerId)}
                  {event.itemId && (
                    <GameEntityIcon
                      kind="item"
                      id={event.itemId}
                      label={t('notebooks.equipment', { id: event.itemId })}
                    />
                  )}{' '}
                  {event.skillSlot && (
                    <GameEntityIcon
                      kind="skill"
                      id={skillResourceId(
                        snapshot.participants.find(
                          (participant) => participant.id === event.participantId,
                        )?.championId,
                        event.skillSlot,
                      )}
                      label={['Q', 'W', 'E', 'R'][event.skillSlot - 1] || t('notebooks.skill')}
                    />
                  )}{' '}
                  {event.undoOf && <Badge variant="outline">{t('training.undo')}</Badge>}
                </div>
              ))}
            </div>
            <div data-ui="actions" className="flex items-center gap-2">
              {snapshot.evidenceIds.map((id) => (
                <Button
                  variant="outline"
                  key={id}
                  onClick={() => onSelect(snapshot.focus?.timestampMs || snapshot.fromMs, id)}
                >
                  {t('review.evidence')} · {id}
                </Button>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
