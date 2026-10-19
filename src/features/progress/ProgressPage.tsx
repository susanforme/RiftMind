import { ChevronRight } from 'lucide-react';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '../../components/ui/collapsible';
import { SearchSelect } from '../../components/SearchSelect';
import { MatchPreparationPanel } from '../matches/MatchPreparationPanel';
import { PracticeChecklist } from '../champion-notes/PracticeChecklist';
import { ChampionSelect } from '../../components/ChampionSelect';
import { ChartBoundary } from '../review/ChartBoundary';
import { GameEntityIcon } from '../../components/GameEntityIcon';
import {
  groupName,
  matchName,
  positionName,
  queueName,
  championName,
  playerName,
} from '../../lib/display-names';
import { serverName } from '../../lib/server-name';
import { RecurringIssuesPanel } from '../progress/RecurringIssuesPanel';
import { Label } from '../../components/ui/label';
import { lazy, Suspense, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useWorkspaceNavigate, useWorkspaceSearch } from '../../app/workspace-page-context';
import { useTranslation } from 'react-i18next';
import { progressRoute } from '../../app/router';
import { transport } from '../../app/runtime';
import { queryClient } from '../../app/query-client';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/dialog';
import { ErrorNotice } from '../../components/ErrorNotice';
import type { GoalState, TrainingGoal, GoalMember } from '../../generated/contracts';
import { numberText } from '../review/format';
const GoalTrendChart = lazy(() => import('./GoalTrendChart'));
export function ProgressPage() {
  const { t } = useTranslation();
  const search = useWorkspaceSearch(progressRoute.useSearch({ shouldThrow: false }));
  const navigate = useWorkspaceNavigate();
  const [champion, setChampion] = useState<number>();
  const [queue, setQueue] = useState('all');
  const [position, setPosition] = useState('all');
  const [patch, setPatch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cursor, setCursor] = useState<number | null>(null);
  const app = useQuery({ queryKey: ['app'], queryFn: () => transport.call('get_app_state', {}) });
  const epoch = app.data?.workspaceEpoch;
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
  const goals = useQuery({
    queryKey: ['goals', epoch, player, cursor],
    queryFn: () =>
      transport.call('list_training_goals', { playerKey: player!, state: null, cursor, limit: 50 }),
    enabled: !!player && !!epoch,
  });
  const progress = useQuery({
    queryKey: ['player-progress', epoch, player, queue, position, patch, from, to],
    queryFn: () =>
      transport.call('get_player_progress', {
        playerKey: player!,
        queueId: Number(queue) || null,
        position: position === 'all' ? null : position,
        patch: patch || null,
        from: from ? new Date(`${from}T00:00:00`).toISOString() : null,
        to: to ? new Date(`${to}T23:59:59.999`).toISOString() : null,
      }),
    enabled: !!player && !!epoch,
  });
  function open(member: { matchKey: string; reportId: string }) {
    void navigate({
      to: '/matches/$matchKey/review',
      params: { matchKey: member.matchKey },
      search: { player, report: member.reportId },
    });
  }
  const groups = [...new Set(progress.data?.points.map((p) => p.group))];
  return (
    <div
      data-ui="page"
      className="mx-auto grid w-full max-w-[1600px] min-w-0 grid-cols-1 gap-5 p-6 max-[900px]:p-4 [&_[data-ui~=actions]]:flex-wrap [&_label]:grid [&_label]:gap-1.5 [&_label]:text-xs"
    >
      <div data-ui="page-heading" className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('review.progress')}</h1>
        </div>
        <Button
          variant="outline"
          onClick={() => void navigate({ to: '/matches', search: { player } })}
        >
          {t('review.back')}
        </Button>
      </div>
      <Card>
        <CardContent className="[&_label]:grid [&_label]:gap-1.5 [&_label]:min-w-0 [&_label_>_span]:text-muted-foreground [&_label_>_span]:text-[12px] grid grid-cols-[repeat(auto-fit,_minmax(140px,_1fr))] gap-3 pt-5">
          <Label>
            <span>{t('matches.openPlayer')}</span>
            <Select
              disabled={!players.data?.length}
              value={player || ''}
              onValueChange={(value) => {
                setCursor(null);
                void navigate({ to: '/progress', search: { player: value } });
              }}
            >
              <SelectTrigger aria-label={t('matches.openPlayer')}>
                <SelectValue placeholder={t('matches.selectPlayer')} />
              </SelectTrigger>
              <SelectContent>
                {players.data?.map((p) => (
                  <SelectItem key={p.playerKey} value={p.playerKey}>
                    {playerName(t, p)} · {serverName(t, p.serverId)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <Label>
            <span>{t('matches.queue')}</span>
            <Select value={queue} onValueChange={setQueue}>
              <SelectTrigger aria-label={t('matches.queue')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('matches.allQueues')}</SelectItem>
                <SelectItem value="420">{t('matches.ranked')}</SelectItem>
                <SelectItem value="440">{t('review.flex')}</SelectItem>
              </SelectContent>
            </Select>
          </Label>
          <Label>
            <span>{t('review.position')}</span>
            <Select value={position} onValueChange={setPosition}>
              <SelectTrigger aria-label={t('review.position')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('review.allPositions')}</SelectItem>
                {['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].map((p) => (
                  <SelectItem key={p} value={p}>
                    {t(`matches.position_${p}`, { defaultValue: t('labels.unknown') })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <Label>
            <span>{t('matches.version')}</span>
            <Input
              aria-label={t('matches.version')}
              value={patch}
              onChange={(e) => setPatch(e.target.value)}
              placeholder="16.20"
            />
          </Label>
          <Label>
            <span>{t('matches.from')}</span>
            <Input
              type="date"
              aria-label={t('matches.from')}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Label>
          <Label>
            <span>{t('matches.to')}</span>
            <Input
              type="date"
              aria-label={t('matches.to')}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Label>
        </CardContent>
      </Card>
      <ErrorNotice error={goals.error || progress.error || players.error} />
      <div
        data-ui="progress-layout"
        className="grid min-w-0 items-start gap-5 min-[1280px]:grid-cols-[minmax(0,1fr)_320px]"
      >
        <div className="grid min-w-0 gap-5">
          <Card className="border-0 bg-transparent">
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 px-0 pt-0">
              <CardTitle>{t('review.goals')}</CardTitle>
              <ChampionSelect value={champion} onValueChange={setChampion} />
            </CardHeader>
            <CardContent data-ui="review-stack" className="grid grid-cols-1 gap-4 min-w-0 p-0">
              {!goals.data?.items.length && <p>{t('review.noGoals')}</p>}
              {goals.data?.items
                .filter(
                  (goal) =>
                    !champion || !goal.scope.championId || goal.scope.championId === champion,
                )
                .map((goal) => (
                  <GoalCard
                    key={`${goal.id}:${goal.revision}`}
                    goal={goal}
                    epoch={epoch}
                    open={open}
                  />
                ))}
              {!!goals.data?.items.length && (
                <div data-ui="actions" className="flex items-center gap-2">
                  {cursor != null && (
                    <Button variant="outline" onClick={() => setCursor(null)}>
                      {t('matches.first')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={goals.data?.nextCursor == null}
                    onClick={() => setCursor(goals.data!.nextCursor)}
                  >
                    {t('matches.next')}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('review.trends')}</CardTitle>
              {progress.data && (
                <CardDescription>
                  {t('review.sampleCount', {
                    count: progress.data?.points.length || 0,
                    cached: progress.data?.cachedMatches || 0,
                  })}{' '}
                  · {progress.data?.from?.slice(0, 10) || '—'} –{' '}
                  {progress.data?.to?.slice(0, 10) || '—'}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent data-ui="review-stack" className="grid grid-cols-1 gap-4 min-w-0">
              {!!groups.length && (
                <p className="text-muted-foreground text-[12px]">{t('review.comparability')}</p>
              )}
              {Object.entries(progress.data?.excluded || {}).map(([reason, count]) => (
                <p key={reason}>
                  {t(`review.reason_${reason}`, { defaultValue: t('labels.unknownReason') })}:{' '}
                  {count}
                </p>
              ))}
              {groups.map((group) => (
                <div key={group}>
                  <h3>{groupName(t, group)}</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('review.match')}</TableHead>
                        <TableHead>{t('review.metric_cs_10')}</TableHead>
                        <TableHead>{t('review.metric_deaths_per_10')}</TableHead>
                        <TableHead>{t('review.metric_cs_per_min')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {progress.data?.points
                        .filter((p) => p.group === group)
                        .map((p) => (
                          <TableRow key={p.matchKey}>
                            <TableCell>
                              <Button variant="link" onClick={() => open(p)}>
                                {p.startedAt.slice(0, 16).replace('T', ' ')} ·{' '}
                                {matchName(t, p.matchKey)}
                              </Button>
                            </TableCell>
                            {['cs_10', 'deaths_per_10', 'cs_per_min'].map((id) => (
                              <TableCell key={id} className="tabular-nums">
                                {numberText(p.metrics.find((m) => m.id === id)?.value)}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
              {!groups.length && <p>{t('review.waitingSamples')}</p>}
            </CardContent>
          </Card>
        </div>
        {epoch && <PracticeChecklist championId={champion} epoch={epoch} entries={[]} />}
      </div>
      {player && epoch && (
        <RecurringIssuesPanel key={`${epoch}:${player}`} player={player} epoch={epoch} />
      )}
    </div>
  );
}
function GoalCard({
  goal,
  epoch,
  open,
}: {
  goal: TrainingGoal;
  epoch?: string;
  open: (member: GoalMember) => void;
}) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState<GoalState | null>(null);
  const [scope, setScope] = useState(goal.scope);
  const updateScope = (patch: Partial<typeof scope>) =>
    setScope({ ...scope, ...patch, origin: undefined });
  const scopeChanged =
    scope.championId !== goal.scope.championId ||
    scope.position !== goal.scope.position ||
    scope.patch !== goal.scope.patch ||
    scope.direction !== goal.scope.direction;
  const [newTarget, setNewTarget] = useState(String(goal.scope.target));
  const [revision, setRevision] = useState<number | null>(null);
  const progress = useQuery({
    queryKey: ['goal-progress', epoch, goal.id, goal.revision, revision],
    queryFn: () => transport.call('get_goal_progress', { goalId: goal.id, revision }),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['goals'] });
    void queryClient.invalidateQueries({ queryKey: ['goal-progress'] });
  };
  const save = useMutation({
    mutationFn: (state: GoalState) =>
      transport.call('save_training_goal', {
        workspaceEpoch: epoch!,
        id: goal.id,
        expectedRevision: goal.revision,
        scope: { ...scope, target: Number(newTarget) },
        state,
      }),
    onSuccess: () => {
      setConfirm(null);
      refresh();
    },
  });
  const evaluate = useMutation({
    mutationFn: () => transport.call('evaluate_training_goal', { id: goal.id }),
    onSuccess: refresh,
  });
  const e = progress.data?.evaluation;
  const avg = progress.data?.frozenBaseline;
  return (
    <Card
      data-ui="goal-card"
      className="overflow-hidden border-border bg-card [&_[data-ui~=actions]_[data-slot=button]]:whitespace-normal [&_[data-ui~=actions]_[data-slot=button]]:h-auto [&_[data-ui~=actions]_[data-slot=button]]:min-h-8 [&_[data-ui~=actions]_[data-slot=button]]:max-w-full [&_[data-ui~=actions]_[data-slot=button]]:text-left"
    >
      <CardHeader className="flex-row items-center gap-4 border-b border-border bg-muted/30">
        {goal.scope.championId && (
          <GameEntityIcon
            kind="champion"
            id={goal.scope.championId}
            label={championName(t, goal.scope.championId)}
            className="size-14 rounded-xl border border-primary/30"
          />
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {t(`review.metric_${goal.scope.metricId}`)}
            <Badge variant="outline">{t(`review.goal_${goal.state}`)}</Badge>
          </CardTitle>
          <CardDescription>
            {goal.scope.championId && `${championName(t, goal.scope.championId)} · `}
            {queueName(t, goal.scope.queueId)} · {positionName(t, goal.scope.position)} ·{' '}
            {goal.scope.patch} · v{goal.version}
          </CardDescription>
        </div>
        <strong className="shrink-0 text-2xl font-semibold tabular-nums text-primary">
          {goal.scope.direction === 'increase' ? '≥' : '≤'} {goal.scope.target}
        </strong>
      </CardHeader>
      <CardContent data-ui="review-stack" className="grid min-w-0 grid-cols-1 gap-4 pt-5">
        <ErrorNotice error={progress.error || save.error || evaluate.error} />
        <div
          data-ui="goal-summary"
          className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-muted/20 p-4 lg:grid-cols-4"
        >
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">
              {t('review.baseline')} ({goal.baseline.length}/10)
            </span>
            <strong className="block text-2xl font-semibold tabular-nums">{numberText(avg)}</strong>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">
              {t('review.current')} ({e?.members.length || 0}/10)
            </span>
            <strong className="block text-2xl font-semibold tabular-nums">
              {numberText(e?.current)}
            </strong>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Δ</span>
            <strong className="block text-2xl font-semibold tabular-nums">
              {numberText(e?.delta)}
            </strong>
          </div>
          <p className="self-center text-sm font-medium" role="status">
            {e?.achieved == null
              ? t('review.waitingSamples')
              : t(e.achieved ? 'review.achieved' : 'review.notAchieved')}
          </p>
        </div>
        <ChartBoundary fallback={t('review.chartFailed')}>
          <Suspense fallback={null}>
            <GoalTrendChart goal={goal} evaluation={e} onOpen={open} />
          </Suspense>
        </ChartBoundary>
        {goal.scope.origin && (
          <p className="text-muted-foreground text-[12px]">
            {t(`scouting.${goal.scope.origin.ruleId}`)} · {t('matches.champion')}{' '}
            {goal.scope.origin.filter.championId ? (
              <span className="inline-flex items-center gap-1.5 me-2.5 align-middle [&_[data-slot='avatar']]:w-6 [&_[data-slot='avatar']]:h-6">
                <GameEntityIcon
                  kind="champion"
                  id={goal.scope.origin.filter.championId}
                  label={championName(t, goal.scope.origin.filter.championId)}
                />
                {championName(t, goal.scope.origin.filter.championId)}
              </span>
            ) : (
              t('scouting.all')
            )}{' '}
            · {goal.scope.origin.filter.from || '—'} – {goal.scope.origin.filter.to || '—'}
          </p>
        )}
        <p className="text-muted-foreground text-[12px]">
          {t('review.windowSince', { at: new Date(goal.windowStart).toLocaleString() })}
        </p>
        <div data-ui="actions" className="flex items-center gap-2">
          {(['active', 'paused', 'completed', 'abandoned'] as GoalState[])
            .filter((state) => state !== goal.state)
            .map((state) => (
              <Button
                key={state}
                size="sm"
                variant="outline"
                disabled={['completed', 'abandoned'].includes(goal.state)}
                onClick={() => setConfirm(state)}
              >
                {t(`review.goalAction_${state}`)}
              </Button>
            ))}
          <Button
            size="sm"
            variant="outline"
            disabled={goal.state !== 'active' || evaluate.isPending}
            onClick={() => evaluate.mutate()}
          >
            {t('review.evaluate')}
          </Button>
        </div>
        <Collapsible className="rounded-lg border border-border px-4">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="group h-auto min-h-9 w-full justify-start gap-2 px-0 py-2 text-left text-sm font-normal whitespace-normal text-muted-foreground"
            >
              <ChevronRight
                aria-hidden="true"
                className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
              />
              {t('review.newGoalVersion')}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent forceMount className="hidden min-w-0 pb-2 data-[state=open]:block">
            <div className="grid gap-4 pb-4">
              <div data-ui="actions" className="flex items-center gap-2">
                <ChampionSelect
                  value={scope.championId}
                  onValueChange={(championId) => updateScope({ championId })}
                />
                <SearchSelect
                  label={t('review.position')}
                  value={scope.position}
                  options={['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].map((position) => ({
                    value: position,
                    label: positionName(t, position),
                  }))}
                  onValueChange={(position) => updateScope({ position })}
                />
                <Label>
                  {t('matches.version')}
                  <Input
                    aria-label={t('training.goalPatch')}
                    value={scope.patch}
                    onChange={(event) => updateScope({ patch: event.target.value })}
                  />
                </Label>
                <SearchSelect
                  label={t('training.direction')}
                  value={scope.direction}
                  options={['increase', 'decrease'].map((direction) => ({
                    value: direction,
                    label: t(`training.${direction}`),
                  }))}
                  onValueChange={(direction) => updateScope({ direction })}
                />
              </div>
              <Label>
                {t('review.changeTarget')}
                <Input
                  type="number"
                  min={0}
                  max={1000}
                  step="0.1"
                  value={newTarget}
                  onChange={(e) => setNewTarget(e.target.value)}
                />
              </Label>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  (!scopeChanged && newTarget === String(goal.scope.target)) ||
                  !newTarget ||
                  !Number.isFinite(Number(newTarget)) ||
                  Number(newTarget) < 0
                }
                onClick={() => setConfirm('active')}
              >
                {t('review.newGoalVersion')}
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>
        <Collapsible className="rounded-lg border border-border px-4">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="group h-auto min-h-9 w-full justify-start gap-2 px-0 py-2 text-left text-sm font-normal whitespace-normal text-muted-foreground"
            >
              <ChevronRight
                aria-hidden="true"
                className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
              />
              {t('review.baselineMembers')} · {t('review.currentMembers')}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent forceMount className="hidden min-w-0 pb-2 data-[state=open]:block">
            <div className="grid gap-3 pb-4">
              <div data-ui="actions" className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  disabled={revision == null && !e}
                  onClick={() => setRevision(null)}
                >
                  {t('review.latestEvaluation')}
                </Button>
                {e && e.revision > 1 && (
                  <Button variant="ghost" onClick={() => setRevision(e.revision - 1)}>
                    {t('review.previousEvaluation')}
                  </Button>
                )}
                {e && <Badge variant="outline">{t('review.revision', { n: e.revision })}</Badge>}
              </div>
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
                    {t('training.numericTable')}
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
                        <TableHead>{t('training.selection')}</TableHead>
                        <TableHead>{t(`review.metric_${goal.scope.metricId}`)}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[
                        ...goal.baseline.map((member) => ({ member, group: 'baseline' })),
                        ...(e?.members || []).map((member) => ({ member, group: 'current' })),
                      ].map(({ member, group }) => (
                        <TableRow key={`${group}:${member.matchKey}`}>
                          <TableCell>
                            <Button variant="link" onClick={() => open(member)}>
                              {matchName(t, member.matchKey)}
                            </Button>
                          </TableCell>
                          <TableCell>{t(`review.${group}`)}</TableCell>
                          <TableCell>{numberText(member.value)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CollapsibleContent>
              </Collapsible>
              <p className="text-muted-foreground text-[12px]">{t('review.baselineMembers')}</p>
              <div data-ui="actions" className="flex items-center gap-2">
                {goal.baseline.map((m) => (
                  <Button variant="link" size="sm" key={m.matchKey} onClick={() => open(m)}>
                    {matchName(t, m.matchKey)} · {numberText(m.value)}
                  </Button>
                ))}
              </div>
              {Object.entries(goal.baselineExcluded || {}).map(([reason, count]) => (
                <small key={`baseline:${reason}`}>
                  {t('review.baseline')} ·{' '}
                  {t(`review.reason_${reason}`, { defaultValue: t('labels.unknownReason') })}:{' '}
                  {count}
                </small>
              ))}
              {progress.data?.availability && (
                <>
                  <p>
                    {t('training.availableSamples', {
                      details: progress.data.availability.missingDetails.length,
                      reports: progress.data.availability.missingReports.length,
                      excluded: progress.data.availability.notApplicable,
                      mismatch: progress.data.availability.versionMismatch,
                    })}
                  </p>
                  {epoch && (
                    <MatchPreparationPanel
                      epoch={epoch}
                      player={goal.scope.playerKey}
                      selected={[
                        ...progress.data.availability.missingDetails,
                        ...progress.data.availability.missingReports,
                      ]
                        .slice(0, 20)
                        .map((match) => match.matchKey)}
                    />
                  )}
                </>
              )}
              <p className="text-muted-foreground text-[12px]">{t('review.currentMembers')}</p>
              <div data-ui="actions" className="flex items-center gap-2">
                {e?.members.map((m) => (
                  <Button variant="link" size="sm" key={m.matchKey} onClick={() => open(m)}>
                    {matchName(t, m.matchKey)} · {numberText(m.value)}
                  </Button>
                ))}
              </div>
              {Object.entries(e?.excluded || {}).map(([reason, count]) => (
                <small key={reason}>
                  {t(`review.reason_${reason}`, { defaultValue: t('labels.unknownReason') })}:{' '}
                  {count}
                </small>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
      <Dialog
        open={!!confirm}
        onOpenChange={(value) => {
          if (!value) setConfirm(null);
        }}
      >
        <DialogContent closeLabel={t('common.dismiss')}>
          <DialogHeader>
            <DialogTitle>{confirm && t(`review.goalAction_${confirm}`)}</DialogTitle>
            <DialogDescription>{t('review.goalConfirmHelp')}</DialogDescription>
          </DialogHeader>
          <ErrorNotice error={save.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={save.isPending}
              onClick={() => {
                if (confirm) save.mutate(confirm);
              }}
            >
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
