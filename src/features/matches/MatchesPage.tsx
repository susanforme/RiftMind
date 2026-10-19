import { MatchPreparationPanel } from './MatchPreparationPanel';
import { ChampionSelect } from '../../components/ChampionSelect';
import { playerName } from '../../lib/display-names';
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
  Search as SearchIcon,
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
import { portraitCatalogueVersion } from '../../components/GameEntityIcon';
import { PlayerAvatar } from '../players/PlayerAvatar';
import { ChampionArtwork, selectedChampionSkin } from '../../components/ChampionArtwork';
import { Skeleton } from '../../components/ui/skeleton';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../../components/ui/dialog';
import {
  groupMatchesByDate,
  recentMatchStats,
  MatchHistoryRow,
  MatchDetails,
} from './MatchHistory';
export function MatchesPage() {
  const { t, i18n } = useTranslation();
  const search = matchesRoute.useSearch();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [playerSearchOpen, setPlayerSearchOpen] = useState(false);
  const [selectedSkins, setSelectedSkins] = useState<Record<number, number>>({});
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
  const hasFilters = !!(
    search.queue ||
    search.champion ||
    search.from ||
    search.to ||
    search.position ||
    search.patch
  );
  const matches = page.data?.items || [];
  const activeMatch = matches.find((match) => match.matchKey === search.match) || matches[0];
  const stats = recentMatchStats(matches);
  const artworkVersion =
    activeMatch?.version && activeMatch.version !== 'unknown'
      ? activeMatch.version
      : portraitCatalogueVersion;
  const artworkLocale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';
  const skins = useQuery({
    queryKey: ['champion-skins', artworkVersion, artworkLocale, activeMatch?.championId],
    queryFn: () =>
      transport.call('get_champion_skins', {
        championId: activeMatch!.championId!,
        version: artworkVersion,
        locale: artworkLocale,
      }),
    enabled: !!activeMatch?.championId,
    staleTime: Infinity,
    retry: false,
  });
  const skin = selectedChampionSkin(
    skins.data?.skins || [],
    activeMatch?.championId ? selectedSkins[activeMatch.championId] : undefined,
  );
  return (
    <div
      data-ui="page matches-page"
      className="mx-auto grid w-full max-w-[1800px] min-w-0 gap-4 p-6 max-[900px]:gap-4 max-[900px]:p-4"
    >
      <div data-ui="page-heading" className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t('matches.title')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={playerSearchOpen} onOpenChange={setPlayerSearchOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <SearchIcon aria-hidden="true" />
                {t('matches.findPlayer')}
              </Button>
            </DialogTrigger>
            <DialogContent
              closeLabel={t('common.close')}
              aria-describedby={undefined}
              className="max-w-2xl"
            >
              <DialogTitle>{t('scouting.searchPlayer')}</DialogTitle>
              <PlayerSearchFavorites onOpen={() => setPlayerSearchOpen(false)} />
            </DialogContent>
          </Dialog>
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
      </div>
      {playerKey && (
        <Card
          data-ui="player-banner"
          className="relative flex min-h-52 flex-wrap items-center gap-5 overflow-hidden border border-border bg-card p-6 max-[900px]:min-h-44 max-[900px]:p-4"
          role="region"
          aria-label={t('matches.playerOverview')}
        >
          <ChampionArtwork skin={skin} version={artworkVersion} banner />
          <div className="relative z-10">
            <PlayerAvatar player={player} />
          </div>
          <div
            data-ui="player-identity"
            className="relative z-10 min-w-0 [&_h2]:text-[24px] [&_h2]:font-semibold [&_h2]:tracking-[-.5px] [&_h2]:overflow-hidden [&_h2]:text-ellipsis [&_h2]:whitespace-nowrap max-[650.01px]:[&_h2]:text-[20px]"
          >
            <div className="flex items-center gap-2">
              <h2>{player ? playerName(t, player) : t('common.defaultTab')}</h2>
              <FavoriteButton playerKey={playerKey} />
            </div>
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
          {!!matches.length && (
            <div className="relative z-10 flex flex-wrap items-center gap-5 border-l border-border pl-5 max-[900px]:order-3 max-[900px]:w-full max-[900px]:border-l-0 max-[900px]:border-t max-[900px]:pt-4 max-[900px]:pl-0">
              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">
                  {t('matches.pageSummary', { count: matches.length })}
                </span>
                <div className="flex gap-3 text-lg font-semibold tabular-nums">
                  <span className="text-(--win)">
                    {stats.wins} {t('matches.win')}
                  </span>
                  <span className="text-(--loss)">
                    {stats.losses} {t('matches.loss')}
                  </span>
                </div>
              </div>
              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">{t('matches.winRate')}</span>
                <strong className="text-xl tabular-nums">
                  {stats.winRate === null ? '—' : `${stats.winRate}%`}
                </strong>
              </div>
              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">KDA</span>
                <strong className="text-xl tabular-nums">{stats.kda ?? '—'}</strong>
              </div>
            </div>
          )}
          <div className="relative z-10 ml-auto grid w-52 min-w-0 gap-1.5 rounded-lg bg-card/90 p-3 [&_label]:text-xs [&_label]:text-muted-foreground max-[650px]:w-full">
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
            {!!skins.data?.skins.length && (
              <>
                <Label htmlFor="champion-artwork-skin">{t('matches.artwork')}</Label>
                <Select
                  value={skin ? String(skin.id) : ''}
                  onValueChange={(value) => {
                    if (activeMatch?.championId)
                      setSelectedSkins((current) => ({
                        ...current,
                        [activeMatch.championId!]: Number(value),
                      }));
                  }}
                >
                  <SelectTrigger id="champion-artwork-skin">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {skins.data.skins.map((option) => (
                      <SelectItem key={option.id} value={String(option.id)}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>
        </Card>
      )}
      {playerKey && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{t('matches.history')}</h2>
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
            className="flex items-end gap-2.5 flex-wrap [&_>_svg]:text-muted-foreground [&_>_svg]:mt-0 [&_>_svg]:mr-0.5 [&_>_svg]:mb-[9px] [&_>_svg]:ml-0 [&_label]:grid [&_label]:gap-1.5 [&_label]:flex-1 [&_label]:min-w-[125px] [&_label]:max-w-[200px] [&_label_>_span]:text-[12px] [&_label_>_span]:text-muted-foreground [&_input]:w-full [&_input]:h-9 [&_input]:bg-card [&_input]:text-[12px] [&_input]:shadow-none [&_button[role=combobox]]:w-full [&_button[role=combobox]]:h-9 [&_button[role=combobox]]:bg-card [&_button[role=combobox]]:text-[12px] [&_button[role=combobox]]:shadow-none [&_>_[data-slot=button]]:h-9 max-[650.01px]:[&_label]:min-w-[125px] max-[650.01px]:[&_label]:max-w-none max-[650.01px]:[&_>_svg]:hidden"
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
        <div className="grid gap-3" aria-label={t('common.loading')}>
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-24 w-full rounded-lg" />
          ))}
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
        <div className="grid min-w-0 items-start gap-6 min-[1280px]:grid-cols-[minmax(0,1fr)_340px] min-[1600px]:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0 space-y-5" aria-label={t('matches.history')}>
            {groupMatchesByDate(matches, i18n.language).map((group) => (
              <section key={group.date} className="min-w-0">
                <h3 className="mb-1 rounded-md bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                  {group.date}
                </h3>
                <div className="divide-y divide-border/60">
                  {group.matches.map((match) => (
                    <MatchHistoryRow
                      key={`${match.playerKey}:${match.matchKey}`}
                      match={match}
                      active={activeMatch?.matchKey === match.matchKey}
                      selected={selected.includes(match.matchKey)}
                      disabled={selected.length >= 20 && !selected.includes(match.matchKey)}
                      onInspect={() => {
                        void navigate({
                          to: '/matches',
                          search: { ...search, match: match.matchKey },
                          replace: true,
                          resetScroll: false,
                        });
                        if (window.matchMedia('(max-width: 1279px)').matches) setDetailsOpen(true);
                      }}
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
              </section>
            ))}
          </div>
          {activeMatch && (
            <aside className="sticky top-6 hidden min-w-0 min-[1280px]:block">
              <MatchDetails
                key={`${activeMatch.playerKey}:${activeMatch.matchKey}`}
                match={activeMatch}
                skin={skin}
                workspaceEpoch={app.data?.workspaceEpoch}
              />
            </aside>
          )}
          <Dialog open={detailsOpen && !!activeMatch} onOpenChange={setDetailsOpen}>
            <DialogContent
              closeLabel={t('common.close')}
              aria-describedby={undefined}
              className="p-4"
            >
              <DialogTitle>{t('matches.details')}</DialogTitle>
              {activeMatch && (
                <MatchDetails
                  key={`${activeMatch.playerKey}:${activeMatch.matchKey}`}
                  match={activeMatch}
                  skin={skin}
                  workspaceEpoch={app.data?.workspaceEpoch}
                />
              )}
            </DialogContent>
          </Dialog>
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
