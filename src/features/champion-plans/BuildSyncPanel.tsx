import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Download, RefreshCw, Settings2, Upload } from 'lucide-react';
import { transport } from '../../app/runtime';
import { queryClient } from '../../app/query-client';
import type { NotebookEntry } from '../../generated/contracts';
import { ErrorNotice } from '../../components/ErrorNotice';
import { SearchSelect } from '../../components/SearchSelect';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { Badge } from '../../components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible';
import { downloadJson } from '../champion-notes/notebook-drafts';

export function BuildSyncPanel({ entry, epoch }: { entry: NotebookEntry; epoch: string }) {
  const { t, i18n } = useTranslation();
  const [targetVersion, setTargetVersion] = useState(entry.content.resourceVersion || '');
  const [resolution, setResolution] = useState('apply');
  const connection = useQuery({
    queryKey: ['connection'],
    queryFn: () => transport.call('get_connection_state', {}),
  });
  const clientAvailable =
    connection.data?.phase === 'connected' ||
    (connection.data?.lcuReady && connection.data.phase === 'waiting_auth');
  const live = useQuery({
    queryKey: ['live', epoch, connection.data?.sessionEpoch],
    queryFn: () => transport.call('get_live_snapshot', {}),
    enabled: !!clientAvailable,
    refetchInterval: 5000,
  });
  const rules = useQuery({
    queryKey: ['notebooks', epoch, 'build-sync', entry.content.championId],
    queryFn: () =>
      transport.call('list_build_sync_rules', { championId: entry.content.championId }),
    refetchInterval: 5000,
  });
  const currentRule = rules.data?.find((rule) => rule.mapId === entry.content.mapId);
  const selectedRule = currentRule?.entryId === entry.id ? currentRule : undefined;
  const automatic = selectedRule?.enabled || false;
  const hasEquipment = entry.content.groups.some((group) => group.items.length > 0);
  const saveRule = useMutation({
    mutationFn: (enabled: boolean) =>
      transport.call('save_build_sync_rule', {
        workspaceEpoch: epoch,
        entryId: entry.id,
        expectedRevision: currentRule?.revision || 0,
        enabled,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notebooks'] }),
  });
  const apply = useMutation({
    mutationFn: () =>
      transport.call('apply_item_build', {
        workspaceEpoch: epoch,
        entryId: entry.id,
        expectedRevision: entry.revision,
        targetVersion,
        mapId: entry.content.mapId || 11,
        saveAsNew: resolution === 'new',
        overwriteRemote: resolution === 'overwrite',
      }),
  });
  const exportBuild = useMutation({
    mutationFn: async () => {
      const request = { entryId: entry.id, targetVersion, mapId: entry.content.mapId || 11 };
      const result = await transport.call('export_item_build', request);
      if (result.json) {
        if (transport.mode === 'desktop') await transport.call('save_item_build_file', request);
        else downloadJson(result.json, `item-set-${entry.content.championId}.json`);
      }
      return result;
    },
  });
  const canApply =
    clientAvailable &&
    !live.data?.stale &&
    ['Lobby', 'ChampSelect'].includes(live.data?.phase || '');
  return (
    <Card data-ui="build-sync" className="border-primary/25 bg-primary/5">
      <CardContent className="grid gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Switch
              id={`auto-sync-${entry.id}`}
              checked={automatic}
              disabled={
                saveRule.isPending ||
                rules.isPending ||
                rules.isError ||
                (!hasEquipment && !automatic)
              }
              onCheckedChange={(enabled) => saveRule.mutate(enabled)}
            />
            <Label htmlFor={`auto-sync-${entry.id}`}>{t('notebooks.autoSync')}</Label>
          </div>
          <Button
            disabled={!canApply || !hasEquipment || apply.isPending}
            onClick={() => apply.mutate()}
          >
            <Upload aria-hidden="true" />
            {t(apply.isPending ? 'notebooks.syncing' : 'notebooks.applyClient')}
          </Button>
        </div>
        <ErrorNotice
          error={
            rules.error ||
            saveRule.error ||
            apply.error ||
            exportBuild.error ||
            (selectedRule?.error ? { code: selectedRule.error } : null)
          }
        />
        {!hasEquipment && (
          <p className="text-xs text-muted-foreground">{t('notebooks.configureEquipmentFirst')}</p>
        )}
        {currentRule?.enabled && !automatic && (
          <p className="text-xs text-muted-foreground">{t('notebooks.otherPlanActive')}</p>
        )}
        <div className="flex flex-wrap items-center gap-2" role="status">
          {automatic && (
            <Badge variant="outline">
              {t(`notebooks.sync_${selectedRule?.state || 'waiting'}`)}
            </Badge>
          )}
          {!clientAvailable ? (
            <span className="text-xs text-muted-foreground">{t('notebooks.waitingClient')}</span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {connection.data?.player?.displayName}
            </span>
          )}
          {automatic && selectedRule?.state === 'applied' && (
            <time className="text-xs text-muted-foreground" dateTime={selectedRule.updatedAt}>
              {new Date(selectedRule.updatedAt).toLocaleTimeString(i18n.language)}
            </time>
          )}
          {automatic &&
            ['failed', 'pending', 'unavailable'].includes(selectedRule?.state || '') && (
              <Button
                variant="outline"
                size="sm"
                disabled={saveRule.isPending}
                onClick={() => saveRule.mutate(true)}
              >
                <RefreshCw aria-hidden="true" />
                {t('notebooks.retrySync')}
              </Button>
            )}
          {apply.data && (
            <span className="text-xs">{t(`notebooks.application_${apply.data.state}`)}</span>
          )}
        </div>
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group px-0">
              <Settings2 aria-hidden="true" />
              {t('notebooks.syncOptions')}
              <ChevronDown aria-hidden="true" className="group-data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="grid gap-3 pt-3">
            <div className="grid gap-3 min-[1100px]:grid-cols-2">
              <Label>
                {t('notebooks.targetVersion')}
                <Input
                  aria-label={t('notebooks.targetVersion')}
                  value={targetVersion}
                  onChange={(event) => setTargetVersion(event.target.value)}
                />
              </Label>
              <div className="grid gap-1.5">
                <Label>{t('notebooks.applyMode')}</Label>
                <SearchSelect
                  label={t('notebooks.applyMode')}
                  value={resolution}
                  options={['apply', 'new', 'overwrite'].map((mode) => ({
                    value: mode,
                    label: t(`notebooks.apply_${mode}`),
                  }))}
                  onValueChange={setResolution}
                />
              </div>
            </div>
            <Button
              variant="outline"
              className="justify-self-start"
              disabled={!hasEquipment || exportBuild.isPending}
              onClick={() => exportBuild.mutate()}
            >
              <Download aria-hidden="true" />
              {t('notebooks.exportItemSet')}
            </Button>
            {exportBuild.data?.issues.map((issue) => (
              <p key={issue} role="alert">
                {t('notebooks.buildIssue', { issue })}
              </p>
            ))}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
