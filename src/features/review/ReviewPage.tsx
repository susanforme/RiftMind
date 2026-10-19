import { GameEntityIcon, skillResourceId } from '../../components/GameEntityIcon';
import {
  queueName,
  positionName,
  codeName,
  championName,
  matchName,
  skillName,
  playerName,
} from '../../lib/display-names';
import { serverName } from '../../lib/server-name';
import { Label } from '../../components/ui/label';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, RefreshCw, FileText, Swords } from 'lucide-react';
import { reviewRoute } from '../../app/router';
import { transport } from '../../app/runtime';
import { queryClient } from '../../app/query-client';
import { useWorkspace } from '../../stores/workspace-tabs';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Textarea } from '../../components/ui/textarea';
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
import { Skeleton } from '../../components/ui/skeleton';
import { Progress } from '../../components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/dialog';
import { ErrorNotice } from '../../components/ErrorNotice';
import type { ReviewNote, GoalScope, AppError } from '../../generated/contracts';
import { matchTime, numberText } from './format';
import { ChartBoundary } from './ChartBoundary';
const Chart = lazy(() => import('./ReviewChart'));
const autoAttempts = new Set<string>();
export function ReviewPage() {
  const { t, i18n } = useTranslation();
  const search = reviewRoute.useSearch();
  const { matchKey } = reviewRoute.useParams();
  const navigate = useNavigate();
  const playerKey = search.player || '';
  const key = { matchKey, playerKey };
  const [taskId, setTaskId] = useState<string | null>(null);
  const [metric, setMetric] = useState<'gold' | 'cs'>('gold');
  const [eventKind, setEventKind] = useState('all');
  const [cursor, setCursor] = useState<number | null>(null);
  const [time, setTime] = useState('');
  const [editing, setEditing] = useState<ReviewNote | null>(null);
  const [deleteId, setDeleteId] = useState<ReviewNote | null>(null);
  const [noteEvidence, setNoteEvidence] = useState<string | null>(null);
  const [noteReportId, setNoteReportId] = useState<string | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalMetric, setGoalMetric] = useState('cs_10');
  const [target, setTarget] = useState('70');
  const [draftText, setDraftText] = useState('');
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
  const data = useQuery({
    queryKey: ['review-data', epoch, matchKey, playerKey, search.report],
    queryFn: () =>
      transport.call('get_match_review_data', {
        ...key,
        inputRevision: null,
        reportId: search.report || null,
      }),
    enabled: !!playerKey && !!epoch,
    retry: false,
  });
  const summary = data.data?.summary;
  const resourceItems = [
    ...new Set([
      ...(summary?.items || []),
      ...(data.data?.input?.events.flatMap((e) => (e.itemId ? [e.itemId] : [])) || []),
    ]),
  ];
  const assets = useQuery({
    queryKey: ['assets', summary?.version, i18n.language, summary?.championId, resourceItems],
    queryFn: () =>
      transport.call('resolve_assets', {
        version: summary!.version,
        locale: i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US',
        championIds: [
          ...new Set([
            ...(summary?.championId ? [summary.championId] : []),
            ...(data.data?.input?.context.participants.flatMap((p) =>
              p.championId ? [p.championId] : [],
            ) || []),
          ]),
        ],
        resourceIds: resourceItems.map((id) => ({ kind: 'item' as const, id })),
      }),
    enabled: !!summary?.championId && summary.version !== 'unknown',
    staleTime: Infinity,
    retry: false,
  });
  const champion = assets.data?.find((a) => a.resourceId === `champion:${summary?.championId}`);
  const mode = queueName(t, summary?.queueId);
  const input = data.data?.input;
  const report = data.data?.report;
  const current =
    connection.data?.player?.playerKey === playerKey &&
    connection.data?.player?.serverId === data.data?.summary.serverId;
  const targetParticipant = input?.context.participants.find(
    (p) => p.id === input.context.targetId,
  );
  const participantLabel = (id: number | null) => {
    const p = input?.context.participants.find((p) => p.id === id);
    return p ? (
      <span className="inline-entity">
        <GameEntityIcon
          kind="champion"
          id={p.championId}
          version={summary?.version}
          label={championName(t, p.championId)}
        />
        {assets.data?.find((a) => a.resourceId === `champion:${p.championId}`)?.name ||
          championName(t, p.championId)}{' '}
        · {positionName(t, p.position)}
      </span>
    ) : id == null ? (
      '—'
    ) : (
      t('labels.unknownPlayer')
    );
  };
  const enemyTeam =
    input?.context.participants.filter((p) => p.teamId !== targetParticipant?.teamId) || [];
  const enemyJungler =
    enemyTeam.length === 5 &&
    new Set(enemyTeam.map((p) => p.position)).size === 5 &&
    enemyTeam.every((p) =>
      ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].includes(p.position || ''),
    )
      ? enemyTeam.find((p) => p.position === 'JUNGLE')?.id
      : undefined;
  const refetch = () => {
    void queryClient.invalidateQueries({ queryKey: ['review-data'] });
    void queryClient.invalidateQueries({ queryKey: ['matches'] });
  };
  const fetchDetails = useMutation({
    mutationFn: () => transport.call('fetch_match_details', key),
    onSuccess: (task) => {
      setTaskId(task.id);
      refetch();
    },
  });
  useEffect(() => {
    const attemptKey = `${epoch}|${matchKey}|${playerKey}`;
    if (
      data.data &&
      current &&
      connection.data?.phase === 'connected' &&
      !data.data.lastError &&
      !data.data.activeTask &&
      ['missing', 'partial'].includes(data.data.timelineStatus) &&
      !autoAttempts.has(attemptKey)
    ) {
      autoAttempts.add(attemptKey);
      fetchDetails.mutate();
    }
  }, [data.data, current, connection.data?.phase, epoch, matchKey, playerKey]);
  const activeTaskId = taskId || data.data?.activeTask?.id;
  const task = useQuery({
    queryKey: ['task', epoch, activeTaskId],
    queryFn: () => transport.call('get_task_status', { id: activeTaskId! }),
    enabled: !!activeTaskId,
    refetchInterval: (q) =>
      !q.state.data || ['queued', 'running'].includes(q.state.data.state) ? 500 : false,
  });
  const lastTask = useRef('');
  useEffect(() => {
    const value = task.data;
    if (
      !value ||
      ['queued', 'running'].includes(value.state) ||
      lastTask.current === `${value.id}:${value.state}`
    )
      return;
    lastTask.current = `${value.id}:${value.state}`;
    refetch();
    if (value.kind === 'generate_review' && value.state === 'completed' && value.result)
      void navigate({
        to: '/matches/$matchKey/review',
        params: { matchKey },
        search: { ...search, report: value.result.reference, evidence: undefined, at: undefined },
        replace: true,
      });
  }, [task.data]);
  const generate = useMutation({
    mutationFn: () =>
      transport.call('generate_review', { ...key, inputRevision: data.data!.latestInputRevision! }),
    onSuccess: (task) => {
      setTaskId(task.id);
      if (task.state === 'completed' && task.result)
        void navigate({
          to: '/matches/$matchKey/review',
          params: { matchKey },
          search: { ...search, report: task.result.reference, evidence: undefined, at: undefined },
        });
    },
  });
  const cancel = useMutation({
    mutationFn: () => transport.call('cancel_task', { id: activeTaskId! }),
    onSuccess: () => void task.refetch(),
  });
  const busy =
    !!(task.data && ['queued', 'running'].includes(task.data.state)) || !!data.data?.activeTask;
  const chart = useQuery({
    queryKey: ['review-chart', epoch, matchKey, playerKey, input?.revision],
    queryFn: () =>
      transport.call('get_match_metrics', {
        ...key,
        inputRevision: input!.revision,
        fromMs: 0,
        toMs: input!.context.durationMs,
        maxPoints: 1000,
      }),
    enabled: !!input,
  });
  const timeline = useQuery({
    queryKey: [
      'timeline',
      epoch,
      matchKey,
      playerKey,
      input?.revision,
      eventKind,
      cursor,
      search.at,
    ],
    queryFn: () =>
      transport.call('get_timeline_slice', {
        ...key,
        inputRevision: input!.revision,
        fromMs: search.at == null ? 0 : Math.max(0, search.at - 60000),
        toMs:
          search.at == null
            ? input!.context.durationMs
            : Math.min(input!.context.durationMs, search.at + 60000),
        kinds:
          eventKind === 'all'
            ? []
            : eventKind === 'build'
              ? ['ITEM_PURCHASED', 'ITEM_SOLD', 'ITEM_UNDO', 'SKILL_LEVEL_UP']
              : eventKind === 'objectives'
                ? ['ELITE_MONSTER_KILL', 'BUILDING_KILL']
                : ['CHAMPION_KILL'],
        cursor,
        limit: 100,
      }),
    enabled: !!input,
  });
  const evidence = useQuery({
    queryKey: ['review-evidence', epoch, report?.id, search.evidence],
    queryFn: () =>
      transport.call('get_review_evidence', { reportId: report!.id, evidenceId: search.evidence! }),
    enabled: !!report && !!search.evidence,
    retry: false,
  });
  const annotations = useQuery({
    queryKey: ['annotations', epoch, matchKey, playerKey, report?.id],
    queryFn: () =>
      transport.call('get_review_annotations', { ...key, reportId: report?.id || null }),
    enabled: !!data.data,
  });
  const draftKey = `${epoch}|${playerKey}|${matchKey}`;
  const storedDraft = useWorkspace((s) => s.reviewDrafts[draftKey]);
  const text = storedDraft?.text ?? draftText;
  useEffect(() => {
    if (storedDraft) {
      setEditing(storedDraft.note);
      setNoteEvidence(storedDraft.evidenceId);
      setNoteReportId(storedDraft.reportId);
    }
  }, [draftKey]);
  const setText = (value: string) => {
    setDraftText(value);
    useWorkspace.getState().setReviewDraft(draftKey, {
      text: value,
      note: editing,
      reportId: noteReportId || editing?.reportId || null,
      evidenceId: noteEvidence || editing?.evidenceId || null,
      matchKey,
      playerKey,
      epoch: epoch || '',
    });
  };
  const saveNote = useMutation({
    mutationFn: () =>
      transport.call('save_review_note', {
        workspaceEpoch: epoch!,
        ...key,
        id: editing?.id || null,
        reportId: noteReportId || editing?.reportId || null,
        evidenceId: noteEvidence || editing?.evidenceId || null,
        text,
        expectedRevision: editing?.revision || 0,
      }),
    onSuccess: () => {
      useWorkspace.getState().setReviewDraft(draftKey, null);
      setDraftText('');
      setEditing(null);
      setNoteEvidence(null);
      setNoteReportId(null);
      void annotations.refetch();
    },
  });
  async function refreshNoteRevision() {
    const fresh = await transport.call('get_review_annotations', {
      ...key,
      reportId: noteReportId || editing?.reportId || null,
    });
    const currentNote = fresh.notes.find((n) => n.id === editing?.id) || null;
    setEditing(currentNote);
    useWorkspace.getState().setReviewDraft(draftKey, {
      text,
      note: currentNote,
      reportId: currentNote?.reportId || noteReportId,
      evidenceId: currentNote?.evidenceId || noteEvidence,
      matchKey,
      playerKey,
      epoch: epoch || '',
    });
    saveNote.reset();
  }
  const remove = useMutation({
    mutationFn: (note: ReviewNote) =>
      transport.call('delete_review_note', {
        workspaceEpoch: epoch!,
        id: note.id,
        expectedRevision: note.revision,
      }),
    onSuccess: () => {
      setDeleteId(null);
      void annotations.refetch();
    },
  });
  const feedback = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string | null }) =>
      transport.call('save_review_feedback', {
        workspaceEpoch: epoch!,
        reportId: report!.id,
        findingId: id,
        value,
        expectedRevision: annotations.data?.feedback.find((f) => f.findingId === id)?.revision || 0,
      }),
    onSuccess: () => void annotations.refetch(),
  });
  const goal = useMutation({
    mutationFn: () => {
      const p = input!.context.participants.find((p) => p.id === input!.context.targetId)!;
      const scope: GoalScope = {
        playerKey,
        queueId: input!.context.queueId!,
        position: p.position || '',
        patch: input!.context.version.split('.').slice(0, 2).join('.'),
        metricId: goalMetric,
        metricVersion: '1',
        direction: goalMetric === 'cs_10' ? 'increase' : 'decrease',
        target: Number(target),
      };
      return transport.call('save_training_goal', {
        workspaceEpoch: epoch!,
        id: null,
        expectedRevision: 0,
        scope,
        state: 'active',
      });
    },
    onSuccess: () => {
      setGoalOpen(false);
      void navigate({ to: '/progress', search: { player: playerKey } });
    },
  });
  const selectTime = useCallback(
    (at: number) => {
      setCursor(null);
      void navigate({
        to: '/matches/$matchKey/review',
        params: { matchKey },
        search: { ...search, at },
      });
    },
    [navigate, matchKey, search],
  );
  function selectEvidence(id: string) {
    const e =
      report?.evidence.find((e) => e.id === id) || timeline.data?.events.find((e) => e.id === id);
    setCursor(null);
    void navigate({
      to: '/matches/$matchKey/review',
      params: { matchKey },
      search: { ...search, report: report?.id, evidence: id, at: e?.timestampMs ?? undefined },
    });
  }
  function back() {
    const tab = useWorkspace
      .getState()
      .tabs.find((t) => t.kind === 'matches' && t.playerKey === playerKey);
    let saved = {};
    try {
      saved = JSON.parse(tab?.search || '{}');
    } catch {
      /* old invalid tab */
    }
    void navigate({ to: '/matches', search: { ...saved, player: playerKey, tab: tab?.id } });
  }
  const supported =
    !!input &&
    [420, 440].includes(input.context.queueId || 0) &&
    input.context.mapId === 11 &&
    input.context.mode === 'CLASSIC';
  return (
    <div className="page review-page">
      <div className="page-heading">
        <div>
          <h1>{t('review.title')}</h1>
          <p>{matchName(t, matchKey)}</p>
        </div>
        <Button variant="outline" onClick={back}>
          <ArrowLeft aria-hidden="true" size={15} />
          {t('review.back')}
        </Button>
      </div>
      <ErrorNotice
        error={
          data.error || fetchDetails.error || generate.error || task.data?.error || cancel.error
        }
      />
      {data.isLoading && <Skeleton className="review-loading" />}
      {!playerKey && (
        <Alert>
          <AlertDescription>{t('review.invalidLink')}</AlertDescription>
        </Alert>
      )}
      {data.data && (
        <>
          <Card className="review-match-overview">
            <CardHeader className="review-match-header">
              <div className="review-match-identity">
                <div className="review-match-portrait">
                  {champion?.reference ? (
                    <img src={champion.reference} alt="" />
                  ) : (
                    <Swords aria-hidden="true" size={24} />
                  )}
                </div>
                <div className="review-match-copy">
                  <CardTitle>
                    {champion?.name || championName(t, data.data.summary.championId)}
                  </CardTitle>
                  <CardDescription className="review-match-meta">
                    <span className={`match-result outcome-${data.data.summary.outcome}`}>
                      {t(`matches.${data.data.summary.outcome}`)}
                    </span>
                    <span>{mode}</span>
                    <span>{matchTime((data.data.summary.duration || 0) * 1000)}</span>
                    <span>
                      K/D/A {data.data.summary.kills ?? '—'}/{data.data.summary.deaths ?? '—'}/
                      {data.data.summary.assists ?? '—'}
                    </span>
                    <span>CS {data.data.summary.cs ?? '—'}</span>
                  </CardDescription>
                  <CardDescription className="review-match-meta">
                    <span>
                      {playerName(
                        t,
                        players.data?.find((p) => p.playerKey === playerKey),
                      )}
                    </span>
                    <span>{serverName(t, data.data.summary.serverId)}</span>
                    <span>
                      {t('matches.version')} {data.data.summary.version}
                    </span>
                    <span>{codeName(t, 'source', data.data.summary.source)}</span>
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="review-match-body">
              <div className="review-status-actions">
                <div className="actions">
                  <Badge>
                    {t('review.summary')} · {t(`review.status_${data.data.summaryStatus}`)}
                  </Badge>
                  <Badge variant="secondary">
                    {t('review.timeline')} · {t(`review.status_${data.data.timelineStatus}`)}
                  </Badge>
                  {report && (
                    <Badge variant="outline">{t('review.revision', { n: report.revision })}</Badge>
                  )}
                </div>
                <div className="actions">
                  <Button
                    variant="outline"
                    disabled={
                      !current ||
                      connection.data?.phase !== 'connected' ||
                      busy ||
                      fetchDetails.isPending
                    }
                    onClick={() => fetchDetails.mutate()}
                  >
                    <RefreshCw aria-hidden="true" size={15} />
                    {t('review.fetch')}
                  </Button>
                  <Button
                    disabled={!supported || busy || generate.isPending}
                    onClick={() => generate.mutate()}
                  >
                    <FileText aria-hidden="true" size={15} />
                    {t(report ? 'review.regenerate' : 'review.generate')}
                  </Button>
                  {busy && (
                    <Button variant="outline" onClick={() => cancel.mutate()}>
                      {t('common.cancel')}
                    </Button>
                  )}
                </div>
              </div>
              {!current && <p className="help">{t('review.switchAccount')}</p>}
              {input && !supported && (
                <Alert>
                  <AlertDescription>{t('review.unsupported')}</AlertDescription>
                </Alert>
              )}
              {data.data.newerInput && (
                <Alert>
                  <AlertDescription>{t('review.newData')}</AlertDescription>
                </Alert>
              )}
              {data.data.retryAt && (
                <p className="help">
                  {t('review.retryAt', { at: new Date(data.data.retryAt).toLocaleString() })}
                </p>
              )}
              <ErrorNotice error={data.data.lastError} />
              {task.data && (
                <div className="task-progress">
                  <span>
                    {t(`common.${task.data.state}`)} ·{' '}
                    {t(`review.stage_${task.data.stage || 'queued'}`)} · {task.data.checkpoint}/
                    {task.data.budget}
                  </span>
                  <Progress
                    aria-label={t('review.generate')}
                    value={task.data.budget ? (task.data.checkpoint / task.data.budget) * 100 : 0}
                  />
                </div>
              )}
            </CardContent>
          </Card>
          {report ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{t('review.overview')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="review-metrics">
                    {report.metrics
                      .filter((m) =>
                        [
                          'kills',
                          'deaths',
                          'assists',
                          'kda',
                          'cs_per_min',
                          'participation',
                          'gold_share',
                          'damage_share',
                          'cs_10',
                          'gold_diff_10',
                        ].includes(m.id),
                      )
                      .map((m) => (
                        <div key={m.id}>
                          <span>
                            {t(`review.metric_${m.id}`, {
                              defaultValue: t('labels.unknownMetric'),
                            })}
                          </span>
                          <strong>
                            {numberText(m.value, m.id === 'kda' ? undefined : m.unit)}
                          </strong>
                          {m.reason && (
                            <small>
                              {t(`review.reason_${m.reason}`, {
                                defaultValue: t('labels.unknownReason'),
                              })}
                            </small>
                          )}
                          {m.sampledAtMs != null && <small>{matchTime(m.sampledAtMs)}</small>}
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
              <div className="review-findings">
                {report.findings.map((f) => (
                  <Card className="finding-card" key={f.id}>
                    <CardHeader className="finding-heading">
                      <CardTitle>
                        {f.priority > 0 && <Badge variant="secondary">{f.priority}</Badge>}{' '}
                        {t(`review.${f.messageKey}`, {
                          ...f.params,
                          defaultValue: t('review.overview'),
                        })}
                      </CardTitle>
                      <CardDescription>
                        {f.actionKey && t(`review.${f.actionKey}`, { defaultValue: '' })}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="review-stack finding-content">
                      <div className="actions finding-evidence">
                        {f.evidenceIds.map((id) => (
                          <Button
                            key={id}
                            variant="link"
                            size="sm"
                            onClick={() => selectEvidence(id)}
                          >
                            {report.evidence.find((e) => e.id === id)?.timestampMs != null
                              ? matchTime(report.evidence.find((e) => e.id === id)!.timestampMs!)
                              : t('review.evidence')}
                          </Button>
                        ))}
                      </div>
                      <div className="actions finding-feedback">
                        {['helpful', 'inaccurate'].map((value) => (
                          <Button
                            key={value}
                            variant={
                              annotations.data?.feedback.find((x) => x.findingId === f.id)
                                ?.value === value
                                ? 'secondary'
                                : 'ghost'
                            }
                            aria-pressed={
                              annotations.data?.feedback.find((x) => x.findingId === f.id)
                                ?.value === value
                            }
                            size="sm"
                            disabled={feedback.isPending}
                            onClick={() =>
                              feedback.mutate({
                                id: f.id,
                                value:
                                  annotations.data?.feedback.find((x) => x.findingId === f.id)
                                    ?.value === value
                                    ? null
                                    : value,
                              })
                            }
                          >
                            {t(`review.${value}`)}
                          </Button>
                        ))}
                      </div>
                      {f.limitations.map((l) => (
                        <p className="help" key={l}>
                          {t(`review.reason_${l}`, { defaultValue: t('labels.unknownReason') })}
                        </p>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
              <ErrorNotice error={feedback.error} />
              <Card>
                <CardHeader>
                  <CardTitle>{t('review.limits')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {report.limitations.map((l) => (
                    <p key={l}>
                      {t(`review.reason_${l}`, { defaultValue: t('labels.unknownReason') })}
                    </p>
                  ))}
                </CardContent>
              </Card>
            </>
          ) : (
            <Alert>
              <AlertDescription>{t('review.noReport')}</AlertDescription>
            </Alert>
          )}
          {input && (
            <Card>
              <CardHeader>
                <CardTitle>{t('review.timeline')}</CardTitle>
                <CardDescription>
                  {t('review.gapsHelp')} · {t('review.targetParticipant')}:{' '}
                  {participantLabel(input.context.targetId)}
                </CardDescription>
              </CardHeader>
              <CardContent className="review-stack">
                <div className="actions">
                  <Button
                    aria-pressed={metric === 'gold'}
                    variant={metric === 'gold' ? 'default' : 'outline'}
                    onClick={() => setMetric('gold')}
                  >
                    {t('review.gold')}
                  </Button>
                  <Button
                    aria-pressed={metric === 'cs'}
                    variant={metric === 'cs' ? 'default' : 'outline'}
                    onClick={() => setMetric('cs')}
                  >
                    {t('review.cs')}
                  </Button>
                  <Label>
                    {t('review.time')}
                    <Input
                      aria-label={t('review.time')}
                      type="number"
                      min={0}
                      max={Math.floor(input.context.durationMs / 1000)}
                      value={time}
                      placeholder="600"
                      onChange={(e) => setTime(e.target.value)}
                    />
                  </Label>
                  <Button
                    variant="outline"
                    disabled={
                      time === '' ||
                      Number(time) < 0 ||
                      Number(time) * 1000 > input.context.durationMs
                    }
                    onClick={() => selectTime(Number(time) * 1000)}
                  >
                    {t('review.locate')}
                  </Button>
                  {search.at != null && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setCursor(null);
                        void navigate({
                          to: '/matches/$matchKey/review',
                          params: { matchKey },
                          search: { ...search, at: undefined, evidence: undefined },
                        });
                      }}
                    >
                      {t('common.reset')}
                    </Button>
                  )}
                </div>
                <ErrorNotice error={chart.error} />
                {chart.data && (
                  <ChartBoundary key={input.revision} fallback={t('review.chartFailed')}>
                    <Suspense fallback={<Skeleton className="review-loading" />}>
                      <Chart data={chart.data} metric={metric} onSelect={selectTime} />
                    </Suspense>
                  </ChartBoundary>
                )}
                <div className="numeric-table">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('review.timeLabel')}</TableHead>
                        <TableHead>{t('review.gold')}</TableHead>
                        <TableHead>{t('review.cs')}</TableHead>
                        <TableHead>
                          {t('review.opponent')} · {t('review.gold')}
                        </TableHead>
                        <TableHead>
                          {t('review.opponent')} · {t('review.cs')}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {chart.data?.points.map((p) => (
                        <TableRow key={p.timestampMs}>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => selectTime(p.timestampMs)}
                            >
                              {matchTime(p.timestampMs)}
                            </Button>
                          </TableCell>
                          <TableCell>{numberText(p.gold)}</TableCell>
                          <TableCell>{numberText(p.cs)}</TableCell>
                          <TableCell>{numberText(p.opponentGold)}</TableCell>
                          <TableCell>{numberText(p.opponentCs)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Label htmlFor="event-filter">{t('review.eventFilter')}</Label>
                <Select
                  value={eventKind}
                  onValueChange={(v) => {
                    setEventKind(v);
                    setCursor(null);
                  }}
                >
                  <SelectTrigger id="event-filter" aria-label={t('review.eventFilter')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['all', 'deaths', 'objectives', 'build'].map((k) => (
                      <SelectItem key={k} value={k}>
                        {t(`review.events_${k}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ErrorNotice error={timeline.error} />
                <div className="event-list">
                  {timeline.data?.events.map((e) => (
                    <div className="timeline-event" key={e.id}>
                      <Button
                        variant="ghost"
                        disabled={!report}
                        onClick={() => selectEvidence(e.id)}
                      >
                        {matchTime(e.timestampMs)} ·{' '}
                        {t(`review.event_${e.kind}`, { defaultValue: t('labels.unknownEvent') })}
                      </Button>
                      <span>
                        {participantLabel(e.participantId ?? e.killerId)}
                        {e.killerId != null &&
                          e.killerId === enemyJungler &&
                          ` (${t('review.enemyJungler')})`}
                        {e.victimId != null && <> → {participantLabel(e.victimId)}</>}{' '}
                        {e.itemId != null && (
                          <GameEntityIcon
                            kind="item"
                            id={e.itemId}
                            version={summary?.version}
                            label={t('labels.item', { id: e.itemId })}
                          />
                        )}
                        {e.skillSlot != null && (
                          <GameEntityIcon
                            kind="skill"
                            id={skillResourceId(
                              input.context.participants.find(
                                (participant) => participant.id === e.participantId,
                              )?.championId,
                              e.skillSlot,
                            )}
                            version={summary?.version}
                            label={skillName(t, e.skillSlot)}
                          />
                        )}
                        {e.itemId
                          ? assets.data?.find((a) => a.resourceId === `item:${e.itemId}`)?.name ||
                            t('labels.item', { id: e.itemId })
                          : e.monster
                            ? codeName(t, 'monster', e.monster)
                            : e.skillSlot
                              ? skillName(t, e.skillSlot)
                              : ''}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="actions">
                  {cursor != null && (
                    <Button variant="outline" onClick={() => setCursor(null)}>
                      {t('matches.first')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={timeline.data?.nextCursor == null}
                    onClick={() => setCursor(timeline.data!.nextCursor)}
                  >
                    {t('matches.next')}
                  </Button>
                </div>
                {search.evidence && (
                  <Card className="evidence-panel">
                    <CardHeader>
                      <CardTitle>{t('review.evidence')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ErrorNotice error={evidence.error} />
                      {evidence.data && (
                        <>
                          <p className="help">
                            {evidence.data.reference.path} · {evidence.data.reference.snapshotId}
                          </p>
                          <pre>{JSON.stringify(evidence.data.raw, null, 2)}</pre>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setNoteEvidence(search.evidence!);
                              setNoteReportId(report!.id);
                            }}
                          >
                            {t('review.annotateEvidence')}
                          </Button>
                        </>
                      )}
                    </CardContent>
                  </Card>
                )}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>{t('review.notes')}</CardTitle>
              <CardDescription>
                {t(
                  noteEvidence || editing?.evidenceId ? 'labels.evidenceNote' : 'review.matchNote',
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="review-stack">
              <ErrorNotice error={annotations.error || saveNote.error || remove.error} />
              {(saveNote.error as AppError | null)?.code === 'REVISION_CONFLICT' && (
                <Button variant="outline" onClick={() => void refreshNoteRevision()}>
                  {t('review.refreshNoteRevision')}
                </Button>
              )}
              <Label htmlFor="review-note-text">{t('review.noteText')}</Label>
              <Textarea
                aria-label={t('review.noteText')}
                id="review-note-text"
                maxLength={10000}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="actions">
                <Button
                  disabled={!text.trim() || saveNote.isPending}
                  onClick={() => saveNote.mutate()}
                >
                  {t('review.saveNote')}
                </Button>
                {(editing || noteEvidence || text) && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      useWorkspace.getState().setReviewDraft(draftKey, null);
                      setDraftText('');
                      setEditing(null);
                      setNoteEvidence(null);
                      setNoteReportId(null);
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                )}
              </div>
              {annotations.data?.notes.map((n) => (
                <Card className="note-card" key={n.id}>
                  <CardContent>
                    <p className="note-text">{n.text}</p>
                    <small>
                      {t(n.evidenceId ? 'labels.evidenceNote' : 'review.matchNote')} ·{' '}
                      {t('review.revision', { n: n.revision })}
                    </small>
                    <div className="actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(n);
                          setNoteEvidence(n.evidenceId);
                          setNoteReportId(n.reportId);
                          setDraftText(n.text);
                          useWorkspace.getState().setReviewDraft(draftKey, {
                            text: n.text,
                            note: n,
                            reportId: n.reportId,
                            evidenceId: n.evidenceId,
                            matchKey,
                            playerKey,
                            epoch: epoch || '',
                          });
                        }}
                      >
                        {t('review.edit')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteId(n)}>
                        {t('review.delete')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </CardContent>
          </Card>
          {supported && (
            <Card>
              <CardHeader>
                <CardTitle>{t('review.nextGoal')}</CardTitle>
              </CardHeader>
              <CardContent>
                <Button onClick={() => setGoalOpen(true)}>{t('review.adoptGoal')}</Button>
              </CardContent>
            </Card>
          )}
        </>
      )}
      <Dialog
        open={!!deleteId}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
      >
        <DialogContent closeLabel={t('common.dismiss')}>
          <DialogHeader>
            <DialogTitle>{t('review.deleteNote')}</DialogTitle>
            <DialogDescription>{deleteId?.text.slice(0, 120)}</DialogDescription>
          </DialogHeader>
          <ErrorNotice error={remove.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (deleteId) remove.mutate(deleteId);
              }}
            >
              {t('review.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={goalOpen} onOpenChange={setGoalOpen}>
        <DialogContent closeLabel={t('common.dismiss')}>
          <DialogHeader>
            <DialogTitle>{t('review.adoptGoal')}</DialogTitle>
            <DialogDescription>{t('review.goalHelp')}</DialogDescription>
          </DialogHeader>
          <Label htmlFor="goal-metric">{t('review.goalMetric')}</Label>
          <Select
            value={goalMetric}
            onValueChange={(v) => {
              setGoalMetric(v);
              setTarget(v === 'cs_10' ? '70' : '1');
            }}
          >
            <SelectTrigger id="goal-metric" aria-label={t('review.goalMetric')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cs_10">{t('review.metric_cs_10')}</SelectItem>
              <SelectItem value="deaths_per_10">{t('review.metric_deaths_per_10')}</SelectItem>
            </SelectContent>
          </Select>
          <Label>
            {t('review.goalTarget')}
            <Input
              aria-label={t('review.goalTarget')}
              type="number"
              min={0}
              max={1000}
              step="0.1"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </Label>
          <ErrorNotice error={goal.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setGoalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={
                goal.isPending ||
                target === '' ||
                !Number.isFinite(Number(target)) ||
                Number(target) < 0
              }
              onClick={() => goal.mutate()}
            >
              {t('review.confirmGoal')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
