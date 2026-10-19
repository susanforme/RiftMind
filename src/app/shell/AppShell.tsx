import { useNotebookDrafts } from '../../features/champion-notes/notebook-drafts';
import { matchName, playerName } from '../../lib/display-names';
import { serverName } from '../../lib/server-name';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Swords,
  BookOpen,
  UsersRound,
  UserRound,
  History,
  ChartNoAxesCombined,
  Settings2,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
  Monitor,
  Wifi,
  WifiOff,
  X,
  ChevronLeft,
  ChevronRight,
  RotateCw,
} from 'lucide-react';
import { transport } from '../runtime';
import { queryClient } from '../query-client';
import { useWorkspace, defaultTab } from '../../stores/workspace-tabs';
import type { ColorMode, WorkspaceTab } from '../../generated/contracts';
import { type Search } from '../router';
import {
  readWorkspaceSearch as safeSearch,
  workspaceTabForLocation,
} from '../workspace-navigation';
import { WorkspacePages } from './WorkspacePages';
import { invalidateWorkspaceTabQueries } from '../workspace-refresh';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '../../components/ui/context-menu';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/dialog';
import { Textarea } from '../../components/ui/textarea';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorNotice } from '../../components/ErrorNotice';
import { TitleBar } from './TitleBar';
import { RuntimeEffects } from '../providers';
const DevToolbar =
  import.meta.env.DEV &&
  import.meta.env.MODE === 'development' &&
  import.meta.env.VITE_DEV_TOOLS === 'true'
    ? lazy(() => import('../dev/DevToolbar'))
    : null;
const colorModeCycle: Record<ColorMode, { icon: typeof Sun; next: ColorMode }> = {
  light: { icon: Sun, next: 'dark' },
  dark: { icon: Moon, next: 'system' },
  system: { icon: Monitor, next: 'light' },
};
const sidebarNavigationClassName =
  'relative justify-start w-full h-12 my-1 py-3 px-3 gap-3 text-sm data-[selected=true]:bg-accent data-[selected=true]:text-primary before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-full data-[selected=true]:before:bg-primary [[data-collapsed=true]_&]:p-2 [[data-collapsed=true]_&]:justify-center forced-colors:data-[selected=true]:border forced-colors:data-[selected=true]:border-[ButtonText]';
export function AppShell() {
  const notebookDrafts = useNotebookDrafts((state) => state.drafts);
  useEffect(() => {
    if (!Object.keys(notebookDrafts).length) return;
    const protect = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [notebookDrafts]);
  const workspaceChanged = useWorkspace((s) => s.workspaceChanged);
  const previousDrafts = useWorkspace((s) => s.reviewDrafts);
  const [showPreviousDrafts, setShowPreviousDrafts] = useState(false);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useRouterState({ select: (s) => s.location });
  const { tabs, setTabs, open, reorder, dirty, setDraft } = useWorkspace();
  const [refreshRevisions, setRefreshRevisions] = useState<Record<string, number>>({});
  function refreshTab(tab: WorkspaceTab) {
    void invalidateWorkspaceTabQueries(tab);
    setRefreshRevisions((revisions) => ({
      ...revisions,
      [tab.id]: (revisions[tab.id] || 0) + 1,
    }));
  }
  const activeTab = useMemo(
    () => workspaceTabForLocation(location.pathname, location.search as Search),
    [location.pathname, location.search],
  );
  const activeId = activeTab.id;
  const app = useQuery({
    queryKey: ['app'],
    queryFn: () => transport.call('get_app_state', {}),
    refetchInterval: (q) =>
      q.state.data && ['booting', 'migrating'].includes(q.state.data.phase) ? 300 : false,
  });
  const recovery = useMutation({
    mutationFn: (action: 'restore_backup' | 'export_diagnostics') =>
      action === 'restore_backup'
        ? transport.call(action, { id: 'native-dialog' })
        : transport.call(action, {}),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => transport.call('get_settings', {}),
    enabled: app.data?.phase === 'ready',
    retry: (count, error) => (error as { code?: string }).code === 'APP_NOT_READY' && count < 5,
    retryDelay: 300,
  });
  const connection = useQuery({
    queryKey: ['connection'],
    queryFn: () => transport.call('get_connection_state', {}),
    refetchInterval: 10_000,
  });
  const players = useQuery({
    queryKey: ['players'],
    queryFn: () => transport.call('list_players', {}),
  });
  const [pending, setPending] = useState<(() => void) | null>(null);
  const initialized = useRef(false);
  const drag = useRef<string | null>(null);
  const previousPlayer = useRef<string | undefined>(undefined);
  const save = useMutation({
    mutationFn: async (patch: {
      sidebarCollapsed?: boolean;
      colorModePreference?: 'light' | 'dark' | 'system';
      workspaceTabs?: WorkspaceTab[];
      activeTab?: string;
    }) => {
      const latest = await transport.call('get_settings', {});
      if (patch.workspaceTabs && useWorkspace.getState().dirty) return latest;
      return transport.call('update_settings', {
        expectedRevision: latest.revision,
        patch: {
          languagePreference: null,
          themeId: null,
          colorModePreference: null,
          sidebarCollapsed: null,
          closeBehavior: null,
          autoConnect: null,
          autoSync: null,
          syncPages: null,
          workspaceTabs: null,
          activeTab: null,
          ...patch,
        },
      });
    },
    onSuccess: (value) => queryClient.setQueryData(['settings'], value),
  });
  const workspaceReady = !!settings.data && !!players.data;
  function activate(tab: WorkspaceTab) {
    open(tab);
    const search = safeSearch(tab);
    if (tab.kind === 'notebooks') {
      void navigate({ to: '/notebooks', search });
      return;
    }
    if (
      tab.kind === 'live' ||
      tab.kind === 'champions' ||
      tab.kind === 'compare' ||
      tab.kind === 'players'
    ) {
      void navigate({
        to:
          tab.kind === 'players'
            ? '/players'
            : tab.kind === 'live'
              ? '/live'
              : tab.kind === 'champions'
                ? '/champions'
                : '/compare',
        search: { ...search, tab: tab.id, player: tab.playerKey || undefined },
      });
      return;
    }
    if (tab.kind === 'review' && search.match) {
      void navigate({
        to: '/matches/$matchKey/review',
        params: { matchKey: search.match },
        search: { ...search, player: tab.playerKey || undefined },
      });
      return;
    }
    if (tab.kind === 'progress') {
      void navigate({ to: '/progress', search: { ...search, player: tab.playerKey || undefined } });
      return;
    }
    void navigate(
      tab.kind === 'settings'
        ? { to: '/settings' }
        : {
            to: '/matches',
            search: { ...safeSearch(tab), tab: tab.id, player: tab.playerKey || undefined },
          },
    );
  }
  useEffect(() => {
    if (!workspaceReady) return;
    if (
      initialized.current &&
      tabs.length > 1 &&
      activeId.startsWith('matches:') &&
      tabs.some((tab) => tab.id === 'matches' && !tab.playerKey)
    ) {
      setTabs(tabs.filter((tab) => tab.id !== 'matches'));
      return;
    }
    if (
      initialized.current &&
      activeId.startsWith('champions:') &&
      activeId !== 'champions:current' &&
      tabs.some((tab) => tab.id === 'champions:current' && !tab.playerKey)
    ) {
      setTabs(tabs.filter((tab) => tab.id !== 'champions:current'));
      return;
    }
    const tab = activeTab;
    if (!initialized.current) {
      initialized.current = true;
      setTabs([tab]);
    } else if (!tabs.some((item) => item.id === tab.id)) open(tab);
    else if (tabs.find((item) => item.id === tab.id)?.search !== tab.search)
      setTabs(tabs.map((item) => (item.id === tab.id ? tab : item)));
  }, [
    activeId,
    location.href,
    tabs,
    open,
    setTabs,
    location.pathname,
    location.search,
    workspaceReady,
    activeTab,
  ]);
  useEffect(() => {
    const p = connection.data?.player;
    if (!p || !initialized.current || previousPlayer.current === p.playerKey) return;
    const before = previousPlayer.current;
    previousPlayer.current = p.playerKey;
    const tab: WorkspaceTab = {
      id: `matches:${p.playerKey}`,
      kind: 'matches',
      playerKey: p.playerKey,
      search: '{}',
    };
    if (
      location.pathname === '/matches' &&
      (!(location.search as Search).player || (before && before !== p.playerKey))
    )
      activate(tab);
  });
  useEffect(() => {
    if (!initialized.current || dirty) return;
    const timer = setTimeout(() => {
      save.mutate({ workspaceTabs: tabs, activeTab: activeId });
    }, 500);
    return () => clearTimeout(timer);
  }, [tabs, activeId, dirty]);
  const [noteClose, setNoteClose] = useState<{ action: () => void; keys: string[] } | null>(null);
  const [noteCloseError, setNoteCloseError] = useState<unknown>(null);
  const [savingNotes, setSavingNotes] = useState(false);
  async function saveClosingNotes() {
    if (!noteClose) return;
    setSavingNotes(true);
    setNoteCloseError(null);
    try {
      for (const key of noteClose.keys) {
        const d = useWorkspace.getState().reviewDrafts[key];
        if (!d) continue;
        if (d.epoch !== app.data?.workspaceEpoch) throw { code: 'SESSION_CHANGED' };
        await transport.call('save_review_note', {
          workspaceEpoch: d.epoch,
          id: d.note?.id || null,
          matchKey: d.matchKey,
          playerKey: d.playerKey,
          reportId: d.reportId,
          evidenceId: d.evidenceId,
          text: d.text,
          expectedRevision: d.note?.revision || 0,
        });
        useWorkspace.getState().setReviewDraft(key, null);
      }
      noteClose.action();
      setNoteClose(null);
    } catch (error) {
      setNoteCloseError(error);
    } finally {
      setSavingNotes(false);
    }
  }
  function closeSet(ids: string[]) {
    const action = () => {
      const next = tabs.filter((tab) => !ids.includes(tab.id));
      setTabs(next);
      if (ids.includes('settings')) setDraft(null, false);
      if (ids.includes(activeId)) {
        const index = tabs.findIndex((tab) => tab.id === activeId);
        activate(
          [...tabs.slice(0, index)].reverse().find((tab) => !ids.includes(tab.id)) ||
            next[0] ||
            (() => {
              const player = connection.data?.player || players.data?.[0];
              return player
                ? {
                    id: `matches:${player.playerKey}`,
                    kind: 'matches',
                    playerKey: player.playerKey,
                    search: '{}',
                  }
                : defaultTab;
            })(),
        );
      }
    };
    const keys = Object.entries(useWorkspace.getState().reviewDrafts)
      .filter(
        ([, d]) =>
          d.epoch === app.data?.workspaceEpoch &&
          ids.includes(`review:${d.playerKey}:${d.matchKey}`),
      )
      .map(([key]) => key);
    const proceed = () => {
      if (dirty && ids.includes('settings')) setPending(() => action);
      else action();
    };
    if (keys.length) {
      setNoteClose({ action: proceed, keys });
      return;
    }
    proceed();
  }
  const collapsed = settings.data?.sidebarCollapsed;
  if (app.data?.phase === 'recovery_required')
    return (
      <div className="grid grid-rows-[48px_minmax(0,_1fr)] h-full">
        <TitleBar />
        <div className="min-h-0 overflow-auto p-6 flex items-center justify-center flex-col gap-4 text-primary [&_p]:text-muted-foreground [&_p]:max-w-[470px] [&_p]:text-center">
          <Swords aria-hidden="true" size={40} />
          <h1>{t('settings.recoveryTitle')}</h1>
          <p>{t('settings.recoveryHelp')}</p>
          <ErrorNotice error={recovery.error} />
          <div data-ui="actions" className="flex items-center gap-2">
            <Button disabled={recovery.isPending} onClick={() => recovery.mutate('restore_backup')}>
              {t('settings.restoreBackup')}
            </Button>
            <Button
              variant="outline"
              disabled={recovery.isPending}
              onClick={() => recovery.mutate('export_diagnostics')}
            >
              {t('settings.export')}
            </Button>
          </div>
        </div>
      </div>
    );
  if (!settings.data)
    return (
      <div className="grid grid-rows-[48px_minmax(0,_1fr)] h-full">
        <TitleBar />
        <div className="min-h-0 overflow-auto p-6 flex items-center justify-center flex-col gap-4 text-primary [&_p]:text-muted-foreground">
          <Swords aria-hidden="true" size={40} />
          <h1>RiftMind</h1>
          <p>{t('common.loading')}</p>
          <ErrorNotice error={settings.error || app.error} />
          {settings.error && (
            <Button onClick={() => void settings.refetch()}>{t('common.retry')}</Button>
          )}
        </div>
      </div>
    );
  const { icon: ColorModeIcon, next: nextColorMode } =
    colorModeCycle[settings.data.colorModePreference];
  const colorModeLabel = t('settings.cycleColorMode', {
    current: t(`common.${settings.data.colorModePreference}`),
    next: t(`common.${nextColorMode}`),
  });
  return (
    <>
      <a
        className="fixed top-2 left-2 z-100 py-2 px-3 bg-card text-foreground border-2 border-ring rounded-md -translate-y-[150%] focus:translate-y-0"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        {t('common.skipToContent')}
      </a>
      <RuntimeEffects />
      <Tabs
        value={activeId}
        onValueChange={(id) => {
          const tab = tabs.find((existing) => existing.id === id);
          if (tab) activate(tab);
        }}
        data-collapsed={collapsed}
        className="grid grid-cols-[208px_minmax(0,_1fr)] grid-rows-[48px_minmax(0,_1fr)] h-full transition-[grid-template-columns] duration-200 ease-in-out data-[collapsed=true]:grid-cols-[64px_minmax(0,_1fr)] max-[900.01px]:grid-cols-[64px_minmax(0,_1fr)]"
      >
        <TitleBar
          sidebarToggle={
            <Button
              variant="ghost"
              size="icon"
              data-ui="sidebar-toggle"
              className="w-10 h-10 shrink-0 pointer-events-auto"
              aria-label={t(collapsed ? 'common.expand' : 'common.collapse')}
              aria-expanded={!collapsed}
              aria-controls="app-sidebar"
              title={t(collapsed ? 'common.expand' : 'common.collapse')}
              aria-disabled={save.isPending}
              onClick={() => {
                if (!save.isPending) save.mutate({ sidebarCollapsed: !collapsed });
              }}
            >
              {collapsed ? (
                <PanelLeftOpen aria-hidden="true" />
              ) : (
                <PanelLeftClose aria-hidden="true" />
              )}
            </Button>
          }
        >
          <TabsList
            className="flex justify-start gap-[3px] h-10 p-0 bg-transparent rounded-none overflow-x-auto min-w-0 items-stretch [scrollbar-width:none]"
            aria-label={t('common.workspace')}
          >
            {tabs.map((tab, index) => {
              const player = players.data?.find((p) => p.playerKey === tab.playerKey);
              const title =
                tab.kind === 'notebooks'
                  ? t('notebooks.titlePage')
                  : tab.kind === 'players'
                    ? `${t('players.title')}${player ? ` · ${playerName(t, player)}` : ''}`
                    : ['live', 'champions', 'compare'].includes(tab.kind)
                      ? t(`scouting.${tab.kind}`)
                      : tab.kind === 'settings'
                        ? t('common.settings')
                        : tab.kind === 'progress'
                          ? t('review.progress')
                          : tab.kind === 'review'
                            ? `${t('review.title')} · ${matchName(t, safeSearch(tab).match || '')}`
                            : player
                              ? `${playerName(t, player)} · ${serverName(t, player.serverId)}`
                              : t('common.defaultTab');
              return (
                <ContextMenu key={tab.id}>
                  <ContextMenuTrigger asChild>
                    <div
                      data-active={activeId === tab.id}
                      className="flex w-max items-center shrink-0 min-w-0 max-w-[min(32rem,70vw)] text-muted-foreground rounded-[6px_6px_0_0] border border-transparent border-b-0 hover:bg-muted data-[active=true]:text-foreground data-[active=true]:bg-background [&_>_button[role=tab]]:min-w-0 [&_>_button[role=tab]]:flex [&_>_button[role=tab]]:flex-1 [&_>_button[role=tab]]:gap-[7px] [&_>_button[role=tab]]:border-0 [&_>_button[role=tab]]:bg-transparent [&_>_button[role=tab]]:shadow-none [&_>_button[role=tab]]:text-[13px] [&_>_button[role=tab]]:pt-2 [&_>_button[role=tab]]:pr-1.5 [&_>_button[role=tab]]:pb-2 [&_>_button[role=tab]]:pl-3 [&_>_button[role=tab]_>_span:first-of-type]:overflow-hidden [&_>_button[role=tab]_>_span:first-of-type]:text-ellipsis [&_>_button[role=tab]_>_span:first-of-type]:whitespace-nowrap [&_svg]:shrink-0 forced-colors:data-[active=true]:border forced-colors:data-[active=true]:border-[ButtonText]"
                      draggable
                      onDragStart={() => {
                        drag.current = tab.id;
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (drag.current) reorder(drag.current, tab.id);
                        drag.current = null;
                      }}
                    >
                      <TabsTrigger
                        id={`workspace-${tab.id}`}
                        className="rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-muted-foreground"
                        aria-controls={`workspace-panel-${tab.id}`}
                        value={tab.id}
                        title={title}
                      >
                        {tab.kind === 'settings' ? (
                          <Settings2 aria-hidden="true" size={16} />
                        ) : tab.kind === 'notebooks' ? (
                          <BookOpen aria-hidden="true" size={16} />
                        ) : tab.kind === 'matches' ? (
                          <History aria-hidden="true" size={16} />
                        ) : (
                          <Swords aria-hidden="true" size={16} />
                        )}
                        <span>{title}</span>
                        {tab.kind === 'settings' && dirty && (
                          <span className="text-(--warning)" title={t('common.unsaved')}>
                            •
                          </span>
                        )}
                      </TabsTrigger>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-[26px] h-7 shrink-0 text-muted-foreground mr-[3px]"
                        title={t('common.close')}
                        aria-label={`${t('common.close')} ${title}`}
                        onClick={() => closeSet([tab.id])}
                      >
                        <X aria-hidden="true" size={13} />
                      </Button>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent aria-label={t('common.tabActions')}>
                    <ContextMenuItem onSelect={() => refreshTab(tab)}>
                      <RotateCw aria-hidden="true" size={14} />
                      {t('common.refresh')}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onSelect={() =>
                        closeSet(tabs.filter((item) => item.id !== tab.id).map((item) => item.id))
                      }
                    >
                      {t('common.closeOthers')}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => closeSet(tabs.slice(index + 1).map((item) => item.id))}
                    >
                      {t('common.closeRight')}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      disabled={index === 0}
                      onSelect={() => reorder(tab.id, tabs[index - 1].id)}
                    >
                      <ChevronLeft aria-hidden="true" size={14} />
                      {t('common.moveLeft')}
                    </ContextMenuItem>
                    <ContextMenuItem
                      disabled={index === tabs.length - 1}
                      onSelect={() => reorder(tab.id, tabs[index + 1].id)}
                    >
                      <ChevronRight aria-hidden="true" size={14} />
                      {t('common.moveRight')}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </TabsList>
        </TitleBar>
        <aside
          className="row-start-2 bg-(--sidebar) border-r border-r-border flex flex-col py-5 px-3 min-w-0 [&_nav]:flex-1 max-[900.01px]:[&_[data-ui~=nav-item]]:p-2 max-[900.01px]:[&_[data-ui~=nav-item]]:justify-center [&_[data-ui~=sidebar-label]]:min-w-0 [&_[data-ui~=sidebar-label]]:overflow-hidden [&_[data-ui~=sidebar-label]]:text-ellipsis [&_[data-ui~=sidebar-label]]:whitespace-nowrap"
          id="app-sidebar"
        >
          <nav aria-label={t('common.matches')}>
            <Button
              variant="ghost"
              data-ui="nav-item"
              data-selected={location.pathname === '/matches'}
              className={sidebarNavigationClassName}
              aria-label={t('common.matches')}
              aria-current={location.pathname === '/matches' ? 'page' : undefined}
              title={t('common.matches')}
              onClick={() =>
                activate(
                  tabs.find(
                    (tab) =>
                      tab.kind === 'matches' &&
                      tab.playerKey === connection.data?.player?.playerKey,
                  ) ||
                    tabs.find((tab) => tab.kind === 'matches') ||
                    defaultTab,
                )
              }
            >
              <History aria-hidden="true" size={19} />
              <span
                data-ui="sidebar-label"
                className="[[data-collapsed=true]_&]:hidden max-[900.01px]:hidden"
              >
                {t('common.matches')}
              </span>
            </Button>
            {(['players', 'live', 'champions'] as const).map((kind) => (
              <Button
                key={kind}
                variant="ghost"
                data-ui="nav-item"
                data-selected={location.pathname === `/${kind}`}
                className={sidebarNavigationClassName}
                aria-label={t(kind === 'players' ? 'players.title' : `scouting.${kind}`)}
                aria-current={location.pathname === `/${kind}` ? 'page' : undefined}
                title={t(kind === 'players' ? 'players.title' : `scouting.${kind}`)}
                onClick={() =>
                  activate({
                    id:
                      kind === 'live'
                        ? 'live'
                        : `${kind}:${connection.data?.player?.playerKey || 'current'}`,
                    kind,
                    playerKey: connection.data?.player?.playerKey || null,
                    search: '{}',
                  })
                }
              >
                {kind === 'players' ? (
                  <UserRound aria-hidden="true" size={19} />
                ) : kind === 'live' ? (
                  <Swords aria-hidden="true" size={19} />
                ) : (
                  <UsersRound aria-hidden="true" size={19} />
                )}
                <span
                  data-ui="sidebar-label"
                  className="[[data-collapsed=true]_&]:hidden max-[900.01px]:hidden"
                >
                  {t(kind === 'players' ? 'players.title' : `scouting.${kind}`)}
                </span>
              </Button>
            ))}
            <Button
              variant="ghost"
              data-ui="nav-item"
              data-selected={location.pathname === '/progress'}
              className={sidebarNavigationClassName}
              aria-label={t('review.progress')}
              aria-current={location.pathname === '/progress' ? 'page' : undefined}
              title={t('review.progress')}
              onClick={() =>
                activate({
                  id: `progress:${connection.data?.player?.playerKey || 'current'}`,
                  kind: 'progress',
                  playerKey: connection.data?.player?.playerKey || null,
                  search: '{}',
                })
              }
            >
              <ChartNoAxesCombined aria-hidden="true" size={19} />
              <span
                data-ui="sidebar-label"
                className="[[data-collapsed=true]_&]:hidden max-[900.01px]:hidden"
              >
                {t('review.progress')}
              </span>
            </Button>
            <Button
              variant="ghost"
              data-ui="nav-item"
              data-selected={location.pathname === '/notebooks'}
              className={sidebarNavigationClassName}
              aria-label={t('notebooks.titlePage')}
              aria-current={location.pathname === '/notebooks' ? 'page' : undefined}
              title={t('notebooks.titlePage')}
              onClick={() =>
                activate({
                  id: 'notebooks:64',
                  kind: 'notebooks',
                  playerKey: null,
                  search: '{"champion":64}',
                })
              }
            >
              <BookOpen aria-hidden="true" size={19} />
              <span
                data-ui="sidebar-label"
                className="[[data-collapsed=true]_&]:hidden max-[900.01px]:hidden"
              >
                {t('notebooks.titlePage')}
              </span>
            </Button>
          </nav>
          <div className="flex flex-col gap-[5px]">
            <div
              className="flex gap-[9px] items-center py-4 px-2 border-t border-t-border text-muted-foreground [&_>_svg]:shrink-0 [&_strong]:block [&_strong]:text-[12px] [&_strong]:font-medium [&_small]:block [&_small]:text-[10px] [&_small]:max-w-28 [&_small]:overflow-hidden [&_small]:text-ellipsis [[data-collapsed=true]_&]:justify-center [[data-collapsed=true]_&]:py-3.5 [[data-collapsed=true]_&]:px-0 max-[900.01px]:justify-center max-[900.01px]:py-3.5 max-[900.01px]:px-0"
              title={t(`connection.${connection.data?.phase || 'disconnected'}`)}
            >
              {connection.data?.phase === 'connected' ? (
                <Wifi aria-hidden="true" size={17} />
              ) : (
                <WifiOff aria-hidden="true" size={17} />
              )}
              <div
                data-ui="sidebar-label"
                className="[[data-collapsed=true]_&]:hidden max-[900.01px]:hidden"
              >
                <strong>{t(`connection.${connection.data?.phase || 'disconnected'}`)}</strong>
                <small>{serverName(t, connection.data?.identification?.serverId)}</small>
              </div>
            </div>
            <div
              data-ui="sidebar-actions"
              className="flex items-center gap-1 [&_[data-ui~=nav-item]]:flex-1 [&_[data-ui~=nav-item]]:min-w-0 [[data-collapsed=true]_&]:flex-col [[data-collapsed=true]_&_[data-ui~=nav-item]]:flex-none max-[900.01px]:flex-col max-[900.01px]:[&_[data-ui~=nav-item]]:flex-none"
            >
              <Button
                variant="ghost"
                aria-label={t('common.settings')}
                aria-current={location.pathname === '/settings' ? 'page' : undefined}
                title={t('common.settings')}
                data-ui="nav-item"
                data-selected={location.pathname === '/settings'}
                className={sidebarNavigationClassName}
                onClick={() =>
                  activate({ id: 'settings', kind: 'settings', playerKey: null, search: '{}' })
                }
              >
                <Settings2 aria-hidden="true" size={19} />
                <span
                  data-ui="sidebar-label"
                  className="[[data-collapsed=true]_&]:hidden max-[900.01px]:hidden"
                >
                  {t('common.settings')}
                </span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="w-9 h-10 shrink-0 text-muted-foreground"
                aria-label={colorModeLabel}
                title={colorModeLabel}
                aria-disabled={save.isPending}
                onClick={() => {
                  if (!save.isPending) save.mutate({ colorModePreference: nextColorMode });
                }}
              >
                <ColorModeIcon aria-hidden="true" />
              </Button>
            </div>
          </div>
        </aside>
        <div className="flex flex-col min-h-0 min-w-0">
          {DevToolbar && transport.mode !== 'desktop' && (
            <Suspense fallback={null}>
              <DevToolbar />
            </Suspense>
          )}
          <div className="empty:hidden">
            <ErrorNotice error={save.error} />
            {workspaceChanged && (
              <Alert>
                <AlertDescription>
                  {t('review.workspaceChanged')}{' '}
                  <Button variant="outline" size="sm" onClick={() => setShowPreviousDrafts(true)}>
                    {t('review.previousDrafts')}
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </div>
          <main
            data-ui="main-content"
            className="flex-1 min-h-0 overflow-hidden"
            id="main-content"
            aria-labelledby={`workspace-${activeId}`}
            tabIndex={-1}
          >
            <WorkspacePages
              tabs={initialized.current ? tabs : [activeTab]}
              activeTab={activeTab}
              workspaceEpoch={app.data?.workspaceEpoch}
              refreshRevisions={refreshRevisions}
            />
          </main>
        </div>
      </Tabs>
      <ConfirmDialog
        open={!!pending}
        title={t('common.discard')}
        description={t('common.discardHelp')}
        onClose={() => setPending(null)}
        onConfirm={() => {
          pending?.();
          setPending(null);
        }}
      />
      <Dialog
        open={!!noteClose}
        onOpenChange={(open) => {
          if (!open && !savingNotes) setNoteClose(null);
        }}
      >
        <DialogContent closeLabel={t('common.dismiss')}>
          <DialogHeader>
            <DialogTitle>{t('review.unsavedNotes')}</DialogTitle>
            <DialogDescription>{t('review.unsavedHelp')}</DialogDescription>
          </DialogHeader>
          <ErrorNotice error={noteCloseError} />
          <DialogFooter>
            <Button variant="outline" disabled={savingNotes} onClick={() => setNoteClose(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="outline"
              disabled={savingNotes}
              onClick={() => {
                noteClose?.keys.forEach((key) => useWorkspace.getState().setReviewDraft(key, null));
                noteClose?.action();
                setNoteClose(null);
              }}
            >
              {t('review.discardNotes')}
            </Button>
            <Button disabled={savingNotes} onClick={() => void saveClosingNotes()}>
              {t('review.saveNote')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={showPreviousDrafts} onOpenChange={setShowPreviousDrafts}>
        <DialogContent closeLabel={t('common.dismiss')}>
          <DialogHeader>
            <DialogTitle>{t('review.previousDrafts')}</DialogTitle>
            <DialogDescription>{t('review.workspaceChanged')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 max-h-[60vh] overflow-auto">
            {Object.entries(previousDrafts)
              .filter(([, d]) => d.epoch !== app.data?.workspaceEpoch)
              .map(([key, d]) => (
                <div key={key}>
                  <p>
                    {matchName(t, d.matchKey)} ·{' '}
                    {t(d.reportId ? 'labels.report' : 'review.matchNote')}
                  </p>
                  <Textarea readOnly aria-label={t('review.noteText')} value={d.text} />
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
