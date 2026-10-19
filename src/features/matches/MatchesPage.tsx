import { ChampionSelect } from '../../components/ChampionSelect';
import {
  queueName,
  positionName,
  codeName,
  championName,
  matchName,
  errorName,
  playerName,
} from '../../lib/display-names';
import { serverName } from '../../lib/server-name';
import { PlayerSearchFavorites } from '../players/PlayerSearchFavorites';
import { FavoriteButton } from '../players/FavoriteButton';
import { Label } from '../../components/ui/label';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import {
  Swords,
  RefreshCw,
  ArrowRight,
  Download,
  SlidersHorizontal,
  X,
  Clock3,
  Archive,
  CircleHelp,
} from 'lucide-react';
import { matchesRoute, type Search } from '../../app/router';
import { transport } from '../../app/runtime';
import { queryClient } from '../../app/query-client';
import { useWorkspace } from '../../stores/workspace-tabs';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../../components/ui/select';
import { Progress } from '../../components/ui/progress';
import { Button } from '../../components/ui/button';
import { ErrorNotice } from '../../components/ErrorNotice';
import type { MatchSummary } from '../../generated/contracts';
export function MatchesPage() {
  const { t, i18n } = useTranslation();
  const search = matchesRoute.useSearch();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string[]>([]);
  const [filters, setFilters] = useState(search);
  const [taskId, setTaskId] = useState<string | null>(null);
  const filtersEdited = useRef(false);
  useEffect(() => {
    if (!filtersEdited.current) setFilters(search);
  }, [search]);
  function editFilters(next: Search) {
    filtersEdited.current = true;
    setFilters(next);
  }
  const app = useQuery({ queryKey: ['app'], queryFn: () => transport.call('get_app_state', {}) });
  const connection = useQuery({
    queryKey: ['connection'],
    queryFn: () => transport.call('get_connection_state', {}),
  });
  const players = useQuery({
    queryKey: ['players'],
    queryFn: () => transport.call('list_players', {}),
  });
  const playerKey =
    search.player || connection.data?.player?.playerKey || players.data?.[0]?.playerKey;
  const player = players.data?.find((p) => p.playerKey === playerKey);
  const isCurrent = playerKey === connection.data?.player?.playerKey;
  const canSync = !!player && player.serverId === connection.data?.identification?.serverId;
  useEffect(() => setSelected([]), [playerKey]);
  const page = useQuery({
    queryKey: [
      'matches',
      app.data?.workspaceEpoch,
      playerKey,
      search.queue,
      search.champion,
      search.from,
      search.to,
      search.cursor,
      search.position,
      search.patch,
    ],
    queryFn: () =>
      transport.call('list_matches', {
        playerKey: playerKey!,
        queueId: search.queue || null,
        championId: search.champion || null,
        from: search.from ? new Date(`${search.from}T00:00:00`).toISOString() : null,
        to: search.to ? new Date(`${search.to}T23:59:59.999`).toISOString() : null,
        cursor: search.cursor || null,
        pageSize: 50,
        position: search.position,
        patch: search.patch,
      }),
    enabled: !!playerKey,
  });
  useEffect(() => {
    if (!taskId && page.data?.lastTask) setTaskId(page.data.lastTask.id);
  }, [page.data?.lastTask, taskId]);
  const task = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => transport.call('get_task_status', { id: taskId! }),
    enabled: !!taskId,
    refetchInterval: (q) =>
      q.state.data && ['queued', 'running'].includes(q.state.data.state) ? 500 : false,
  });
  const sync = useMutation({
    mutationFn: async () => {
      const settings = await transport.call('get_settings', {});
      return transport.call('sync_player_matches', {
        playerKey: playerKey!,
        pages: settings.syncPages,
      });
    },
    onSuccess: (task) => setTaskId(task.id),
  });
  const cancel = useMutation({
    mutationFn: () => transport.call('cancel_task', { id: taskId! }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task'] }),
  });
  const working = task.data && ['queued', 'running'].includes(task.data.state);
  function filter(next: Search) {
    filtersEdited.current = false;
    setFilters(next);
    void navigate({ to: '/matches', search: { tab: search.tab, player: playerKey, ...next } });
  }
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(date));
  const hasFilters = !!(search.queue || search.champion || search.from || search.to);
  return (
    <div className="page matches-page">
      <div className="page-heading">
        <div>
          <h1>{t('matches.title')}</h1>
        </div>
        <Button
          disabled={
            !canSync || connection.data?.phase !== 'connected' || sync.isPending || !!working
          }
          title={t('matches.sync')}
          onClick={() => sync.mutate()}
        >
          <Download aria-hidden="true" size={16} />
          {t(working ? 'matches.syncing' : 'matches.sync')}
        </Button>
      </div>
      <PlayerSearchFavorites />
      {playerKey && (
        <Card className="player-banner" role="region" aria-label={t('matches.playerOverview')}>
          <div className="player-avatar">
            <Swords aria-hidden="true" size={27} />
          </div>
          <div className="player-identity">
            <h2>{player ? playerName(t, player) : t('common.defaultTab')}</h2>
            <FavoriteButton playerKey={playerKey} />
            <div className="meta-line">
              <span>{serverName(t, player?.serverId)}</span>
              <Badge variant="secondary" className="badge">
                {t(
                  isCurrent && connection.data?.phase === 'connected'
                    ? 'common.current'
                    : 'common.local',
                )}
              </Badge>
            </div>
          </div>
          <div className="player-picker">
            <Label htmlFor="saved-players">{t('matches.openPlayer')}</Label>
            <Select
              disabled={!players.data?.length}
              value=""
              onValueChange={(key) => {
                if (!key) return;
                const id = `matches:${key}`;
                useWorkspace.getState().open({ id, kind: 'matches', playerKey: key, search: '{}' });
                void navigate({ to: '/matches', search: { player: key, tab: id } });
              }}
            >
              <SelectTrigger id="saved-players">
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
          </div>
        </Card>
      )}
      {playerKey && (
        <div className="actions compare-selection">
          <Button
            variant="outline"
            disabled={selected.length !== 2}
            onClick={() => {
              const tab = `compare:${crypto.randomUUID()}`;
              void navigate({
                to: '/compare',
                search: {
                  tab,
                  player: playerKey,
                  leftPlayer: playerKey,
                  rightPlayer: playerKey,
                  left: selected[0],
                  right: selected[1],
                },
              });
            }}
          >
            {t('scouting.compare')} ({selected.length}/2)
          </Button>
          {selected.length > 0 && (
            <Button variant="ghost" onClick={() => setSelected([])}>
              {t('common.reset')}
            </Button>
          )}
        </div>
      )}
      {playerKey && (
        <>
          <div className="history-toolbar">
            <h2>{t('matches.history')}</h2>
            <div className="summary-strip">
              <div>
                <Archive aria-hidden="true" size={16} />
                <strong>{t('matches.savedCount', { count: page.data?.total || 0 })}</strong>
              </div>
              <div>
                <Clock3 aria-hidden="true" size={16} />
                <span>
                  {t('matches.lastSync')}:{' '}
                  {page.data?.coverage ? formatDate(page.data.coverage.lastSync) : '—'}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void queryClient.invalidateQueries({ queryKey: ['matches'] })}
              >
                <RefreshCw aria-hidden="true" size={14} />
                {t('common.refresh')}
              </Button>
            </div>
          </div>
          <form
            className="filter-bar"
            onSubmit={(e) => {
              e.preventDefault();
              filter({ ...filters, cursor: undefined });
            }}
          >
            <SlidersHorizontal aria-hidden="true" size={17} />
            <Label>
              <span>{t('matches.queue')}</span>
              <Select
                value={filters.queue ? String(filters.queue) : 'all'}
                onValueChange={(value) =>
                  editFilters({ ...filters, queue: Number(value) || undefined })
                }
              >
                <SelectTrigger aria-label={t('matches.queue')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('matches.allQueues')}</SelectItem>
                  <SelectItem value="420">{t('matches.ranked')}</SelectItem>
                  <SelectItem value="450">{t('matches.aram')}</SelectItem>
                  <SelectItem value="400">{t('matches.normal')}</SelectItem>
                </SelectContent>
              </Select>
            </Label>
            <Label>
              <span>{t('matches.champion')}</span>
              <ChampionSelect
                value={filters.champion}
                onValueChange={(champion) => editFilters({ ...filters, champion })}
              />
            </Label>
            <Label>
              <span>{t('matches.from')}</span>
              <Input
                type="date"
                value={filters.from || ''}
                max={filters.to || undefined}
                onChange={(e) => editFilters({ ...filters, from: e.target.value || undefined })}
              />
            </Label>
            <Label>
              <span>{t('matches.to')}</span>
              <Input
                type="date"
                value={filters.to || ''}
                min={filters.from || undefined}
                onChange={(e) => editFilters({ ...filters, to: e.target.value || undefined })}
              />
            </Label>
            <Button variant="outline" size="sm" type="submit">
              {t('matches.filter')}
            </Button>
            {hasFilters && (
              <Button
                variant="ghost"
                size="icon"
                type="button"
                aria-label={t('common.reset')}
                title={t('common.reset')}
                onClick={() => filter({})}
              >
                <X aria-hidden="true" size={15} />
              </Button>
            )}
          </form>
        </>
      )}
      {playerKey && connection.data?.phase !== 'connected' && (
        <Alert className="notice">
          <AlertDescription className="notice-content">
            {t('matches.offlineHelp')}{' '}
            <span>{t(`connection.${connection.data?.phase || 'disconnected'}`)}</span>
          </AlertDescription>
        </Alert>
      )}
      <ErrorNotice
        error={page.error || players.error || sync.error || cancel.error || task.data?.error}
      />
      {task.data && (
        <div className="task-progress" aria-live="polite">
          <RefreshCw aria-hidden="true" size={15} className={working ? 'spin' : ''} />
          <span>
            {t('common.task')} · {t(`common.${task.data.state}`)} · {task.data.checkpoint}/
            {task.data.budget}
          </span>
          <Progress
            aria-label={t('common.task')}
            value={task.data.budget ? (task.data.checkpoint / task.data.budget) * 100 : 0}
          />
          {working && (
            <Button
              variant="ghost"
              size="sm"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              {t('common.cancel')}
            </Button>
          )}
        </div>
      )}
      {page.isFetching && !page.data ? (
        <div className="empty-state">
          <RefreshCw aria-hidden="true" className="spin" />
          <p>{t('common.loading')}</p>
        </div>
      ) : !page.data?.items.length ? (
        <div className="empty-state">
          <span className="empty-icon">
            <Swords aria-hidden="true" size={36} strokeWidth={1.2} />
          </span>
          <h2>{t(hasFilters ? 'matches.filterEmpty' : 'matches.emptyTitle')}</h2>
          <p>{t(hasFilters ? 'matches.filterEmptyHelp' : 'matches.emptyHelp')}</p>
          {hasFilters && (
            <Button variant="outline" onClick={() => filter({})}>
              {t('common.reset')}
            </Button>
          )}
        </div>
      ) : (
        <div className="match-list">
          {page.data.items.map((match) => (
            <MatchRow
              key={`${match.playerKey}:${match.matchKey}`}
              match={match}
              selected={selected.includes(match.matchKey)}
              disabled={selected.length >= 2 && !selected.includes(match.matchKey)}
              onSelect={() =>
                setSelected((current) =>
                  current.includes(match.matchKey)
                    ? current.filter((key) => key !== match.matchKey)
                    : current.length < 2
                      ? [...current, match.matchKey]
                      : current,
                )
              }
            />
          ))}
        </div>
      )}
      {!!page.data?.items.length && (
        <footer className="pagination">
          <div className="help">
            {page.data.coverage && (
              <>
                {t('matches.coverage', { count: page.data.coverage.pages })} ·{' '}
                {t(page.data.coverage.exhausted ? 'matches.exhausted' : 'matches.moreHistory')}
              </>
            )}
          </div>
          <div className="actions">
            {search.cursor && (
              <Button variant="outline" onClick={() => filter({ ...search, cursor: undefined })}>
                {t('matches.first')}
              </Button>
            )}
            <Button
              variant="outline"
              disabled={!page.data.nextCursor}
              onClick={() => filter({ ...search, cursor: page.data!.nextCursor! })}
            >
              {t('matches.next')}
              <ArrowRight aria-hidden="true" size={15} />
            </Button>
          </div>
        </footer>
      )}
    </div>
  );
}
function MatchRow({
  match: m,
  selected,
  disabled,
  onSelect,
}: {
  match: MatchSummary;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';
  const assets = useQuery({
    queryKey: ['assets', m.version, locale, m.championId, m.items],
    queryFn: () =>
      transport.call('resolve_assets', {
        version: m.version,
        locale,
        championIds: [m.championId!],
        resourceIds: m.items.map((id) => ({ kind: 'item' as const, id })),
      }),
    enabled: !!m.championId && m.version !== 'unknown',
    staleTime: Infinity,
    retry: false,
  });
  const asset = assets.data?.find((a) => a.resourceId === `champion:${m.championId}`);
  const queue = queueName(t, m.queueId);
  const kda = [m.kills, m.deaths, m.assists].map((n) => n ?? '—');
  return (
    <Card className={`match-row outcome-${m.outcome}`}>
      <div className="outcome">
        <strong>{t(`matches.${m.outcome}`)}</strong>
        <small title={queue}>{queue}</small>
        <span>
          <Clock3 aria-hidden="true" size={11} />
          {m.duration != null
            ? `${Math.floor(m.duration / 60)}:${String(m.duration % 60).padStart(2, '0')}`
            : '—'}
        </span>
      </div>
      <div className="champion-icon">
        {asset?.reference ? (
          <img src={asset.reference} alt="" />
        ) : (
          <CircleHelp aria-hidden="true" size={26} />
        )}
      </div>
      <div className="champion-info">
        <strong>{asset?.name || championName(t, m.championId)}</strong>
        <small>
          {positionName(t, m.position)} · {t('matches.cs')} {m.cs ?? '—'}
        </small>
      </div>
      <div className="kda">
        <strong>
          {kda[0]} <span>/</span> <span className="deaths">{kda[1]}</span> <span>/</span> {kda[2]}
        </strong>
        <small>KDA</small>
      </div>
      <div className="equipment" aria-label={t('matches.items')} title={t('matches.items')}>
        {Array.from({ length: 6 }, (_, i) => m.items[i] || 0).map((id, i) => (
          <span
            key={`${i}:${id}`}
            className={!id ? 'empty-item' : ''}
            title={
              id
                ? assets.data?.find((a) => a.resourceId === `item:${id}`)?.name ||
                  t('common.unknown', { id })
                : t('matches.emptyItem')
            }
          >
            {assets.data?.find((a) => a.resourceId === `item:${id}`)?.reference ? (
              <img
                src={assets.data.find((a) => a.resourceId === `item:${id}`)!.reference!}
                alt={
                  assets.data?.find((a) => a.resourceId === `item:${id}`)?.name ||
                  t('labels.item', { id })
                }
              />
            ) : id ? (
              <CircleHelp aria-hidden="true" size={14} />
            ) : null}
          </span>
        ))}
      </div>
      <div className="match-meta">
        <time>
          {new Intl.DateTimeFormat(i18n.language, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(m.startedAt))}
        </time>
        <small
          title={`${t('matches.version')}: ${m.version} / ${t('matches.source')}: ${codeName(t, 'source', m.source)}`}
        >
          {t('matches.version')} {m.version}
        </small>
        {m.fallbackReason && (
          <small title={t('matches.fallback', { reason: errorName(t, m.fallbackReason) })}>
            {t('matches.source')}: {codeName(t, 'source', 'lcu')}
          </small>
        )}
      </div>
      <div className="match-review-action">
        <Button
          size="sm"
          variant={selected ? 'default' : 'outline'}
          aria-pressed={selected}
          aria-label={`${t('scouting.selectCompare')} ${matchName(t, m.matchKey)}`}
          disabled={disabled}
          onClick={onSelect}
        >
          {t('scouting.selectCompare')}
        </Button>
        <Badge variant="outline">{t(`review.list_${m.reviewState || 'missing'}`)}</Badge>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void navigate({
              to: '/matches/$matchKey/review',
              params: { matchKey: m.matchKey },
              search: { player: m.playerKey },
            })
          }
        >
          {t('review.open')}
        </Button>
      </div>
      <span className="match-state" title={m.kills == null ? t('matches.dataMissing') : undefined}>
        {m.kills == null && <CircleHelp aria-hidden="true" size={16} />}
      </span>
    </Card>
  );
}
