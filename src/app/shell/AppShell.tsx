import { useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Swords, Settings2, PanelLeftClose, PanelLeftOpen, Sun, Moon, Monitor, Wifi, WifiOff, X, Minus, Square, ChevronLeft, ChevronRight } from 'lucide-react';
import { transport } from '../runtime';
import { queryClient } from '../query-client';
import { useWorkspace, defaultTab } from '../../stores/workspace-tabs';
import type { WorkspaceTab } from '../../generated/contracts';
import { validateSearch, type Search } from '../router';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/dialog';
import { ErrorNotice } from '../../components/ErrorNotice';
import { RuntimeEffects } from '../providers';
const safeSearch = (tab: WorkspaceTab): Search => { try { return validateSearch(JSON.parse(tab.search)); } catch { return {}; } };
export function AppShell() {
  const { t } = useTranslation(); const navigate = useNavigate();
  const location = useRouterState({ select: s => s.location });
  const { tabs, setTabs, open, reorder, dirty, setDraft } = useWorkspace();
  const activeId = location.pathname === '/settings' ? 'settings' : (location.search as Search).tab || ((location.search as Search).player ? `matches:${(location.search as Search).player}` : 'matches');
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => transport.call('get_settings', {}) });
  const connection = useQuery({ queryKey: ['connection'], queryFn: () => transport.call('get_connection_state', {}), refetchInterval: 10_000 });
  const players = useQuery({ queryKey: ['players'], queryFn: () => transport.call('list_players', {}) });
  const [pending, setPending] = useState<(() => void) | null>(null); const initialized = useRef(false); const drag = useRef<string | null>(null); const previousPlayer = useRef<string | undefined>(undefined);
  const save = useMutation({ mutationFn: async (patch: { sidebarCollapsed?: boolean; colorModePreference?: 'light' | 'dark' | 'system'; workspaceTabs?: WorkspaceTab[]; activeTab?: string }) => {
    const latest = await transport.call('get_settings', {});
    return transport.call('update_settings', { expectedRevision: latest.revision, patch: { languagePreference: null, themeId: null, colorModePreference: null, sidebarCollapsed: null, closeBehavior: null, autoConnect: null, autoSync: null, syncPages: null, workspaceTabs: null, activeTab: null, ...patch } });
  }, onSuccess: value => queryClient.setQueryData(['settings'], value) });
  function activate(tab: WorkspaceTab) { open(tab); void navigate(tab.kind === 'settings' ? { to: '/settings' } : { to: '/matches', search: { ...safeSearch(tab), tab: tab.id, player: tab.playerKey || undefined } }); }
  useEffect(() => {
    if (!settings.data || initialized.current || !players.data) return;
    initialized.current = true;
    const valid = settings.data.workspaceTabs.filter(tab => tab.kind === 'settings' || !tab.playerKey || players.data.some(p => p.playerKey === tab.playerKey));
    if (valid.length) setTabs(valid);
    if (!window.location.hash || window.location.hash === '#/' || window.location.hash === '#/matches') {
      const saved = valid.find(tab => tab.id === settings.data?.activeTab);
      if (saved) activate(saved);
    }
  });
  useEffect(() => {
    if (!initialized.current) return;
    const search = location.search as Search;
    const tab: WorkspaceTab = location.pathname === '/settings' ? { id: 'settings', kind: 'settings', playerKey: null, search: '{}' } : { id: activeId, kind: 'matches', playerKey: search.player || null, search: JSON.stringify(search) };
    if (!tabs.some(item => item.id === tab.id)) open(tab);
    else if (tabs.find(item => item.id === tab.id)?.search !== tab.search) setTabs(tabs.map(item => item.id === tab.id ? tab : item));
  }, [activeId, location.href, tabs, open, setTabs, location.pathname, location.search]);
  useEffect(() => {
    const p = connection.data?.player; if (!p || !initialized.current || previousPlayer.current === p.playerKey) return;
    previousPlayer.current = p.playerKey;
    const tab: WorkspaceTab = { id: `matches:${p.playerKey}`, kind: 'matches', playerKey: p.playerKey, search: '{}' };
    if (location.pathname !== '/settings') activate(tab); else open(tab);
  });
  useEffect(() => {
    if (!initialized.current) return;
    const timer = setTimeout(() => { save.mutate({ workspaceTabs: tabs, activeTab: activeId }); }, 500);
    return () => clearTimeout(timer);
  }, [tabs, activeId]);
  function closeSet(ids: string[]) {
    const action = () => { const next = tabs.filter(tab => !ids.includes(tab.id)); setTabs(next); if (ids.includes('settings')) setDraft(null, false); if (ids.includes(activeId)) { const index = tabs.findIndex(tab => tab.id === activeId); activate([...tabs.slice(0, index)].reverse().find(tab => !ids.includes(tab.id)) || next[0] || defaultTab); } };
    if (dirty && ids.includes('settings')) setPending(() => action); else action();
  }
  async function windowAction(action: 'minimize' | 'toggleMaximize' | 'close') { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow()[action](); }
  const collapsed = settings.data?.sidebarCollapsed;
  if (!settings.data) return <div className="startup"><Swords size={40} /><h1>RiftMind</h1><p>{t('common.loading')}</p><ErrorNotice error={settings.error} />{settings.error && <Button onClick={() => void settings.refetch()}>{t('common.retry')}</Button>}</div>;
  return <><RuntimeEffects /><div className={`app-shell ${collapsed ? 'is-collapsed' : ''}`}>
    <aside className="sidebar"><div className="brand"><span className="brand-icon"><Swords size={24} /></span><div className="sidebar-label"><strong>RiftMind<span className="brand-dot">.</span></strong><small>{t('common.tagline')}</small></div></div>
      <nav aria-label={t('common.matches')}><Button variant="ghost" className={`nav-item ${location.pathname === '/matches' ? 'selected' : ''}`} title={t('common.matches')} onClick={() => activate(tabs.find(tab => tab.kind === 'matches' && tab.playerKey === connection.data?.player?.playerKey) || tabs.find(tab => tab.kind === 'matches') || defaultTab)}><Swords size={19} /><span className="sidebar-label">{t('common.matches')}</span></Button></nav>
      <div className="sidebar-bottom"><div className="connection-card" title={t(`connection.${connection.data?.phase || 'disconnected'}`)}>{connection.data?.phase === 'connected' ? <Wifi size={17} /> : <WifiOff size={17} />}<div className="sidebar-label"><strong>{t(`connection.${connection.data?.phase || 'disconnected'}`)}</strong><small>{connection.data?.identification?.serverId || '—'}</small></div></div>
      <div className="mode-switch" role="group" aria-label={t('settings.appearance')}>{(['light', 'dark', 'system'] as const).map((mode, i) => { const Icon = [Sun, Moon, Monitor][i]; return <Button key={mode} variant="ghost" size="icon" aria-label={t(`common.${mode}`)} title={t(`common.${mode}`)} aria-pressed={settings.data.colorModePreference === mode} onClick={() => save.mutate({ colorModePreference: mode })}><Icon size={16} /></Button>; })}</div>
      <Button variant="ghost" title={t('common.settings')} className={`nav-item ${location.pathname === '/settings' ? 'selected' : ''}`} onClick={() => activate({ id: 'settings', kind: 'settings', playerKey: null, search: '{}' })}><Settings2 size={19} /><span className="sidebar-label">{t('common.settings')}</span></Button>
      <Button variant="ghost" title={t(collapsed ? 'common.expand' : 'common.collapse')} className="nav-item collapse-toggle" onClick={() => save.mutate({ sidebarCollapsed: !collapsed })}>{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}<span className="sidebar-label">{t('common.collapse')}</span></Button></div></aside>
    <div className="workspace"><header className="titlebar"><div className="tabs" role="tablist" aria-label="Workspace">{tabs.map((tab, index) => { const player = players.data?.find(p => p.playerKey === tab.playerKey); const title = tab.kind === 'settings' ? t('common.settings') : player ? `${player.displayName} · ${player.serverId}` : t('common.defaultTab'); return <div key={tab.id} className={`work-tab ${activeId === tab.id ? 'active' : ''}`} draggable onDragStart={() => { drag.current = tab.id; }} onDragOver={e => e.preventDefault()} onDrop={() => { if (drag.current) reorder(drag.current, tab.id); drag.current = null; }}><button role="tab" aria-selected={activeId === tab.id} title={title} onClick={() => activate(tab)}>{tab.kind === 'settings' ? <Settings2 size={14} /> : <Swords size={14} />}<span>{title}</span>{tab.kind === 'settings' && dirty && <span className="dirty-dot" title={t('common.unsaved')}>•</span>}</button><details className="tab-menu"><summary aria-label={t('common.closeOthers')}>⋯</summary><div className="menu-panel"><button onClick={() => closeSet(tabs.filter(item => item.id !== tab.id).map(item => item.id))}>{t('common.closeOthers')}</button><button onClick={() => closeSet(tabs.slice(index + 1).map(item => item.id))}>{t('common.closeRight')}</button><button disabled={index === 0} onClick={() => reorder(tab.id, tabs[index - 1].id)}><ChevronLeft size={14} />{t('common.moveLeft')}</button><button disabled={index === tabs.length - 1} onClick={() => reorder(tab.id, tabs[index + 1].id)}><ChevronRight size={14} />{t('common.moveRight')}</button></div></details><button className="close-tab" title={t('common.close')} aria-label={`${t('common.close')} ${title}`} onClick={() => closeSet([tab.id])}><X size={13} /></button></div>; })}</div><div className="drag-region" data-tauri-drag-region />{transport.mode === 'desktop' && <div className="window-controls"><button aria-label={t('common.minimize')} onClick={() => void windowAction('minimize')}><Minus size={14} /></button><button aria-label={t('common.maximize')} onClick={() => void windowAction('toggleMaximize')}><Square size={12} /></button><button aria-label={t('common.windowClose')} onClick={() => void windowAction('close')}><X size={15} /></button></div>}</header>
    {transport.mode !== 'desktop' && <div className="dev-banner">{t(transport.mode === 'fixture' ? 'common.mock' : 'common.integration')}<label>{t('common.scenario')}<select defaultValue="no-client" onChange={e => { const scenario = e.target.value; if (transport.mode === 'fixture') void import('../../lib/transport/fixture').then(m => m.setScenario(scenario)); else void fetch('/bridge/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-riftmind-token': import.meta.env.VITE_HARNESS_TOKEN }, body: JSON.stringify({ scenario }) }); }}>{['no-client', 'tencent', 'riot', 'offline', 'waiting', 'conflict', 'unknown'].map((s, i) => <option key={s} value={s}>{t(`common.${['noClient', 'tencent', 'riot', 'offline', 'waiting', 'conflict', 'unsupported'][i]}`)}</option>)}</select></label></div>}
    <div className="shell-notices"><ErrorNotice error={save.error} /></div><main className="main-content" key={activeId} onScroll={e => useWorkspace.getState().rememberScroll(activeId, e.currentTarget.scrollTop)} ref={el => { if (el) el.scrollTop = useWorkspace.getState().scroll[activeId] || 0; }}><Outlet /></main></div></div><ConfirmDialog open={!!pending} title={t('common.discard')} description={t('common.discardHelp')} onClose={() => setPending(null)} onConfirm={() => { pending?.(); setPending(null); }} /></>;
}
