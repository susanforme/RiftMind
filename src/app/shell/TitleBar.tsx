import { useEffect, useState, type ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTranslation } from 'react-i18next';
import { Copy, Minus, Square, Swords, X } from 'lucide-react';
import { transport } from '../runtime';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../../components/ui/context-menu';

export function TitleBar({
  children,
  sidebarToggle,
}: {
  children?: ReactNode;
  sidebarToggle?: ReactNode;
}) {
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
      if (stopped) unlisten();
      else cleanups.push(unlisten);
    };
    void Promise.all([
      listen(
        appWindow.onResized(() => {
          void refresh().catch(() => {
            if (!stopped) setFailed(true);
          });
        }),
      ),
      listen(
        appWindow.onFocusChanged(({ payload }) => {
          if (!stopped) setFocused(payload);
        }),
      ),
      refresh(),
      appWindow.isFocused().then((value) => {
        if (!stopped) setFocused(value);
      }),
    ]).catch(() => {
      if (!stopped) setFailed(true);
    });
    return () => {
      stopped = true;
      cleanups.forEach((unlisten) => unlisten());
    };
  }, [desktop]);
  async function act(action: 'minimize' | 'toggleMaximize' | 'close') {
    setFailed(false);
    try {
      const appWindow = getCurrentWindow();
      await appWindow[action]();
      if (action === 'toggleMaximize') setMaximized(await appWindow.isMaximized());
    } catch {
      setFailed(true);
    }
  }
  const maximizeLabel = t(maximized ? 'common.restore' : 'common.maximize');
  const bar = (
    <header
      className="col-span-full flex items-stretch min-w-0 h-12 bg-(--titlebar) border-b border-b-border select-none [&[data-focused=false]_[data-ui~=titlebar-brand]]:text-muted-foreground [&[data-focused=false]_[data-ui~=window-controls]_[data-slot=button]:not(:hover)]:text-muted-foreground [&[data-focused=false]_[data-ui~=titlebar-brand]_svg]:text-inherit [&_>_[data-orientation]]:min-w-0 [&_>_[data-orientation]]:overflow-hidden [&_>_[data-orientation]]:mt-2"
      data-focused={focused}
    >
      <div
        data-ui="titlebar-brand"
        className="[&:has([data-ui~=sidebar-toggle])]:py-0 [&:has([data-ui~=sidebar-toggle])]:px-2.5 [&:has([data-ui~=sidebar-toggle])]:gap-1.5 [&_[data-ui~=sidebar-toggle]_svg]:text-muted-foreground flex items-center gap-2.5 [flex:0_0_208px] py-0 px-[18px] font-semibold text-[14px] transition-[flex-basis,padding] duration-200 ease-in-out [&>span]:pointer-events-none [&>svg]:pointer-events-none [&_svg]:text-primary [&_svg]:shrink-0 [[data-collapsed=true]_&]:basis-[64px] [[data-collapsed=true]_&]:p-0 [[data-collapsed=true]_&]:justify-center [[data-collapsed=true]_&_span]:hidden max-[900.01px]:basis-[64px] max-[900.01px]:p-0 max-[900.01px]:justify-center max-[900.01px]:[&_span]:hidden"
        data-tauri-drag-region
      >
        <Swords
          className="[[data-collapsed=true]_&]:hidden max-[900.01px]:hidden"
          size={24}
          aria-hidden="true"
        />
        <span className="flex-1 text-base tracking-wide">RiftMind</span>
        {sidebarToggle}
      </div>
      {children}
      <div className="flex-1 min-w-12 touch-none" data-tauri-drag-region />
      <div
        data-ui="window-controls"
        className="flex shrink-0 [&_[data-slot=button]]:w-[46px] [&_[data-slot=button]]:h-[47px] [&_[data-slot=button]]:rounded-none [&_[data-slot=button]]:text-foreground [&_[data-slot=button]]:p-0 [&_[data-slot=button]_svg]:w-3.5 [&_[data-slot=button]_svg]:h-3.5 [&_[data-slot=button]:focus-visible]:-outline-offset-1 [&_[data-slot=button]:active]:bg-muted [&_[data-ui~=window-close]:hover]:bg-(--window-close) [&_[data-ui~=window-close]:hover]:text-(--window-close-foreground) [&_[data-ui~=window-close]:active]:bg-(--window-close) [&_[data-ui~=window-close]:active]:text-(--window-close-foreground) forced-colors:[&_[data-slot=button]]:border forced-colors:[&_[data-slot=button]]:border-[ButtonText] forced-colors:[&_[data-slot=button]:hover]:bg-[Highlight] forced-colors:[&_[data-slot=button]:hover]:text-[HighlightText]"
        role="group"
        aria-label={t('common.windowControls')}
      >
        <Button
          variant="ghost"
          size="icon"
          disabled={!desktop}
          aria-label={t('common.minimize')}
          title={t('common.minimize')}
          onClick={() => void act('minimize')}
        >
          <Minus aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={!desktop}
          aria-label={maximizeLabel}
          title={maximizeLabel}
          onClick={() => void act('toggleMaximize')}
        >
          {maximized ? <Copy aria-hidden="true" /> : <Square aria-hidden="true" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={!desktop}
          data-ui="window-close"
          aria-label={t('common.windowClose')}
          title={t('common.windowClose')}
          onClick={() => void act('close')}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </header>
  );
  return (
    <>
      {desktop ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{bar}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => void act('minimize')}>
              {t('common.minimize')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => void act('toggleMaximize')}>
              {maximizeLabel}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => void act('close')}>
              {t('common.windowClose')}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        bar
      )}
      {failed && (
        <Alert
          variant="destructive"
          className="fixed top-14 right-3 z-40 w-[min(420px,_calc(100%_-_24px))] flex items-center gap-3 bg-card [&_[data-slot=button]]:shrink-0 [&_[data-slot=button]]:ml-auto"
        >
          <AlertDescription>{t('common.windowActionFailed')}</AlertDescription>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('common.dismiss')}
            onClick={() => setFailed(false)}
          >
            <X aria-hidden="true" />
          </Button>
        </Alert>
      )}
    </>
  );
}
