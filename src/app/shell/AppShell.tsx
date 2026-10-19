import { matchName, playerName } from '../../lib/display-names';
import { serverName } from '../../lib/server-name';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Swords, UsersRound, History, ChartNoAxesCombined, Settings2, PanelLeftClose, PanelLeftOpen, Sun, Moon, Monitor, Wifi, WifiOff, X, Ellipsis, ChevronLeft, ChevronRight } from 'lucide-react';
import { transport } from '../runtime';
import { queryClient } from '../query-client';
import { useWorkspace, defaultTab } from '../../stores/workspace-tabs';
import type { ColorMode, WorkspaceTab } from '../../generated/contracts';
import { validateSearch, restoreTabOnBoot, type Search } from '../router';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '../../components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../components/ui/dialog';
import { Textarea } from '../../components/ui/textarea';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorNotice } from '../../components/ErrorNotice';
import { TitleBar } from './TitleBar';
import { RuntimeEffects } from '../providers';
const DevToolbar = import.meta.env.DEV && import.meta.env.MODE === 'development' && import.meta.env.VITE_DEV_TOOLS === 'true' ? lazy(() => import('../dev/DevToolbar')) : null;
const colorModeCycle: Record<ColorMode, { icon: typeof Sun; next: ColorMode }> = {
  light: { icon: Sun, next: 'dark' },
  dark: { icon: Moon, next: 'system' },
  system: { icon: Monitor, next: 'light' },
};
const safeSearch = (tab: WorkspaceTab): Search => { try { return validateSearch(JSON.parse(tab.search)); } catch { return {}; } };
export function AppShell() {
  const workspaceChanged = useWorkspace(s => s.workspaceChanged);
  const previousDrafts = useWorkspace(s => s.reviewDrafts);
  const [showPreviousDrafts, setShowPreviousDrafts] = useState(false);
  const { t } = useTranslation(); const navigate = useNavigate();
  const location = useRouterState({ select: s => s.location });
  const { tabs, setTabs, open, reorder, dirty, setDraft } = useWorkspace();
  const matchKey = location.pathname.match(/^\/matches\/([^/]+)\/review$/)?.[1];
  const reviewMatch = matchKey ? decodeURIComponent(matchKey) : undefined;
  const routePlayer = (location.search as Search).player;
  const activeId = reviewMatch ? `review:${routePlayer || 'unknown'}:${reviewMatch}` : location.pathname === '/live' ? 'live' : location.pathname === '/champions' ? `champions:${routePlayer || 'current'}` : location.pathname === '/compare' ? (location.search as Search).tab || 'compare' : location.pathname === '/progress' ? `progress:${routePlayer || 'current'}` : location.pathname === '/settings' ? 'settings' : (location.search as Search).tab || ((location.search as Search).player ? `matches:${(location.search as Search).player}` : 'matches');
  const app = useQuery({ queryKey: ['app'], queryFn: () => transport.call('get_app_state', {}), refetchInterval: q => q.state.data && ['booting', 'migrating'].includes(q.state.data.phase) ? 300 : false });
  const recovery = useMutation({ mutationFn: (action: 'restore_backup' | 'export_diagnostics') => action === 'restore_backup' ? transport.call(action, { id: 'native-dialog' }) : transport.call(action, {}), onSuccess: () => queryClient.invalidateQueries() });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => transport.call('get_settings', {}), enabled: app.data?.phase === 'ready', retry: (count, error) => (error as { code?: string }).code === 'APP_NOT_READY' && count < 5, retryDelay: 300 });
  const connection = useQuery({ queryKey: ['connection'], queryFn: () => transport.call('get_connection_state', {}), refetchInterval: 10_000 });
  const players = useQuery({ queryKey: ['players'], queryFn: () => transport.call('list_players', {}) });
  const [pending, setPending] = useState<(() => void) | null>(null); const initialized = useRef(false); const drag = useRef<string | null>(null); const previousPlayer = useRef<string | undefined>(undefined);
  const save = useMutation({ mutationFn: async (patch: { sidebarCollapsed?: boolean; colorModePreference?: 'light' | 'dark' | 'system'; workspaceTabs?: WorkspaceTab[]; activeTab?: string }) => {
    const latest = await transport.call('get_settings', {});
    if (patch.workspaceTabs && useWorkspace.getState().dirty) return latest;
    return transport.call('update_settings', { expectedRevision: latest.revision, patch: { languagePreference: null, themeId: null, colorModePreference: null, sidebarCollapsed: null, closeBehavior: null, autoConnect: null, autoSync: null, syncPages: null, workspaceTabs: null, activeTab: null, ...patch } });
  }, onSuccess: value => queryClient.setQueryData(['settings'], value) });
  function activate(tab: WorkspaceTab) { open(tab); const search = safeSearch(tab); if (tab.kind === 'live' || tab.kind === 'champions' || tab.kind === 'compare') { void navigate({ to: tab.kind === 'live' ? '/live' : tab.kind === 'champions' ? '/champions' : '/compare', search: { ...search, tab: tab.id, player: tab.playerKey || undefined } }); return; } if (tab.kind === 'review' && search.match) { void navigate({ to: '/matches/$matchKey/review', params: { matchKey: search.match }, search: { ...search, player: tab.playerKey || undefined } }); return; } if (tab.kind === 'progress') { void navigate({ to: '/progress', search: { ...search, player: tab.playerKey || undefined } }); return; } void navigate(tab.kind === 'settings' ? { to: '/settings' } : { to: '/matches', search: { ...safeSearch(tab), tab: tab.id, player: tab.playerKey || undefined } }); }
  useEffect(() => {
    if (!settings.data || initialized.current || !players.data) return;
    initialized.current = true;
    const valid = settings.data.workspaceTabs.filter(tab => tab.kind === 'settings' || !tab.playerKey || players.data.some(p => p.playerKey === tab.playerKey));
    if (valid.length) setTabs(valid);
    if (restoreTabOnBoot) {
      const saved = valid.find(tab => tab.id === settings.data?.activeTab);
      if (saved) activate(saved);
    }
  });
  useEffect(() => {
    if (!initialized.current) return;
    const search = location.search as Search;
    if (activeId.startsWith('matches:') && tabs.some(tab => tab.id === 'matches' && !tab.playerKey)) { setTabs(tabs.filter(tab => tab.id !== 'matches')); return; }
    if (activeId.startsWith('champions:') && activeId !== 'champions:current' && tabs.some(tab => tab.id === 'champions:current' && !tab.playerKey)) { setTabs(tabs.filter(tab => tab.id !== 'champions:current')); return; }
    const routeKind = location.pathname.slice(1);
    const tab: WorkspaceTab = ['live','champions','compare'].includes(routeKind) ? { id: activeId, kind: routeKind, playerKey: search.player || null, search: JSON.stringify(search) } : reviewMatch ? { id: activeId, kind: 'review', playerKey: search.player || null, search: JSON.stringify({ ...search, match: reviewMatch }) } : location.pathname === '/progress' ? { id: activeId, kind: 'progress', playerKey: search.player || null, search: JSON.stringify(search) } : location.pathname === '/settings' ? { id: 'settings', kind: 'settings', playerKey: null, search: '{}' } : { id: activeId, kind: 'matches', playerKey: search.player || null, search: JSON.stringify(search) };
    if (!tabs.some(item => item.id === tab.id)) open(tab);
    else if (tabs.find(item => item.id === tab.id)?.search !== tab.search) setTabs(tabs.map(item => item.id === tab.id ? tab : item));
  }, [activeId, location.href, tabs, open, setTabs, location.pathname, location.search]);
  useEffect(() => {
    const p = connection.data?.player; if (!p || !initialized.current || previousPlayer.current === p.playerKey) return;
    const before = previousPlayer.current; previousPlayer.current = p.playerKey;
    const tab: WorkspaceTab = { id: `matches:${p.playerKey}`, kind: 'matches', playerKey: p.playerKey, search: '{}' };
    if (location.pathname === '/matches' && (!(location.search as Search).player || (before && before !== p.playerKey))) activate(tab); else open(tab);
  });
  useEffect(() => {
    if (!initialized.current || dirty) return;
    const timer = setTimeout(() => { save.mutate({ workspaceTabs: tabs, activeTab: activeId }); }, 500);
    return () => clearTimeout(timer);
  }, [tabs, activeId, dirty]);
  const [noteClose, setNoteClose] = useState<{ action: () => void; keys: string[] } | null>(null);
  const [noteCloseError, setNoteCloseError] = useState<unknown>(null);
  const [savingNotes, setSavingNotes] = useState(false);
  async function saveClosingNotes() { if (!noteClose) return; setSavingNotes(true); setNoteCloseError(null); try { for (const key of noteClose.keys) { const d = useWorkspace.getState().reviewDrafts[key]; if (!d) continue; if (d.epoch !== app.data?.workspaceEpoch) throw { code: 'SESSION_CHANGED' }; await transport.call('save_review_note', { workspaceEpoch: d.epoch, id: d.note?.id || null, matchKey: d.matchKey, playerKey: d.playerKey, reportId: d.reportId, evidenceId: d.evidenceId, text: d.text, expectedRevision: d.note?.revision || 0 }); useWorkspace.getState().setReviewDraft(key, null); } noteClose.action(); setNoteClose(null); } catch (error) { setNoteCloseError(error); } finally { setSavingNotes(false); } }
  function closeSet(ids: string[]) {
    const action = () => { const next = tabs.filter(tab => !ids.includes(tab.id)); setTabs(next); if (ids.includes('settings')) setDraft(null, false); if (ids.includes(activeId)) { const index = tabs.findIndex(tab => tab.id === activeId); activate([...tabs.slice(0, index)].reverse().find(tab => !ids.includes(tab.id)) || next[0] || (() => { const player = connection.data?.player || players.data?.[0]; return player ? { id: `matches:${player.playerKey}`, kind: 'matches', playerKey: player.playerKey, search: '{}' } : defaultTab; })()); } };
    const keys = Object.entries(useWorkspace.getState().reviewDrafts).filter(([, d]) => d.epoch === app.data?.workspaceEpoch && ids.includes(`review:${d.playerKey}:${d.matchKey}`)).map(([key]) => key);
    const proceed = () => { if (dirty && ids.includes('settings')) setPending(() => action); else action(); };
    if (keys.length) { setNoteClose({ action: proceed, keys }); return; }
    proceed();
  }
  const collapsed = settings.data?.sidebarCollapsed;
  if (app.data?.phase === 'recovery_required') return <div className="startup-shell"><TitleBar /><div className="startup recovery"><Swords aria-hidden="true" size={40} /><h1>{t('settings.recoveryTitle')}</h1><p>{t('settings.recoveryHelp')}</p><ErrorNotice error={recovery.error} /><div className="actions"><Button disabled={recovery.isPending} onClick={() => recovery.mutate('restore_backup')}>{t('settings.restoreBackup')}</Button><Button variant="outline" disabled={recovery.isPending} onClick={() => recovery.mutate('export_diagnostics')}>{t('settings.export')}</Button></div></div></div>;
  if (!settings.data) return <div className="startup-shell"><TitleBar /><div className="startup"><Swords aria-hidden="true" size={40} /><h1>RiftMind</h1><p>{t('common.loading')}</p><ErrorNotice error={settings.error || app.error} />{settings.error && <Button onClick={() => void settings.refetch()}>{t('common.retry')}</Button>}</div></div>;
  const { icon: ColorModeIcon, next: nextColorMode } = colorModeCycle[settings.data.colorModePreference];
  const colorModeLabel = t('settings.cycleColorMode', { current: t(`common.${settings.data.colorModePreference}`), next: t(`common.${nextColorMode}`) });
  return <><a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); document.getElementById('main-content')?.focus(); }}>{t('common.skipToContent')}</a><RuntimeEffects /><div className={`app-shell ${collapsed ? 'is-collapsed' : ''}`}>
    <TitleBar sidebarToggle={<Button variant="ghost" size="icon" className="sidebar-toggle" aria-label={t(collapsed ? 'common.expand' : 'common.collapse')} aria-expanded={!collapsed} aria-controls="app-sidebar" title={t(collapsed ? 'common.expand' : 'common.collapse')} aria-disabled={save.isPending} onClick={() => { if (!save.isPending) save.mutate({ sidebarCollapsed: !collapsed }); }}>{collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}</Button>}><Tabs value={activeId} onValueChange={id => { const tab = tabs.find(item => item.id === id); if (tab) activate(tab); }}><TabsList className="tabs" aria-label={t('common.workspace')}>{tabs.map((tab, index) => { const player = players.data?.find(p => p.playerKey === tab.playerKey); const title = ['live','champions','compare'].includes(tab.kind) ? t(`scouting.${tab.kind}`) : tab.kind === 'settings' ? t('common.settings') : tab.kind === 'progress' ? t('review.progress') : tab.kind === 'review' ? `${t('review.title')} · ${matchName(t, safeSearch(tab).match || '')}` : player ? `${playerName(t, player)} · ${serverName(t, player.serverId)}` : t('common.defaultTab'); return <div key={tab.id} className={`work-tab ${activeId === tab.id ? 'active' : ''}`} draggable onDragStart={() => { drag.current = tab.id; }} onDragOver={e => e.preventDefault()} onDrop={() => { if (drag.current) reorder(drag.current, tab.id); drag.current = null; }}><TabsTrigger id={`workspace-${tab.id}`} aria-controls="main-content" value={tab.id} title={title}>{tab.kind === 'settings' ? <Settings2 aria-hidden="true" size={14} /> : <Swords aria-hidden="true" size={14} />}<span>{title}</span>{tab.kind === 'settings' && dirty && <span className="dirty-dot" title={t('common.unsaved')}>•</span>}</TabsTrigger><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="tab-menu" size="icon" aria-label={t('common.tabActions')}><Ellipsis size={14} aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onSelect={() => closeSet(tabs.filter(item => item.id !== tab.id).map(item => item.id))}>{t('common.closeOthers')}</DropdownMenuItem><DropdownMenuItem onSelect={() => closeSet(tabs.slice(index + 1).map(item => item.id))}>{t('common.closeRight')}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem disabled={index === 0} onSelect={() => reorder(tab.id, tabs[index - 1].id)}><ChevronLeft aria-hidden="true" size={14} />{t('common.moveLeft')}</DropdownMenuItem><DropdownMenuItem disabled={index === tabs.length - 1} onSelect={() => reorder(tab.id, tabs[index + 1].id)}><ChevronRight aria-hidden="true" size={14} />{t('common.moveRight')}</DropdownMenuItem></DropdownMenuContent></DropdownMenu><Button variant="ghost" size="icon" className="close-tab" title={t('common.close')} aria-label={`${t('common.close')} ${title}`} onClick={() => closeSet([tab.id])}><X aria-hidden="true" size={13} /></Button></div>; })}</TabsList></Tabs></TitleBar>
    <aside className="sidebar" id="app-sidebar">
      <nav aria-label={t('common.matches')}>{(['live','champions'] as const).map(kind => <Button key={kind} variant="ghost" className={`nav-item ${location.pathname === `/${kind}` ? 'selected' : ''}`} aria-label={t(`scouting.${kind}`)} aria-current={location.pathname === `/${kind}` ? 'page' : undefined} title={t(`scouting.${kind}`)} onClick={() => activate({ id: kind === 'live' ? 'live' : `champions:${connection.data?.player?.playerKey || 'current'}`, kind, playerKey: connection.data?.player?.playerKey || null, search: '{}' })}>{kind === 'live' ? <Swords aria-hidden="true" size={19} /> : <UsersRound aria-hidden="true" size={19} />}<span className="sidebar-label">{t(`scouting.${kind}`)}</span></Button>)}<Button variant="ghost" className={`nav-item ${location.pathname === '/matches' ? 'selected' : ''}`} aria-label={t('common.matches')} aria-current={location.pathname === '/matches' ? 'page' : undefined} title={t('common.matches')} onClick={() => activate(tabs.find(tab => tab.kind === 'matches' && tab.playerKey === connection.data?.player?.playerKey) || tabs.find(tab => tab.kind === 'matches') || defaultTab)}><History aria-hidden="true" size={19} /><span className="sidebar-label">{t('common.matches')}</span></Button><Button variant="ghost" className={`nav-item ${location.pathname === '/progress' ? 'selected' : ''}`} aria-label={t('review.progress')} aria-current={location.pathname === '/progress' ? 'page' : undefined} title={t('review.progress')} onClick={() => activate({ id: `progress:${connection.data?.player?.playerKey || 'current'}`, kind: 'progress', playerKey: connection.data?.player?.playerKey || null, search: '{}' })}><ChartNoAxesCombined aria-hidden="true" size={19} /><span className="sidebar-label">{t('review.progress')}</span></Button></nav>
      <div className="sidebar-bottom"><div className="connection-card" title={t(`connection.${connection.data?.phase || 'disconnected'}`)}>{connection.data?.phase === 'connected' ? <Wifi aria-hidden="true" size={17} /> : <WifiOff aria-hidden="true" size={17} />}<div className="sidebar-label"><strong>{t(`connection.${connection.data?.phase || 'disconnected'}`)}</strong><small>{serverName(t, connection.data?.identification?.serverId)}</small></div></div>
      <div className="sidebar-actions">
      <Button variant="ghost" aria-label={t('common.settings')} aria-current={location.pathname === '/settings' ? 'page' : undefined} title={t('common.settings')} className={`nav-item ${location.pathname === '/settings' ? 'selected' : ''}`} onClick={() => activate({ id: 'settings', kind: 'settings', playerKey: null, search: '{}' })}><Settings2 aria-hidden="true" size={19} /><span className="sidebar-label">{t('common.settings')}</span></Button>
      <Button variant="ghost" size="icon" className="theme-toggle" aria-label={colorModeLabel} title={colorModeLabel} aria-disabled={save.isPending} onClick={() => { if (!save.isPending) save.mutate({ colorModePreference: nextColorMode }); }}><ColorModeIcon aria-hidden="true" /></Button></div></div></aside>
    <div className="workspace">
    {DevToolbar && transport.mode !== 'desktop' && <Suspense fallback={null}><DevToolbar /></Suspense>}
    <div className="shell-notices"><ErrorNotice error={save.error} />{workspaceChanged && <Alert><AlertDescription>{t('review.workspaceChanged')} <Button variant="outline" size="sm" onClick={() => setShowPreviousDrafts(true)}>{t('review.previousDrafts')}</Button></AlertDescription></Alert>}</div><main className="main-content" id="main-content" aria-labelledby={`workspace-${activeId}`} tabIndex={-1} key={activeId} onScroll={e => useWorkspace.getState().rememberScroll(activeId, e.currentTarget.scrollTop)} ref={el => { if (el) el.scrollTop = useWorkspace.getState().scroll[activeId] || 0; }}><Outlet /></main></div></div><ConfirmDialog open={!!pending} title={t('common.discard')} description={t('common.discardHelp')} onClose={() => setPending(null)} onConfirm={() => { pending?.(); setPending(null); }} /><Dialog open={!!noteClose} onOpenChange={open => { if (!open && !savingNotes) setNoteClose(null); }}><DialogContent closeLabel={t('common.dismiss')}><DialogHeader><DialogTitle>{t('review.unsavedNotes')}</DialogTitle><DialogDescription>{t('review.unsavedHelp')}</DialogDescription></DialogHeader><ErrorNotice error={noteCloseError} /><DialogFooter><Button variant="outline" disabled={savingNotes} onClick={() => setNoteClose(null)}>{t('common.cancel')}</Button><Button variant="outline" disabled={savingNotes} onClick={() => { noteClose?.keys.forEach(key => useWorkspace.getState().setReviewDraft(key, null)); noteClose?.action(); setNoteClose(null); }}>{t('review.discardNotes')}</Button><Button disabled={savingNotes} onClick={() => void saveClosingNotes()}>{t('review.saveNote')}</Button></DialogFooter></DialogContent></Dialog><Dialog open={showPreviousDrafts} onOpenChange={setShowPreviousDrafts}><DialogContent closeLabel={t('common.dismiss')}><DialogHeader><DialogTitle>{t('review.previousDrafts')}</DialogTitle><DialogDescription>{t('review.workspaceChanged')}</DialogDescription></DialogHeader><div className="previous-drafts">{Object.entries(previousDrafts).filter(([, d]) => d.epoch !== app.data?.workspaceEpoch).map(([key, d]) => <div key={key}><p>{matchName(t, d.matchKey)} · {t(d.reportId ? 'labels.report' : 'review.matchNote')}</p><Textarea readOnly aria-label={t('review.noteText')} value={d.text} /></div>)}</div></DialogContent></Dialog></>;
}
