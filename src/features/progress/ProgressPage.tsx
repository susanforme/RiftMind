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
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
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
export function ProgressPage() {
  const { t } = useTranslation();
  const search = progressRoute.useSearch();
  const navigate = useNavigate();
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
    <div className="page progress-page">
      <div className="page-heading">
        <div>
          <h1>{t('review.progress')}</h1>
        </div>
        <Button
          variant="outline"
          onClick={() => void navigate({ to: '/matches', search: { player } })}
        >
          {t('review.back')}
        </Button>
      </div>
      <Card>
        <CardContent className="progress-filters">
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
      {player && epoch && (
        <RecurringIssuesPanel key={`${epoch}:${player}`} player={player} epoch={epoch} />
      )}
      <ErrorNotice error={goals.error || progress.error || players.error} />
      <Card>
        <CardHeader>
          <CardTitle>{t('review.goals')}</CardTitle>
        </CardHeader>
        <CardContent className="review-stack">
          {!goals.data?.items.length && <p>{t('review.noGoals')}</p>}
          {goals.data?.items.map((goal) => (
            <GoalCard key={`${goal.id}:${goal.revision}`} goal={goal} epoch={epoch} open={open} />
          ))}
          {!!goals.data?.items.length && (
            <div className="actions">
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
        <CardContent className="review-stack">
          {!!groups.length && <p className="help">{t('review.comparability')}</p>}
          {Object.entries(progress.data?.excluded || {}).map(([reason, count]) => (
            <p key={reason}>
              {t(`review.reason_${reason}`, { defaultValue: t('labels.unknownReason') })}: {count}
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
                          <TableCell key={id}>
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
        scope: { ...goal.scope, target: Number(newTarget) },
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
  const avg =
    goal.baseline.length >= 5
      ? goal.baseline.reduce((sum, x) => sum + x.value, 0) / goal.baseline.length
      : null;
  return (
    <Card className="goal-card">
      <CardHeader>
        <CardTitle>
          {t(`review.metric_${goal.scope.metricId}`)}{' '}
          <Badge variant="secondary">{t(`review.goal_${goal.state}`)}</Badge>
        </CardTitle>
        <CardDescription>
          {queueName(t, goal.scope.queueId)} · {positionName(t, goal.scope.position)} ·{' '}
          {goal.scope.patch} · v{goal.version} · {goal.scope.direction === 'increase' ? '≥' : '≤'}{' '}
          {goal.scope.target}
        </CardDescription>
      </CardHeader>
      <CardContent className="review-stack">
        <ErrorNotice error={progress.error || save.error || evaluate.error} />
        <p>
          {t('review.baseline')}: {numberText(avg)} ({goal.baseline.length}/10) ·{' '}
          {t('review.current')}: {numberText(e?.current)} ({e?.members.length || 0}/10) · Δ{' '}
          {numberText(e?.delta)}
        </p>
        <p>
          {e?.achieved == null
            ? t('review.waitingSamples')
            : t(e.achieved ? 'review.achieved' : 'review.notAchieved')}
        </p>
        {goal.scope.origin && (
          <p className="help">
            {t(`scouting.${goal.scope.origin.ruleId}`)} · {t('matches.champion')}{' '}
            {goal.scope.origin.filter.championId ? (
              <span className="inline-entity">
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
        <p className="help">
          {t('review.windowSince', { at: new Date(goal.windowStart).toLocaleString() })}
        </p>
        <div className="actions">
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
            newTarget === String(goal.scope.target) ||
            !newTarget ||
            !Number.isFinite(Number(newTarget)) ||
            Number(newTarget) < 0
          }
          onClick={() => setConfirm('active')}
        >
          {t('review.newGoalVersion')}
        </Button>
        <div className="actions">
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
        <p className="help">{t('review.baselineMembers')}</p>
        <div className="actions">
          {goal.baseline.map((m) => (
            <Button variant="link" size="sm" key={m.matchKey} onClick={() => open(m)}>
              {matchName(t, m.matchKey)} · {numberText(m.value)}
            </Button>
          ))}
        </div>
        {Object.entries(goal.baselineExcluded || {}).map(([reason, count]) => (
          <small key={`baseline:${reason}`}>
            {t('review.baseline')} ·{' '}
            {t(`review.reason_${reason}`, { defaultValue: t('labels.unknownReason') })}: {count}
          </small>
        ))}
        <p className="help">{t('review.currentMembers')}</p>
        <div className="actions">
          {e?.members.map((m) => (
            <Button variant="link" size="sm" key={m.matchKey} onClick={() => open(m)}>
              {matchName(t, m.matchKey)} · {numberText(m.value)}
            </Button>
          ))}
        </div>
        {Object.entries(e?.excluded || {}).map(([reason, count]) => (
          <small key={reason}>
            {t(`review.reason_${reason}`, { defaultValue: t('labels.unknownReason') })}: {count}
          </small>
        ))}
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
