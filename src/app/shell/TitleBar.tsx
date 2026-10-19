import { useEffect, useState, type ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTranslation } from 'react-i18next';
import { Copy, Minus, Square, Swords, X } from 'lucide-react';
import { transport } from '../runtime';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '../../components/ui/context-menu';

export function TitleBar({ children, sidebarToggle }: { children?: ReactNode; sidebarToggle?: ReactNode }) {
  const { t } = useTranslation();
  const desktop = transport.mode === 'desktop';
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    let stopped = false;
    const cleanups: (() => void)[] = [];
    const appWindow = getCurrentWindow();
    const refresh = async () => {
      const value = await appWindow.isMaximized();
      if (!stopped) setMaximized(value);
    };
    const listen = async (subscription: Promise<() => void>) => {
      const unlisten = await subscription;
      if (stopped) unlisten(); else cleanups.push(unlisten);
    };
    void Promise.all([
      listen(appWindow.onResized(() => { void refresh().catch(() => { if (!stopped) setFailed(true); }); })),
      listen(appWindow.onFocusChanged(({ payload }) => { if (!stopped) setFocused(payload); })),
      refresh(),
      appWindow.isFocused().then(value => { if (!stopped) setFocused(value); }),
    ]).catch(() => { if (!stopped) setFailed(true); });
    return () => { stopped = true; cleanups.forEach(unlisten => unlisten()); };
  }, [desktop]);
  async function act(action: 'minimize' | 'toggleMaximize' | 'close') {
    setFailed(false);
    try {
      const appWindow = getCurrentWindow();
      await appWindow[action]();
      if (action === 'toggleMaximize') setMaximized(await appWindow.isMaximized());
    } catch { setFailed(true); }
  }
  const maximizeLabel = t(maximized ? 'common.restore' : 'common.maximize');
  const bar = <header className="titlebar" data-focused={focused}>
    <div className="titlebar-brand" data-tauri-drag-region>{sidebarToggle || <Swords size={18} aria-hidden="true" />}<span>RiftMind</span></div>
    {children}
    <div className="drag-region" data-tauri-drag-region />
    <div className="window-controls" role="group" aria-label={t('common.windowControls')}>
      <Button variant="ghost" size="icon" disabled={!desktop} aria-label={t('common.minimize')} title={t('common.minimize')} onClick={() => void act('minimize')}><Minus aria-hidden="true" /></Button>
      <Button variant="ghost" size="icon" disabled={!desktop} aria-label={maximizeLabel} title={maximizeLabel} onClick={() => void act('toggleMaximize')}>{maximized ? <Copy aria-hidden="true" /> : <Square aria-hidden="true" />}</Button>
      <Button variant="ghost" size="icon" disabled={!desktop} className="window-close" aria-label={t('common.windowClose')} title={t('common.windowClose')} onClick={() => void act('close')}><X aria-hidden="true" /></Button>
    </div>
  </header>;
  return <>{desktop ? <ContextMenu><ContextMenuTrigger asChild>{bar}</ContextMenuTrigger><ContextMenuContent>
    <ContextMenuItem onSelect={() => void act('minimize')}>{t('common.minimize')}</ContextMenuItem>
    <ContextMenuItem onSelect={() => void act('toggleMaximize')}>{maximizeLabel}</ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem onSelect={() => void act('close')}>{t('common.windowClose')}</ContextMenuItem>
  </ContextMenuContent></ContextMenu> : bar}
    {failed && <Alert variant="destructive" className="window-error"><AlertDescription>{t('common.windowActionFailed')}</AlertDescription><Button variant="ghost" size="icon" aria-label={t('common.dismiss')} onClick={() => setFailed(false)}><X aria-hidden="true" /></Button></Alert>}
  </>;
}
