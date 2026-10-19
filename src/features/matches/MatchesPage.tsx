import { matchOutcomeClasses } from '../../lib/match-outcome';
import { MatchPreparationPanel } from './MatchPreparationPanel';
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
    <div
      data-ui="page matches-page"
      className="max-w-[1400px] pt-[30px] px-9 pb-[26px] m-auto max-[1150.01px]:p-[26px] max-[900.01px]:p-[22px] max-[650.01px]:py-[18px] max-[650.01px]:px-4"
    >
      <div
        data-ui="page-heading"
        className="flex items-center justify-between gap-6 mb-7 max-[650.01px]:mb-[22px] max-[650.01px]:gap-2.5"
      >
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
        <Card
          data-ui="player-banner"
          className="pt-0 px-0 pb-[26px] flex items-center gap-4 border-0 border-b border-b-border rounded-none shadow-none bg-transparent max-[650.01px]:flex-wrap max-[650.01px]:gap-3"
          role="region"
          aria-label={t('matches.playerOverview')}
        >
          <div className="w-14 h-14 shrink-0 rounded-xl bg-accent text-primary grid place-items-center">
            <Swords aria-hidden="true" size={27} />
          </div>
          <div
            data-ui="player-identity"
            className="min-w-0 [&_h2]:text-[24px] [&_h2]:font-semibold [&_h2]:tracking-[-.5px] [&_h2]:overflow-hidden [&_h2]:text-ellipsis [&_h2]:whitespace-nowrap max-[650.01px]:[&_h2]:text-[20px]"
          >
            <h2>{player ? playerName(t, player) : t('common.defaultTab')}</h2>
            <FavoriteButton playerKey={playerKey} />
            <div className="flex items-center gap-2.5 text-[12px] text-muted-foreground mt-[5px]">
              <span>{serverName(t, player?.serverId)}</span>
              <Badge
                variant="secondary"
                data-ui="badge"
                className="rounded-sm text-[10px] leading-[1.3333333333] py-0.5 px-1.5 font-medium"
              >
                {t(
                  isCurrent && connection.data?.phase === 'connected'
                    ? 'common.current'
                    : 'common.local',
                )}
              </Badge>
            </div>
          </div>
          <div className="ml-auto w-[230px] min-w-0 grid gap-1.5 [&_label]:text-muted-foreground [&_label]:text-[12px] max-[900.01px]:w-[190px] max-[650.01px]:w-full max-[650.01px]:mt-1.5 max-[650.01px]:mx-0 max-[650.01px]:mb-0">
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
        <div data-ui="actions" className="flex items-center gap-2 justify-end">
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
            {t('scouting.compare')}
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
          <div className="flex items-center justify-between gap-5 pt-6 px-0 pb-4">
            <h2>{t('matches.history')}</h2>
            <div className="flex items-center gap-[18px] text-[12px] text-muted-foreground [&_>_div]:flex [&_>_div]:items-center [&_>_div]:gap-1.5 [&_svg]:w-3.5 [&_svg]:h-3.5 [&_strong]:text-foreground [&_strong]:font-medium [&_[data-slot=button]]:pt-1 [&_[data-slot=button]]:pr-0 [&_[data-slot=button]]:pb-1 [&_[data-slot=button]]:pl-1.5 max-[900.01px]:[&_>_div:nth-child(2)]:hidden">
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
            className="flex items-end gap-2.5 mb-5 flex-wrap [&_>_svg]:text-muted-foreground [&_>_svg]:mt-0 [&_>_svg]:mr-0.5 [&_>_svg]:mb-[9px] [&_>_svg]:ml-0 [&_label]:grid [&_label]:gap-1.5 [&_label]:flex-1 [&_label]:min-w-[125px] [&_label]:max-w-[200px] [&_label_>_span]:text-[12px] [&_label_>_span]:text-muted-foreground [&_input]:w-full [&_input]:h-9 [&_input]:bg-card [&_input]:text-[12px] [&_input]:shadow-none [&_button[role=combobox]]:w-full [&_button[role=combobox]]:h-9 [&_button[role=combobox]]:bg-card [&_button[role=combobox]]:text-[12px] [&_button[role=combobox]]:shadow-none [&_>_[data-slot=button]]:h-9 max-[650.01px]:[&_label]:min-w-[125px] max-[650.01px]:[&_label]:max-w-none max-[650.01px]:[&_>_svg]:hidden"
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
        <Alert className="rounded-[7px] bg-card text-muted-foreground py-3 px-3.5 text-[12px] my-3.5 mx-0 data-[error=true]:bg-(--loss-bg) data-[error=true]:text-destructive data-[error=true]:border-destructive [&[data-error=true]_small]:block [&[data-error=true]_small]:text-inherit [&[data-error=true]_small]:wrap-anywhere [&[data-error=true]_small]:mt-1">
          <AlertDescription className="flex justify-between gap-3 flex-wrap">
            {t('matches.offlineHelp')}{' '}
            <span>{t(`connection.${connection.data?.phase || 'disconnected'}`)}</span>
          </AlertDescription>
        </Alert>
      )}
      <ErrorNotice
        error={page.error || players.error || sync.error || cancel.error || task.data?.error}
      />
      {task.data && (
        <div
          className="flex items-center gap-2.5 pt-0 px-0 pb-4 text-[12px] text-muted-foreground [&_[role=progressbar]]:max-w-[140px] [&_[role=progressbar]]:h-1 [&_button]:ml-auto"
          aria-live="polite"
        >
          <RefreshCw
            aria-hidden="true"
            size={15}
            className={working ? 'animate-[spin_1.5s_linear_infinite]' : ''}
          />
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
        <div className="min-h-[360px] flex items-center justify-center flex-col text-center gap-3 py-[35px] px-6 [&_p]:text-muted-foreground [&_p]:max-w-[370px] [&_p]:text-[13px] [&_p]:leading-[1.8] [&_h2]:text-[19px] [&_h2]:font-semibold">
          <RefreshCw aria-hidden="true" className="animate-[spin_1.5s_linear_infinite]" />
          <p>{t('common.loading')}</p>
        </div>
      ) : !page.data?.items.length ? (
        <div className="min-h-[360px] flex items-center justify-center flex-col text-center gap-3 py-[35px] px-6 [&_p]:text-muted-foreground [&_p]:max-w-[370px] [&_p]:text-[13px] [&_p]:leading-[1.8] [&_h2]:text-[19px] [&_h2]:font-semibold">
          <span className="grid place-items-center w-16 h-16 rounded-2xl text-primary mb-2 bg-accent">
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
        <div className="grid gap-2">
          {page.data.items.map((match) => (
            <MatchRow
              key={`${match.playerKey}:${match.matchKey}`}
              match={match}
              selected={selected.includes(match.matchKey)}
              disabled={selected.length >= 20 && !selected.includes(match.matchKey)}
              onSelect={() =>
                setSelected((current) =>
                  current.includes(match.matchKey)
                    ? current.filter((key) => key !== match.matchKey)
                    : current.length < 20
                      ? [...current, match.matchKey]
                      : current,
                )
              }
            />
          ))}
        </div>
      )}
      {playerKey && app.data?.workspaceEpoch && (
        <MatchPreparationPanel
          epoch={app.data.workspaceEpoch}
          player={playerKey}
          selected={selected}
        />
      )}
      {!!page.data?.items.length && (
        <footer className="flex items-center justify-between mt-5 gap-4 max-[650.01px]:flex-wrap">
          <div className="text-muted-foreground text-[12px]">
            {page.data.coverage && (
              <>
                {t('matches.coverage', { count: page.data.coverage.pages })} ·{' '}
                {t(page.data.coverage.exhausted ? 'matches.exhausted' : 'matches.moreHistory')}
              </>
            )}
          </div>
          <div data-ui="actions" className="flex items-center gap-2">
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
    <Card
      data-ui="match-row"
      className={`flex items-center gap-5 py-[15px] px-[18px] border border-border border-l-3 border-l-(--outcome) rounded-[7px] shadow-none bg-card min-w-0 min-h-[88px] flex-wrap hover:bg-(--row-bg) max-[1150.01px]:gap-3.5 max-[1150.01px]:p-3.5 max-[900.01px]:gap-3 max-[650.01px]:gap-2.5 max-[650.01px]:flex-wrap max-[650.01px]:p-3 ${matchOutcomeClasses[m.outcome]}`}
    >
      <div className="grid [flex:0_0_110px] min-w-0 gap-[3px] [&_strong]:text-(--outcome) [&_strong]:text-[15px] [&_strong]:font-[650] [&_small]:text-[12px] [&_small]:overflow-hidden [&_small]:text-ellipsis [&_small]:whitespace-nowrap [&_span]:text-muted-foreground [&_span]:text-[11px] [&_span]:flex [&_span]:items-center [&_span]:gap-[5px] max-[1150.01px]:basis-[100px] max-[650.01px]:basis-20">
        <strong>{t(`matches.${m.outcome}`)}</strong>
        <small title={queue}>{queue}</small>
        <span>
          <Clock3 aria-hidden="true" size={11} />
          {m.duration != null
            ? `${Math.floor(m.duration / 60)}:${String(m.duration % 60).padStart(2, '0')}`
            : '—'}
        </span>
      </div>
      <div className="w-12 h-12 bg-muted text-muted-foreground border border-input rounded-[10px] grid place-items-center shrink-0 overflow-hidden [&_img]:w-full [&_img]:h-full [&_img]:object-cover [&_img]:scale-[1.08] max-[900.01px]:w-[42px] max-[900.01px]:h-[42px]">
        {asset?.reference ? (
          <img src={asset.reference} alt="" />
        ) : (
          <CircleHelp aria-hidden="true" size={26} />
        )}
      </div>
      <div className="grid min-w-[88px] flex-1 [&_strong]:text-[14px] [&_strong]:font-semibold [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap [&_small]:text-[11px] [&_small]:mt-1 max-[900.01px]:min-w-20 max-[650.01px]:min-w-[65px]">
        <strong>{asset?.name || championName(t, m.championId)}</strong>
        <small>
          {positionName(t, m.position)} · {t('matches.cs')} {m.cs ?? '—'}
        </small>
      </div>
      <div className="min-w-[115px] grid text-center [&_strong]:text-[20px] [&_strong]:font-semibold [&_strong]:tabular-nums [&_strong]:whitespace-nowrap [&_strong_span]:text-muted-foreground [&_strong_span]:text-[16px] [&_strong_span]:font-normal [&_strong_[data-ui~=deaths]]:text-(--loss) [&_strong_[data-ui~=deaths]]:text-[20px] [&_strong_[data-ui~=deaths]]:font-medium [&_small]:text-[10px] [&_small]:mt-0.5 max-[900.01px]:min-w-[100px] max-[900.01px]:[&_strong]:text-[18px] max-[900.01px]:[&_strong_[data-ui~=deaths]]:text-[18px] max-[650.01px]:ml-auto max-[650.01px]:min-w-[85px]">
        <strong>
          {kda[0]} <span>/</span> <span data-ui="deaths">{kda[1]}</span> <span>/</span> {kda[2]}
        </strong>
        <small>KDA</small>
      </div>
      <div
        className="grid grid-cols-[repeat(6,_28px)] gap-[3px] ml-auto [&_>_span]:grid [&_>_span]:place-items-center [&_>_span]:w-7 [&_>_span]:h-7 [&_>_span]:bg-muted [&_>_span]:border [&_>_span]:border-border [&_>_span]:rounded-sm [&_>_span]:text-muted-foreground [&_>_span]:overflow-hidden [&_img]:block [&_img]:w-full [&_img]:h-full [&_img]:object-cover max-[1150.01px]:grid-cols-[repeat(3,_24px)] max-[1150.01px]:[&_>_span]:w-6 max-[1150.01px]:[&_>_span]:h-6 max-[650.01px]:hidden"
        aria-label={t('matches.items')}
        title={t('matches.items')}
      >
        {Array.from({ length: 6 }, (_, i) => m.items[i] || 0).map((id, i) => (
          <span
            key={`${i}:${id}`}
            className={!id ? 'opacity-50' : ''}
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
      <div className="grid text-right min-w-[115px] text-[12px] gap-1.5 text-muted-foreground [&_small]:text-[10px] max-[1150.01px]:min-w-[100px] max-[900.01px]:min-w-[94px] max-[900.01px]:text-[11px] max-[650.01px]:w-full max-[650.01px]:flex max-[650.01px]:justify-end max-[650.01px]:border-t max-[650.01px]:border-t-border max-[650.01px]:pt-2">
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
      <div className="grid gap-1.5 justify-items-center pr-3 max-[1000.01px]:flex max-[1000.01px]:w-full max-[1000.01px]:justify-end max-[1000.01px]:py-1 max-[1000.01px]:px-4">
        <Button
          size="sm"
          variant={selected ? 'default' : 'outline'}
          aria-pressed={selected}
          aria-label={`${t('training.selectMatch')} ${matchName(t, m.matchKey)}`}
          disabled={disabled}
          onClick={onSelect}
        >
          {t('training.selectMatch')}
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
      <span
        className="text-(--outcome) w-4 shrink-0 empty:hidden"
        title={m.kills == null ? t('matches.dataMissing') : undefined}
      >
        {m.kills == null && <CircleHelp aria-hidden="true" size={16} />}
      </span>
    </Card>
  );
}
