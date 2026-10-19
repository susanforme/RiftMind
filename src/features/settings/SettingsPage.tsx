import { cn } from '../../lib/utils';
import { codeName, playerName } from '../../lib/display-names';
import { serverName } from '../../lib/server-name';
import { Label } from '../../components/ui/label';
import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Globe2,
  Sun,
  Moon,
  Monitor,
  Palette,
  Cable,
  RefreshCw,
  Database,
  ShieldCheck,
  Download,
  Save,
  Check,
  HardDrive,
  FolderArchive,
  Image,
} from 'lucide-react';
import { transport } from '../../app/runtime';
import { awaitMaintenance } from '../../lib/transport/tasks';
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
import { Switch } from '../../components/ui/switch';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorNotice } from '../../components/ErrorNotice';
import type { Settings, SettingsPatch } from '../../generated/contracts';
const settingsPanelClassName =
  'rounded-xl px-6 py-5 scroll-mt-20 max-[650.01px]:p-4 max-[650.01px]:scroll-mt-16';
const settingsHeadingClassName =
  'flex items-center gap-3 border-b pb-4 text-base [&_svg]:w-[17px] [&_svg]:text-muted-foreground';
const settingsFieldClassName =
  'grid grid-cols-[minmax(0,1fr)_minmax(160px,230px)] items-center gap-x-6 gap-y-1.5 border-b py-4 last:border-b-0 last:pb-0 max-[650.01px]:grid-cols-1 max-[650.01px]:gap-2.5';
const settingsLabelClassName = 'flex items-center gap-1.5 text-[13px] leading-none [&>svg]:hidden';
const settingsControlClassName =
  'col-start-2 row-span-2 row-start-1 w-full max-[650.01px]:col-start-1 max-[650.01px]:row-auto';
const settingsHelpClassName =
  'col-start-1 row-start-2 text-[11px] leading-[1.7] max-[650.01px]:row-auto';
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between text-[13px] py-[18px] px-0 gap-6 border-b border-b-border [&_label]:cursor-pointer last:border-b-0 last:pb-0">
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
export function SettingsPage() {
  const { t } = useTranslation();
  const { draft, dirty, setDraft } = useWorkspace();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => transport.call('get_settings', {}),
  });
  const connection = useQuery({
    queryKey: ['connection'],
    queryFn: () => transport.call('get_connection_state', {}),
  });
  const instances = useQuery({
    queryKey: ['instances'],
    queryFn: () => transport.call('list_client_instances', {}),
  });
  const usage = useQuery({
    queryKey: ['usage'],
    queryFn: () => transport.call('get_storage_usage', {}),
  });
  const app = useQuery({ queryKey: ['app'], queryFn: () => transport.call('get_app_state', {}) });
  const [message, setMessage] = useState<{ key: string; params?: Record<string, string> } | null>(
    null,
  );
  const [backupId, setBackupId] = useState('');
  const [restoring, setRestoring] = useState(false);
  useEffect(() => {
    if (settings.data && !dirty) setDraft(settings.data, false);
  }, [settings.data, dirty, setDraft]);
  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('No settings');
      // Only preference fields are committed; tab autosave cannot be overwritten by a stale form.
      const patch: SettingsPatch = {
        languagePreference: draft.languagePreference,
        colorModePreference: draft.colorModePreference,
        sidebarCollapsed: draft.sidebarCollapsed,
        closeBehavior: draft.closeBehavior,
        autoConnect: draft.autoConnect,
        autoSync: draft.autoSync,
        syncPages: draft.syncPages,
        themeId: null,
        workspaceTabs: null,
        activeTab: null,
      };
      return transport.call('update_settings', { expectedRevision: draft.revision, patch });
    },
    onSuccess: (value) => {
      queryClient.setQueryData(['settings'], value);
      setDraft(value, false);
      setMessage({ key: 'common.saved' });
    },
  });
  const operation = useMutation({
    mutationFn: async (action: string) => {
      if (action === 'clear') {
        await transport.call('clear_asset_cache', {});
        return { key: 'settings.cleared' };
      }
      if (action === 'backup') {
        const result = await awaitMaintenance(await transport.call('create_backup', {}));
        setBackupId(result.reference);
        return { key: 'settings.backupCreated', params: { id: result.reference } };
      }
      if (action === 'restore') {
        await awaitMaintenance(await transport.call('restore_backup', { id: backupId }));
        setDraft(null, false);
        void queryClient.invalidateQueries();
        return { key: 'settings.restored' };
      }
      if (action === 'diagnostics') {
        const result = await awaitMaintenance(await transport.call('export_diagnostics', {}));
        return { key: 'settings.exported', params: { id: result.reference } };
      }
      if (action === 'update' || action === 'install') {
        const result = await transport.call(
          action === 'update' ? 'check_for_updates' : 'install_update',
          {},
        );
        void queryClient.invalidateQueries({ queryKey: ['app'] });
        return {
          key: result.reason
            ? `errors.${result.reason.toLowerCase()}`
            : `settings.update_${result.state}`,
        };
      }
      await transport.call('retry_connection', {});
      return null;
    },
    onSuccess: (value) => {
      setMessage(value);
      void queryClient.invalidateQueries({ queryKey: ['usage'] });
      void queryClient.invalidateQueries({ queryKey: ['connection'] });
    },
  });
  const selectInstance = useMutation({
    mutationFn: (id: string) => transport.call('select_client_instance', { id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['connection'] }),
  });
  function change<K extends keyof Settings>(key: K, value: Settings[K]) {
    if (draft) {
      setDraft({ ...draft, [key]: value });
      setMessage(null);
    }
  }
  const bytes = (n = 0) =>
    `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(n / 1024 / 1024)} MB`;
  if (!draft)
    return (
      <>
        <p>{t('common.loading')}</p>
        <ErrorNotice error={settings.error} />
        <Button onClick={() => void settings.refetch()}>{t('common.retry')}</Button>
      </>
    );
  return (
    <div
      data-ui="page settings-page"
      className="p-6 m-auto max-[900.01px]:p-5 max-[650.01px]:p-4 max-w-[1160px]"
    >
      <div
        data-ui="page-heading"
        className="sticky top-0 z-10 -mx-6 -mt-6 flex items-center justify-between gap-6 bg-background px-6 py-6 max-[900.01px]:-mx-5 max-[900.01px]:-mt-5 max-[900.01px]:px-5 max-[900.01px]:pt-5 max-[650.01px]:-mx-4 max-[650.01px]:-mt-4 max-[650.01px]:gap-2.5 max-[650.01px]:px-4 max-[650.01px]:pt-4 max-[650.01px]:pb-5"
      >
        <div>
          <h1>{t('settings.title')}</h1>
        </div>
        <span className="shrink-0 whitespace-nowrap text-[12px] text-muted-foreground [&_span]:ml-1.5">
          RiftMind <span>v{app.data?.appVersion || '0.1.0'}</span>
        </span>
      </div>
      <div className="grid grid-cols-[156px_minmax(0,_1fr)] gap-7 items-start max-[1150.01px]:grid-cols-[140px_minmax(0,_1fr)] max-[1150.01px]:gap-5 max-[900.01px]:block">
        <nav
          className="grid gap-1 sticky top-24 [&_[data-slot=button]]:h-auto [&_[data-slot=button]]:min-h-9 [&_[data-slot=button]]:whitespace-normal [&_[data-slot=button]]:text-left [&_[data-slot=button]]:justify-start [&_[data-slot=button]]:py-2 [&_[data-slot=button]]:px-2.5 [&_[data-slot=button]]:text-[13px] [&_[data-slot=button]]:gap-[9px] max-[900.01px]:static max-[900.01px]:flex max-[900.01px]:flex-wrap max-[900.01px]:border-b max-[900.01px]:border-b-border max-[900.01px]:mb-5 max-[900.01px]:pb-3 max-[900.01px]:gap-0.5 max-[900.01px]:[&_[data-slot=button]]:py-1.5 max-[900.01px]:[&_[data-slot=button]]:px-2 max-[900.01px]:[&_[data-slot=button]]:text-[12px] max-[900.01px]:[&_[data-slot=button]]:gap-1.5"
          aria-label={t('settings.sections')}
        >
          {(['general', 'client', 'sync', 'storage', 'diagnostics', 'updates'] as const).map(
            (section, index) => {
              const Icon = [Palette, Cable, RefreshCw, Database, ShieldCheck, Download][index];
              return (
                <Button
                  variant="ghost"
                  key={section}
                  onClick={() =>
                    document
                      .getElementById(`settings-${section}`)
                      ?.scrollIntoView({ block: 'start' })
                  }
                >
                  <Icon aria-hidden="true" size={15} />
                  {t(`settings.${section}`)}
                </Button>
              );
            },
          )}
        </nav>
        <div className="grid gap-5 min-w-0">
          <div className="contents">
            <Card className={settingsPanelClassName} id="settings-general">
              <h2 className={settingsHeadingClassName}>
                <Palette aria-hidden="true" size={18} />
                {t('settings.general')}
              </h2>
              <div className={settingsFieldClassName}>
                <Label className={settingsLabelClassName} htmlFor="language">
                  <Globe2 aria-hidden="true" size={15} />
                  {t('settings.language')}
                </Label>
                <Select
                  value={draft.languagePreference}
                  onValueChange={(value) => change('languagePreference', value)}
                >
                  <SelectTrigger
                    className={settingsControlClassName}
                    id="language"
                    aria-describedby="language-help"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">{t('common.system')}</SelectItem>
                    <SelectItem value="zh-CN">简体中文</SelectItem>
                    <SelectItem value="en-US">English</SelectItem>
                  </SelectContent>
                </Select>
                <small className={settingsHelpClassName} id="language-help">
                  {t('settings.languageHelp')}
                </small>
              </div>
              <fieldset className={settingsFieldClassName}>
                <legend className="float-left w-full p-0 text-[13px]">
                  {t('settings.appearance')}
                </legend>
                <RadioGroup
                  className={cn(
                    settingsControlClassName,
                    'flex gap-[3px] rounded-[7px] border p-[3px]',
                  )}
                  aria-label={t('settings.appearance')}
                  value={draft.colorModePreference}
                  onValueChange={(mode) =>
                    change('colorModePreference', mode as Settings['colorModePreference'])
                  }
                >
                  {(['light', 'dark', 'system'] as const).map((mode, index) => {
                    const Icon = [Sun, Moon, Monitor][index];
                    return (
                      <Label
                        className="relative flex flex-1 cursor-pointer items-center gap-1.5 text-[13px] leading-none"
                        key={mode}
                      >
                        <RadioGroupItem
                          className="peer absolute inset-0 size-full opacity-0"
                          value={mode}
                          aria-label={t(`common.${mode}`)}
                        />
                        <span className="pointer-events-none flex w-full items-center justify-center gap-[5px] rounded-sm px-[3px] py-2 text-[11px] text-muted-foreground peer-data-[state=checked]:bg-accent peer-data-[state=checked]:text-accent-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-ring peer-focus-visible:outline-offset-2">
                          <Icon aria-hidden="true" size={16} />
                          {t(`common.${mode}`)}
                        </span>
                      </Label>
                    );
                  })}
                </RadioGroup>
              </fieldset>
              <Toggle
                label={t('settings.sidebar')}
                checked={draft.sidebarCollapsed}
                onChange={(v) => change('sidebarCollapsed', v)}
              />
              <div className={settingsFieldClassName}>
                <Label className={settingsLabelClassName} htmlFor="close-behavior">
                  {t('settings.closeBehavior')}
                </Label>
                <Select
                  value={draft.closeBehavior}
                  onValueChange={(value) =>
                    change('closeBehavior', value as Settings['closeBehavior'])
                  }
                >
                  <SelectTrigger className={settingsControlClassName} id="close-behavior">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tray">{t('settings.tray')}</SelectItem>
                    <SelectItem value="exit">{t('settings.exit')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Card>
            <Card className={settingsPanelClassName} id="settings-client">
              <h2 className={settingsHeadingClassName}>
                <Cable aria-hidden="true" size={18} />
                {t('settings.client')}
              </h2>
              <Toggle
                label={t('settings.autoConnect')}
                checked={draft.autoConnect}
                onChange={(v) => change('autoConnect', v)}
              />
              <div className="flex items-center gap-2 text-[12px] mt-[18px] mx-0 mb-2 flex-wrap [&_strong]:font-medium [&_>_span:last-child]:text-muted-foreground [&_>_span:last-child]:ml-auto">
                <span
                  data-online={connection.data?.phase === 'connected'}
                  className="w-[7px] h-[7px] rounded-full bg-muted-foreground data-[online=true]:bg-(--success)"
                />
                <strong>{t(`connection.${connection.data?.phase || 'disconnected'}`)}</strong>
                <span>{serverName(t, connection.data?.identification?.serverId)}</span>
              </div>
              {connection.data?.player && (
                <p className="text-muted-foreground text-[12px]">
                  {playerName(t, connection.data.player)} ·{' '}
                  {codeName(t, 'realm', connection.data.identification?.realm)} ·{' '}
                  {codeName(t, 'environment', connection.data.identification?.environment)}
                </p>
              )}
              {(instances.data?.length || 0) > 1 && (
                <div className={settingsFieldClassName}>
                  <Label className={settingsLabelClassName} htmlFor="instance">
                    {t('settings.instance')}
                  </Label>
                  <Select
                    value={connection.data?.instance?.id || ''}
                    onValueChange={(value) => selectInstance.mutate(value)}
                  >
                    <SelectTrigger className={settingsControlClassName} id="instance">
                      <SelectValue placeholder={t('settings.chooseInstance')} />
                    </SelectTrigger>
                    <SelectContent>
                      {instances.data?.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {t('labels.clientProcess', { pid: i.pid })} ·{' '}
                          {serverName(t, i.identification.serverId)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button
                variant="outline"
                disabled={operation.isPending}
                onClick={() => operation.mutate('retry')}
              >
                <RefreshCw aria-hidden="true" size={14} />
                {t('settings.retryConnection')}
              </Button>
              <ErrorNotice error={selectInstance.error} />
            </Card>
            <Card className={settingsPanelClassName} id="settings-sync">
              <h2 className={settingsHeadingClassName}>
                <RefreshCw aria-hidden="true" size={18} />
                {t('settings.sync')}
              </h2>
              <Toggle
                label={t('settings.autoSync')}
                checked={draft.autoSync}
                onChange={(v) => change('autoSync', v)}
              />
              <div className={settingsFieldClassName}>
                <Label className={settingsLabelClassName} htmlFor="sync-pages">
                  {t('settings.syncPages')}
                </Label>
                <Select
                  value={String(draft.syncPages)}
                  onValueChange={(value) => change('syncPages', Number(value))}
                >
                  <SelectTrigger
                    className={settingsControlClassName}
                    id="sync-pages"
                    aria-describedby="sync-help"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 3, 5, 10, 20].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {t('settings.pages', { count: n })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <small className={settingsHelpClassName} id="sync-help">
                  {t('settings.syncHelp')}
                </small>
              </div>
            </Card>
          </div>
          <div className="contents">
            <Card className={settingsPanelClassName} id="settings-storage">
              <h2 className={settingsHeadingClassName}>
                <Database aria-hidden="true" size={18} />
                {t('settings.storage')}
              </h2>
              <div className="grid gap-3.5 my-5 mx-0 [&_>_div]:flex [&_>_div]:items-center [&_>_div]:gap-[9px] [&_>_div]:text-[13px] [&_svg]:text-muted-foreground [&_svg]:w-[15px] [&_strong]:ml-auto [&_strong]:font-medium [&_strong]:tabular-nums">
                {[
                  [HardDrive, 'database', usage.data?.databaseBytes],
                  [Image, 'assets', usage.data?.assetBytes],
                  [FolderArchive, 'backups', usage.data?.backupBytes],
                ].map(([Icon, key, n]) => {
                  const I = Icon as typeof HardDrive;
                  return (
                    <div key={String(key)}>
                      <I aria-hidden="true" size={16} />
                      <span>{t(`settings.${key}`)}</span>
                      <strong>{bytes(n as number)}</strong>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2 items-center [&_[data-slot=button]]:whitespace-normal">
                <Button
                  variant="outline"
                  disabled={operation.isPending}
                  onClick={() => operation.mutate('clear')}
                >
                  {t('settings.clear')}
                </Button>
                <Button
                  variant="outline"
                  disabled={operation.isPending}
                  onClick={() => operation.mutate('backup')}
                >
                  <FolderArchive aria-hidden="true" size={15} />
                  {t('settings.createBackup')}
                </Button>
                {import.meta.env.DEV &&
                  import.meta.env.MODE === 'development' &&
                  import.meta.env.VITE_DEV_TOOLS === 'true' && (
                    <Label
                      className={cn(
                        settingsFieldClassName,
                        'basis-full border-0 py-2.5 text-[13px]',
                      )}
                    >
                      {t('settings.restoreId')}
                      <Input
                        className={settingsControlClassName}
                        value={backupId}
                        onChange={(e) => setBackupId(e.target.value)}
                        maxLength={256}
                      />
                    </Label>
                  )}
                <Button
                  variant="ghost"
                  disabled={operation.isPending || (transport.mode !== 'desktop' && !backupId)}
                  onClick={() => setRestoring(true)}
                >
                  {t('settings.restoreBackup')}
                </Button>
              </div>
              <p className="my-3.5 max-w-[65ch] text-[12px] leading-[1.8] text-muted-foreground">
                {t('settings.restoreWarning')}
              </p>
            </Card>
            <Card className={settingsPanelClassName} id="settings-diagnostics">
              <h2 className={settingsHeadingClassName}>
                <ShieldCheck aria-hidden="true" size={18} />
                {t('settings.diagnostics')}
              </h2>
              <div className="flex justify-between gap-5 pt-[18px] items-center">
                <small>{t('settings.version')}</small>
                <code>
                  {app.data?.appVersion || '0.1.0'} / {app.data?.databaseVersion || 1} /{' '}
                  {app.data?.settingsVersion || 1}
                </code>
              </div>
              <p className="my-3.5 max-w-[65ch] text-[12px] leading-[1.8] text-muted-foreground">
                {t('settings.exportHelp')}
              </p>
              <Button
                variant="outline"
                disabled={operation.isPending}
                onClick={() => operation.mutate('diagnostics')}
              >
                <Download aria-hidden="true" size={15} />
                {t('settings.export')}
              </Button>
            </Card>
            <Card className={settingsPanelClassName} id="settings-updates">
              <h2 className={settingsHeadingClassName}>
                <Download aria-hidden="true" size={18} />
                {t('settings.updates')}
              </h2>
              <p className="my-3.5 max-w-[65ch] text-[12px] leading-[1.8] text-muted-foreground">
                {app.data?.updateStatus.reason
                  ? t(`errors.${app.data.updateStatus.reason.toLowerCase()}`)
                  : t(`settings.update_${app.data?.updateStatus.state || 'idle'}`)}{' '}
                {app.data?.updateStatus.version}
              </p>
              {app.data?.updateStatus.state === 'downloading' && (
                <Progress
                  aria-label={t('settings.updates')}
                  value={
                    app.data.updateStatus.total
                      ? (app.data.updateStatus.downloaded / app.data.updateStatus.total) * 100
                      : null
                  }
                />
              )}
              {app.data?.updateStatus.state === 'available' && (
                <Button disabled={operation.isPending} onClick={() => operation.mutate('install')}>
                  {t('settings.installUpdate')}
                </Button>
              )}
              <Button
                variant="outline"
                disabled={operation.isPending}
                onClick={() => operation.mutate('update')}
              >
                {t('settings.checkUpdate')}
              </Button>
            </Card>
          </div>
        </div>
      </div>
      <ErrorNotice error={usage.error || app.error || operation.error || save.error} />
      <div
        data-ui="save-bar"
        className="sticky bottom-0 bg-card border border-border rounded-xl py-3 px-5 flex gap-5 justify-between items-center mt-6 ml-[184px] text-[12px] [box-shadow:var(--shadow)] z-2 [&_>_div:first-child]:wrap-anywhere [&_>_div:first-child]:min-w-0 [&_>_div:first-child]:text-muted-foreground max-[1150.01px]:ml-40 max-[900.01px]:ml-0 max-[650.01px]:p-3 max-[650.01px]:gap-2.5 max-[650.01px]:flex-wrap max-[650.01px]:[&_>_div:first-child]:basis-full max-[650.01px]:[&_[data-ui~=actions]]:flex-wrap"
      >
        <div aria-live="polite">
          {operation.isPending ? (
            t('settings.maintenance')
          ) : message ? (
            <span className="flex items-center gap-1.5 text-(--success)">
              <Check aria-hidden="true" size={15} />
              {t(message.key, message.params || {})}
            </span>
          ) : dirty ? (
            t('common.unsaved')
          ) : (
            t('common.saved')
          )}
        </div>
        <div data-ui="actions" className="flex items-center gap-2">
          {save.error && (
            <Button
              variant="outline"
              onClick={async () => {
                const latest = await settings.refetch();
                if (latest.data) setDraft({ ...draft, revision: latest.data.revision });
              }}
            >
              {t('settings.reloadSettings')}
            </Button>
          )}
          <Button
            disabled={!dirty || save.isPending || operation.isPending}
            onClick={() => save.mutate()}
          >
            <Save aria-hidden="true" size={15} />
            {t(save.isPending ? 'common.saving' : 'common.save')}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={restoring}
        title={t('settings.restoreTitle')}
        description={t('settings.restoreWarning')}
        onClose={() => setRestoring(false)}
        onConfirm={() => {
          setRestoring(false);
          operation.mutate('restore');
        }}
      />
    </div>
  );
}
