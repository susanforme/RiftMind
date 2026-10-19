import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '../../components/ui/collapsible';
import { matchOutcomeClasses } from '../../lib/match-outcome';
import { ChampionSelect } from '../../components/ChampionSelect';
import { ReviewEventContext } from './ReviewEventContext';
import { PersonalBaselinePanel } from '../analysis/PersonalBaselinePanel';
import { blankNotebook, useNotebookDrafts } from '../champion-notes/notebook-drafts';
import { ChampionArtwork, selectedChampionSkin } from '../../components/ChampionArtwork';
import {
  GameEntityIcon,
  skillResourceId,
  portraitCatalogueVersion,
} from '../../components/GameEntityIcon';
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
import { ChevronRight, ArrowLeft, RefreshCw, FileText } from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
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
  const [section, setSection] = useState(
    search.evidence || search.at != null ? 'timeline' : 'overview',
  );
  const [metric, setMetric] = useState<'gold' | 'cs'>('gold');
  const [eventKind, setEventKind] = useState('all');
  const [cursor, setCursor] = useState<number | null>(null);
  const [time, setTime] = useState('');
  const [editing, setEditing] = useState<ReviewNote | null>(null);
  const [deleteId, setDeleteId] = useState<ReviewNote | null>(null);
  const [noteEvidence, setNoteEvidence] = useState<string | null>(null);
  const [noteReportId, setNoteReportId] = useState<string | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalChampion, setGoalChampion] = useState<number | null>();
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
  const artworkVersion =
    summary?.version && summary.version !== 'unknown' ? summary.version : portraitCatalogueVersion;
  const artworkLocale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';
  const skins = useQuery({
    queryKey: ['champion-skins', artworkVersion, artworkLocale, summary?.championId],
    queryFn: () =>
      transport.call('get_champion_skins', {
        championId: summary!.championId!,
        version: artworkVersion,
        locale: artworkLocale,
      }),
    enabled: !!summary?.championId,
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
      <span className="inline-flex items-center gap-1.5 me-2.5 align-middle [&_[data-slot='avatar']]:w-6 [&_[data-slot='avatar']]:h-6">
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
        championId: goalChampion === null ? undefined : goalChampion || p.championId || undefined,
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
    setSection('timeline');
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
  function createNotebook(
    text: string,
    sourceReport: string | null,
    sourceEvidence: string | null,
    build = false,
  ) {
    if (!summary?.championId || !epoch) return;
    const content = blankNotebook(summary.championId, build ? 'build' : 'note');
    content.title = build ? t('notebooks.actualBuild') : t('notebooks.reviewNote');
    content.text = text;
    content.sources = [{ matchKey, playerKey, reportId: sourceReport, evidenceId: sourceEvidence }];
    if (build) {
      content.resourceVersion = summary.version;
      content.mapId = input?.context.mapId || 11;
      content.groups = [
        { name: t('notebooks.actualItems'), items: summary.items.map((id) => ({ id, count: 1 })) },
      ];
    }
    const key = `${epoch}:${summary.championId}:review:${crypto.randomUUID()}`;
    useNotebookDrafts.getState().setDraft(key, { epoch, entry: null, content });
    void navigate({ to: '/notebooks', search: { champion: summary.championId } });
  }
  const supported =
    !!input &&
    [420, 440].includes(input.context.queueId || 0) &&
    input.context.mapId === 11 &&
    input.context.mode === 'CLASSIC';
  return (
    <div
      data-ui="page"
      className="mx-auto grid w-full max-w-[1600px] min-w-0 grid-cols-1 gap-5 p-6 max-[900px]:p-4 [&_[data-ui~=actions]]:flex-wrap [&_label]:grid [&_label]:gap-1.5 [&_label]:text-xs [&_label_input]:max-w-40"
    >
      <div data-ui="page-heading" className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('review.title')}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{matchName(t, matchKey)}</p>
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
      {summary?.championId && (
        <div data-ui="actions" className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() =>
              void navigate({ to: '/notebooks', search: { champion: summary.championId! } })
            }
          >
            {t('notebooks.titlePage')}
          </Button>
          <Button
            variant="outline"
            onClick={() => createNotebook('', report?.id || null, null, true)}
          >
            {t('notebooks.saveActualBuild')}
          </Button>
        </div>
      )}
      {data.isLoading && <Skeleton className="min-h-40" />}
      {!playerKey && (
        <Alert>
          <AlertDescription>{t('review.invalidLink')}</AlertDescription>
        </Alert>
      )}
      {data.data && (
        <>
          <Card
            data-ui="review-summary"
            className="relative isolate overflow-hidden border-primary/20 bg-card"
          >
            <ChampionArtwork
              skin={selectedChampionSkin(skins.data?.skins || [], undefined)}
              version={artworkVersion}
              banner
            />
            <CardHeader className="relative pb-4">
              <div className="flex items-center gap-3.5 min-w-0">
                <GameEntityIcon
                  kind="champion"
                  id={summary?.championId}
                  version={summary?.version}
                  label={champion?.name || championName(t, summary?.championId)}
                  className="size-20 rounded-xl border border-primary/40 max-[650px]:size-16"
                />
                <div className="min-w-0 [&_[data-slot='card-title']]:text-2xl [&_[data-slot='card-title']]:mb-[5px]">
                  <CardTitle>
                    {champion?.name || championName(t, data.data.summary.championId)}
                  </CardTitle>
                  <CardDescription className="flex items-center flex-wrap gap-y-1.5 gap-x-3 text-[12px] leading-[1.6] [&_[data-ui~=match-result]]:text-(--outcome) [&_[data-ui~=match-result]]:font-semibold [&_>_span]:min-w-0 [&_>_span]:wrap-anywhere">
                    <span
                      data-ui="match-result"
                      className={`${matchOutcomeClasses[data.data.summary.outcome]}`}
                    >
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
                  <CardDescription className="flex items-center flex-wrap gap-y-1.5 gap-x-3 text-[12px] leading-[1.6] [&_[data-ui~=match-result]]:text-(--outcome) [&_[data-ui~=match-result]]:font-semibold [&_>_span]:min-w-0 [&_>_span]:wrap-anywhere">
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
              {!!summary?.items.length && (
                <div
                  className="flex flex-wrap gap-1.5 pt-4"
                  aria-label={t('notebooks.actualItems')}
                >
                  {summary.items.map((id, index) => (
                    <GameEntityIcon
                      key={`${index}:${id}`}
                      kind="item"
                      id={id}
                      version={summary.version}
                      label={
                        assets.data?.find((asset) => asset.resourceId === `item:${id}`)?.name ||
                        t('labels.item', { id })
                      }
                      className="size-9 border border-border"
                    />
                  ))}
                </div>
              )}
            </CardHeader>
            <CardContent className="relative grid gap-3.5">
              <div className="flex items-center justify-between gap-y-3 gap-x-5 flex-wrap [&_[data-ui~=actions]:first-child]:gap-1.5 max-[700.01px]:items-start max-[700.01px]:flex-col">
                <div data-ui="actions" className="flex items-center gap-2">
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
                <div data-ui="actions" className="flex items-center gap-2">
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
              {!current && (
                <p className="text-muted-foreground text-[12px]">{t('review.switchAccount')}</p>
              )}
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
                <p className="text-muted-foreground text-[12px]">
                  {t('review.retryAt', { at: new Date(data.data.retryAt).toLocaleString() })}
                </p>
              )}
              <ErrorNotice error={data.data.lastError} />
              {task.data && (
                <div className="flex items-center gap-2.5 pt-0 px-0 pb-4 text-[12px] text-muted-foreground [&_[role=progressbar]]:max-w-[140px] [&_[role=progressbar]]:h-1 [&_button]:ml-auto">
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
          <Tabs value={section} onValueChange={setSection} className="min-w-0">
            <TabsList className="mb-5 h-11 w-full justify-start rounded-none border-b border-border bg-transparent p-0">
              {['overview', 'timeline', 'notes'].map((section) => (
                <TabsTrigger
                  key={section}
                  value={section}
                  className="h-11 rounded-none border-b-2 border-transparent px-5 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  {t(`review.${section}`)}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent
              value="overview"
              forceMount
              className="hidden space-y-5 data-[state=active]:block"
            >
              {report ? (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle>{t('review.overview')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-5 gap-y-5 gap-x-0 [&_>_div]:grid [&_>_div]:gap-1 [&_>_div]:content-start [&_>_div]:py-0 [&_>_div]:px-[18px] [&_>_div]:border-l [&_>_div]:border-l-border [&_>_div]:min-w-0 min-[1100.01px]:[&>div:nth-child(5n+1)]:border-l-0 min-[1100.01px]:[&>div:nth-child(5n+1)]:pl-0 min-[700.01px]:max-[1100.01px]:[&>div:nth-child(4n+1)]:border-l-0 min-[700.01px]:max-[1100.01px]:[&>div:nth-child(4n+1)]:pl-0 max-[700.01px]:[&>div:nth-child(2n+1)]:border-l-0 max-[700.01px]:[&>div:nth-child(2n+1)]:pl-0 [&_strong]:text-[24px] [&_strong]:leading-[1.4] [&_strong]:font-semibold [&_strong]:tabular-nums [&_strong]:tracking-[-.5px] [&_span]:text-muted-foreground [&_span]:text-[12px] [&_span]:leading-[1.6] [&_small]:text-muted-foreground [&_small]:text-[12px] [&_small]:leading-[1.6] max-[1100.01px]:grid-cols-4 max-[700.01px]:grid-cols-2 ">
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
                  <div className="grid grid-cols-2 gap-y-6 gap-x-8 max-[1000.01px]:grid-cols-1 max-[1000.01px]:gap-5">
                    {report.findings.map((f) => (
                      <Card
                        className="border-0 border-l-2 border-l-border rounded-none bg-transparent pl-[18px]"
                        key={f.id}
                      >
                        <CardHeader className="pt-0 px-0 pb-3 gap-2 [&_[data-slot='card-title']]:flex [&_[data-slot='card-title']]:items-center [&_[data-slot='card-title']]:gap-2 [&_[data-slot='card-title']]:text-[14px] [&_[data-slot='card-title']]:leading-[1.6] [&_[data-slot='card-description']]:text-[13px] [&_[data-slot='card-description']]:leading-[1.8] [&_[data-slot='card-description']]:max-w-[65ch]">
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
                        <CardContent
                          data-ui="review-stack"
                          className="grid grid-cols-1 min-w-0 p-0 gap-2.5"
                        >
                          <div
                            data-ui="actions"
                            className="flex items-center gap-2 gap-y-1 gap-x-3 [&_[data-slot=button]]:p-0 [&_[data-slot=button]]:h-7 [&_[data-slot=button]]:text-primary [&_[data-slot=button]]:text-[12px]"
                          >
                            {f.evidenceIds.map((id) => (
                              <Button
                                key={id}
                                variant="link"
                                size="sm"
                                onClick={() => selectEvidence(id)}
                              >
                                {report.evidence.find((e) => e.id === id)?.timestampMs != null
                                  ? matchTime(
                                      report.evidence.find((e) => e.id === id)!.timestampMs!,
                                    )
                                  : t('review.evidence')}
                              </Button>
                            ))}
                          </div>
                          <div
                            data-ui="actions"
                            className="flex items-center gap-2 [&_[data-slot=button]]:text-muted-foreground [&_[data-slot=button]]:h-7 [&_[data-slot=button]]:text-[12px]"
                          >
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
                            <p className="text-muted-foreground text-[12px]" key={l}>
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
              {report && epoch && (
                <PersonalBaselinePanel reportId={report.id} epoch={epoch} player={playerKey} />
              )}
            </TabsContent>
            <TabsContent value="timeline" forceMount className="hidden data-[state=active]:block">
              <div className="grid min-w-0 items-start gap-5 min-[1280px]:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)]">
                {input && (
                  <Card>
                    <CardHeader>
                      <CardTitle>{t('review.timeline')}</CardTitle>
                      <CardDescription>
                        {t('review.gapsHelp')} · {t('review.targetParticipant')}:{' '}
                        {participantLabel(input.context.targetId)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent data-ui="review-stack" className="grid grid-cols-1 gap-4 min-w-0">
                      <div data-ui="actions" className="flex items-center gap-2">
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
                          <Suspense fallback={<Skeleton className="min-h-40" />}>
                            <Chart
                              data={chart.data}
                              metric={metric}
                              onSelect={selectTime}
                              highlight={
                                search.at == null
                                  ? undefined
                                  : [
                                      Math.max(0, search.at - 60000),
                                      Math.min(input.context.durationMs, search.at + 60000),
                                    ]
                              }
                            />
                          </Suspense>
                        </ChartBoundary>
                      )}
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
                          <div className="max-h-[250px] overflow-auto border-t border-t-border [&_thead]:sticky [&_thead]:top-0 [&_thead]:bg-card [&_thead]:z-1 [&_th]:text-[12px] [&_th]:tabular-nums [&_td]:text-[12px] [&_td]:tabular-nums [&_td_[data-slot=button]]:py-0 [&_td_[data-slot=button]]:px-1 [&_td_[data-slot=button]]:h-7 [&_td_[data-slot=button]]:text-[12px]">
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
                        </CollapsibleContent>
                      </Collapsible>
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
                      <div className="grid max-h-80 overflow-auto">
                        {timeline.data?.events.map((e) => (
                          <div
                            className="flex flex-wrap gap-y-2 gap-x-4 items-center text-[12px] py-2 px-0 border-b border-b-border last:border-b-0 [&_[data-slot=button]]:justify-start [&_[data-slot=button]]:text-primary [&_[data-slot=button]]:py-0 [&_[data-slot=button]]:px-1 [&_[data-slot=button]]:text-[12px] [&_>_span]:text-muted-foreground data-[selected=true]:bg-accent data-[selected=true]:rounded-[var(--radius)]"
                            key={e.id}
                            data-selected={e.id === search.evidence}
                          >
                            <Button
                              variant="ghost"
                              disabled={!report}
                              onClick={() => selectEvidence(e.id)}
                            >
                              {matchTime(e.timestampMs)} ·{' '}
                              {t(`review.event_${e.kind}`, {
                                defaultValue: t('labels.unknownEvent'),
                              })}
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
                                ? assets.data?.find((a) => a.resourceId === `item:${e.itemId}`)
                                    ?.name || t('labels.item', { id: e.itemId })
                                : e.monster
                                  ? codeName(t, 'monster', e.monster)
                                  : e.skillSlot
                                    ? skillName(t, e.skillSlot)
                                    : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div data-ui="actions" className="flex items-center gap-2">
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
                        <Card className="bg-background border-0 [&_pre]:max-h-[260px] [&_pre]:overflow-auto [&_pre]:p-3 [&_pre]:bg-muted [&_pre]:rounded-md [&_pre]:text-[12px] [&_p]:wrap-anywhere">
                          <CardHeader>
                            <CardTitle>{t('review.evidence')}</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <ErrorNotice error={evidence.error} />
                            {evidence.data && (
                              <>
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
                                      {t('review.evidence')}
                                    </Button>
                                  </CollapsibleTrigger>
                                  <CollapsibleContent
                                    forceMount
                                    className="hidden min-w-0 pb-2 data-[state=open]:block"
                                  >
                                    <pre>{JSON.stringify(evidence.data.raw, null, 2)}</pre>
                                  </CollapsibleContent>
                                </Collapsible>
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    setSection('notes');
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
                {report && epoch && (
                  <ReviewEventContext
                    key={`${report.id}:${search.evidence || ''}`}
                    reportId={report.id}
                    epoch={epoch}
                    at={search.at}
                    evidenceId={search.evidence}
                    onSelect={(at, evidence) => {
                      if (evidence) selectEvidence(evidence);
                      else selectTime(at);
                    }}
                  />
                )}
              </div>
            </TabsContent>
            <TabsContent value="notes" forceMount className="hidden data-[state=active]:block">
              <Card>
                <CardHeader>
                  <CardTitle>{t('review.notes')}</CardTitle>
                  <CardDescription>
                    {t(
                      noteEvidence || editing?.evidenceId
                        ? 'labels.evidenceNote'
                        : 'review.matchNote',
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent data-ui="review-stack" className="grid grid-cols-1 gap-4 min-w-0">
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
                    className="min-h-40"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <div data-ui="actions" className="flex items-center gap-2">
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
                    <Card
                      className="bg-background border-0 [&_[data-slot='card-content']]:p-4"
                      key={n.id}
                    >
                      <CardContent>
                        <p
                          data-ui="note-text"
                          className="whitespace-pre-wrap wrap-anywhere leading-[1.8]"
                        >
                          {n.text}
                        </p>
                        <Button
                          variant="outline"
                          onClick={() => createNotebook(n.text, n.reportId, n.evidenceId)}
                        >
                          {t('notebooks.saveReviewNote')}
                        </Button>
                        <small>
                          {t(n.evidenceId ? 'labels.evidenceNote' : 'review.matchNote')} ·{' '}
                          {t('review.revision', { n: n.revision })}
                        </small>
                        <div data-ui="actions" className="flex items-center gap-2">
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
            </TabsContent>
          </Tabs>
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
          <Label>
            {t('matches.champion')}
            <ChampionSelect
              value={
                goalChampion === null ? undefined : goalChampion || summary?.championId || undefined
              }
              onValueChange={(champion) => setGoalChampion(champion || null)}
            />
          </Label>
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
