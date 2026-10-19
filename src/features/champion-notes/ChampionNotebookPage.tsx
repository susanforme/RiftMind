import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '../../components/ui/collapsible';
import { useState } from 'react';
import { ChevronRight, BookOpen, MoreHorizontal, Play, Plus, Upload } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { notebookRoute } from '../../app/router';
import { transport } from '../../app/runtime';
import { queryClient } from '../../app/query-client';
import { championName } from '../../lib/display-names';
import type { NotebookEntry, NotebookKind, NotebookSource } from '../../generated/contracts';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Label } from '../../components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { ChampionSelect } from '../../components/ChampionSelect';
import { GameEntityIcon, portraitCatalogueVersion } from '../../components/GameEntityIcon';
import { ChampionArtwork, selectedChampionSkin } from '../../components/ChampionArtwork';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { ErrorNotice } from '../../components/ErrorNotice';
import { SearchSelect } from '../../components/SearchSelect';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ComboSequence } from './ComboEditor';
import { BuildGroups } from '../builds/ItemBuildEditor';
import { NotebookEntryEditor } from './NotebookEntryEditor';
import { NotebookTransferDialog } from './NotebookTransferDialog';
import { PracticeChecklist } from './PracticeChecklist';
import { blankNotebook, useNotebookDrafts, downloadJson } from './notebook-drafts';
export function ChampionNotebookPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = notebookRoute.useSearch();
  const championId = search.champion || 64;
  const artworkLocale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';
  const skins = useQuery({
    queryKey: ['champion-skins', portraitCatalogueVersion, artworkLocale, championId],
    queryFn: () =>
      transport.call('get_champion_skins', {
        championId,
        version: portraitCatalogueVersion,
        locale: artworkLocale,
      }),
    staleTime: Infinity,
    retry: false,
  });
  const [kind, setKind] = useState<NotebookKind>('note');
  const [text, setText] = useState('');
  const [trash, setTrash] = useState(false);
  const [opponent, setOpponent] = useState<number>();
  const [patch, setPatch] = useState('');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [historyEntry, setHistoryEntry] = useState<NotebookEntry | null>(null);
  const [purge, setPurge] = useState<NotebookEntry | null>(null);
  const [transfer, setTransfer] = useState(false);
  const drafts = useNotebookDrafts((state) => state.drafts);
  const setDraft = useNotebookDrafts((state) => state.setDraft);
  const app = useQuery({ queryKey: ['app'], queryFn: () => transport.call('get_app_state', {}) });
  const epoch = app.data?.workspaceEpoch;
  const notebooks = useQuery({
    queryKey: ['notebooks', epoch, championId, trash],
    queryFn: () =>
      transport.call('list_notebook_entries', {
        championId,
        kind: null,
        search: '',
        opponentId: null,
        trash,
      }),
    enabled: !!epoch,
  });
  const history = useQuery({
    queryKey: ['notebook-history', epoch, historyEntry?.id, historyEntry?.revision],
    queryFn: () => transport.call('get_notebook_history', { id: historyEntry!.id }),
    enabled: !!historyEntry,
  });
  const change = useMutation({
    mutationFn: ({
      entry,
      action,
      revision,
    }: {
      entry: NotebookEntry;
      action: string;
      revision?: number;
    }) =>
      transport.call('change_notebook_entry', {
        workspaceEpoch: epoch!,
        id: entry.id,
        expectedRevision: entry.revision,
        action,
        restoreRevision: revision || null,
        confirmPermanent: action === 'purge',
      }),
    onSuccess: () => {
      setHistoryEntry(null);
      setPurge(null);
      void queryClient.invalidateQueries({ queryKey: ['notebooks'] });
      void queryClient.invalidateQueries({ queryKey: ['practices'] });
    },
  });
  const practice = useMutation({
    mutationFn: (entry: NotebookEntry) =>
      transport.call('save_practice_entry', {
        workspaceEpoch: epoch!,
        expectedRevision: 0,
        delete: false,
        entry: {
          id: crypto.randomUUID(),
          championId,
          title: entry.content.title,
          sourceId: entry.id,
          sourceRevision: entry.revision,
          state: 'pending',
          notes: '',
          revision: 0,
          updatedAt: '',
        },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['practices'] }),
  });
  function edit(entry: NotebookEntry | null, copy = false) {
    const key = `${epoch}:${entry && !copy ? entry.id : `${championId}:new`}`;
    if (!drafts[key])
      setDraft(key, {
        epoch: epoch!,
        entry: copy ? null : entry,
        content: entry
          ? {
              ...structuredClone(entry.content),
              title: copy ? `${entry.content.title} (${t('notebooks.copy')})` : entry.content.title,
            }
          : blankNotebook(championId, kind),
      });
    setDraftKey(key);
  }
  const entries = notebooks.data || [];
  const visible = entries.filter((entry) => {
    const content = entry.content;
    const review = reviewStatus(entry, patch);
    return (
      content.kind === kind &&
      (!opponent || content.opponentId === opponent) &&
      `${content.title} ${content.text} ${content.tags.join(' ')}`
        .toLowerCase()
        .includes(text.toLowerCase()) &&
      (reviewFilter === 'all' || review === reviewFilter)
    );
  });
  const selected = search.entry ? entries.find((entry) => entry.id === search.entry) : null;
  return (
    <div
      data-ui="page"
      className="mx-auto grid w-full max-w-[1600px] min-w-0 gap-5 p-6 max-[900px]:p-4 [&_[data-ui~=actions]]:flex-wrap [&_label]:grid [&_label]:gap-1.5 [&_label]:text-xs"
    >
      <div data-ui="page-heading" className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('notebooks.titlePage')}</h1>
        <div data-ui="actions" className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setTransfer(true)} disabled={!epoch}>
            <Upload aria-hidden="true" className="size-4" />
            {t('notebooks.exchange')}
          </Button>
          <Button disabled={!epoch || trash} onClick={() => edit(null)}>
            <Plus aria-hidden="true" className="size-4" />
            {t('notebooks.create')}
          </Button>
        </div>
      </div>
      <Card
        data-ui="notebook-identity"
        className="relative isolate overflow-hidden border-primary/20"
      >
        <ChampionArtwork
          skin={selectedChampionSkin(skins.data?.skins || [], undefined)}
          version={portraitCatalogueVersion}
          banner
        />
        <CardContent className="relative flex flex-wrap items-center gap-6 pt-5">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <GameEntityIcon
              kind="champion"
              id={championId}
              label={championName(t, championId)}
              className="size-20 rounded-xl border border-primary/40"
            />
            <div className="grid min-w-0 gap-2">
              <h2 className="text-2xl font-semibold">{championName(t, championId)}</h2>
              <ChampionSelect
                value={championId}
                onValueChange={(champion) => {
                  if (champion) void navigate({ to: '/notebooks', search: { champion } });
                }}
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-end gap-3">
            <Label>
              {t('notebooks.search')}
              <Input
                aria-label={t('notebooks.search')}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </Label>
            <Label>
              {t('notebooks.targetPatch')}
              <Input
                aria-label={t('notebooks.targetPatch')}
                value={patch}
                onChange={(event) => setPatch(event.target.value)}
              />
            </Label>
            <SearchSelect
              label={t('notebooks.reviewStatus')}
              value={reviewFilter}
              options={['all', 'unmarked', 'needs_review', 'confirmed'].map((status) => ({
                value: status,
                label: t(`notebooks.review_${status}`),
              }))}
              onValueChange={setReviewFilter}
            />
            <Button
              variant={trash ? 'secondary' : 'outline'}
              aria-pressed={trash}
              onClick={() => setTrash(!trash)}
            >
              {t('notebooks.trash')}
            </Button>
          </div>
        </CardContent>
      </Card>
      <ErrorNotice error={notebooks.error || change.error || practice.error} />
      {Object.entries(drafts)
        .filter(([, draft]) => draft.epoch === epoch && draft.content.championId === championId)
        .map(([key, draft]) => (
          <Button key={key} variant="outline" onClick={() => setDraftKey(key)}>
            {t('notebooks.resumeDraft')}:{' '}
            {draft.content.title || t(`notebooks.kind_${draft.content.kind}`)}
          </Button>
        ))}
      {selected && (
        <Card>
          <CardContent>
            <NotebookEntryView entry={selected} patch={patch} />
            <Button onClick={() => edit(selected)}>{t('notebooks.edit')}</Button>
          </CardContent>
        </Card>
      )}
      <Tabs value={kind} onValueChange={(kind) => setKind(kind as NotebookKind)}>
        <TabsList
          aria-label={t('notebooks.categories')}
          className="h-11 w-full justify-start rounded-none border-b border-border bg-transparent p-0"
        >
          {(['note', 'combo', 'matchup', 'build'] as NotebookKind[]).map((kind) => (
            <TabsTrigger
              key={kind}
              value={kind}
              className="h-11 rounded-none border-b-2 border-transparent px-5 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              {t(`notebooks.kind_${kind}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {kind === 'matchup' && (
        <div data-ui="actions" className="flex items-center gap-2">
          <Label>{t('notebooks.opponent')}</Label>
          <ChampionSelect value={opponent} onValueChange={setOpponent} />
        </div>
      )}
      <div
        data-ui="notebook-layout"
        className="grid min-w-0 items-start gap-5 min-[1120px]:grid-cols-[minmax(0,1fr)_320px]"
      >
        <div
          data-ui="review-stack"
          className="grid min-w-0 grid-cols-1 overflow-hidden rounded-xl border border-border bg-card"
        >
          {!visible.length && (
            <Card>
              <CardContent>
                <p>{t(notebooks.isPending ? 'common.loading' : 'notebooks.empty')}</p>
              </CardContent>
            </Card>
          )}
          {visible.map((entry) => (
            <Card
              key={entry.id}
              className="rounded-none border-0 border-b border-border bg-transparent last:border-b-0"
            >
              <CardContent data-ui="review-stack" className="grid min-w-0 grid-cols-1 gap-4 pt-5">
                <NotebookEntryView entry={entry} patch={patch} />
                <div data-ui="actions" className="flex items-center gap-2">
                  {trash ? (
                    <>
                      <Button
                        variant="outline"
                        disabled={change.isPending}
                        onClick={() => change.mutate({ entry, action: 'recover' })}
                      >
                        {t('notebooks.recover')}
                      </Button>
                      <Button variant="destructive" onClick={() => setPurge(entry)}>
                        {t('notebooks.purge')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline" onClick={() => edit(entry)}>
                        {t('notebooks.edit')}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={practice.isPending}
                        onClick={() => practice.mutate(entry)}
                      >
                        <Play aria-hidden="true" className="size-4" />
                        {t('notebooks.addPractice')}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${t('notebooks.edit')}: ${entry.content.title}`}
                          >
                            <MoreHorizontal aria-hidden="true" className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setHistoryEntry(entry)}>
                            {t('notebooks.history')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => edit(entry, true)}>
                            {t('notebooks.copy')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={change.isPending}
                            onSelect={() => change.mutate({ entry, action: 'trash' })}
                          >
                            {t('review.delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </div>
                {!trash && entry.content.kind === 'build' && (
                  <BuildActions entry={entry} epoch={epoch!} />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
        {epoch && (
          <PracticeChecklist
            key={`${epoch}:${championId}`}
            championId={championId}
            epoch={epoch}
            entries={entries}
          />
        )}
      </div>
      {draftKey && drafts[draftKey] && (
        <NotebookEntryEditor
          key={draftKey}
          draftKey={draftKey}
          entries={entries}
          onClose={() => setDraftKey(null)}
        />
      )}
      <Dialog
        open={!!historyEntry}
        onOpenChange={(open) => {
          if (!open) setHistoryEntry(null);
        }}
      >
        <DialogContent
          className="w-[min(900px,calc(100vw_-_32px))] max-w-[900px] max-h-[calc(100dvh_-_48px)] overflow-auto [&_fieldset]:min-w-0 [&_fieldset]:border-0 [&_fieldset]:p-0"
          closeLabel={t('common.dismiss')}
        >
          <DialogHeader>
            <DialogTitle>
              {t('notebooks.history')}: {historyEntry?.content.title}
            </DialogTitle>
          </DialogHeader>
          <ErrorNotice error={history.error || change.error} />
          {history.data?.revisions.map((revision) => (
            <Card key={revision.revision}>
              <CardHeader>
                <CardTitle>
                  v{revision.revision} · {new Date(revision.updatedAt).toLocaleString()}
                </CardTitle>
              </CardHeader>
              <CardContent data-ui="review-stack" className="grid grid-cols-1 gap-4 min-w-0">
                <NotebookEntryView entry={revision} fixedLinks />
                <Button
                  variant="outline"
                  disabled={change.isPending || revision.revision === historyEntry?.revision}
                  onClick={() =>
                    change.mutate({
                      entry: historyEntry!,
                      action: 'restore',
                      revision: revision.revision,
                    })
                  }
                >
                  {t('notebooks.restoreRevision')}
                </Button>
              </CardContent>
            </Card>
          ))}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!purge}
        title={t('notebooks.purge')}
        description={t('notebooks.purgeImpact', { title: purge?.content.title })}
        onClose={() => setPurge(null)}
        onConfirm={() => {
          if (purge) change.mutate({ entry: purge, action: 'purge' });
        }}
      />
      {transfer && epoch && (
        <NotebookTransferDialog
          championId={championId}
          epoch={epoch}
          entries={entries}
          onClose={() => setTransfer(false)}
        />
      )}
    </div>
  );
}
export function reviewStatus(entry: NotebookEntry, patch?: string) {
  return !entry.content.confirmedPatch
    ? 'unmarked'
    : !patch || entry.content.confirmedPatch !== patch || entry.reviewedRevision !== entry.revision
      ? 'needs_review'
      : 'confirmed';
}
export function NotebookEntryView({
  entry,
  patch,
  fixedLinks = false,
}: {
  entry: NotebookEntry;
  patch?: string;
  fixedLinks?: boolean;
}) {
  const { t } = useTranslation();
  const content = entry.content;
  return (
    <div data-ui="review-stack" className="grid grid-cols-1 gap-4 min-w-0">
      <div data-ui="actions" className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-lg font-semibold wrap-anywhere">{content.title}</h3>
        {content.pinned && (
          <Badge variant="secondary">
            <BookOpen aria-hidden="true" className="mr-1 size-3" />
            {t('notebooks.pinned')}
          </Badge>
        )}
        <Badge variant="outline">{t(`notebooks.review_${reviewStatus(entry, patch)}`)}</Badge>
        {content.confirmedPatch && <span>{content.confirmedPatch}</span>}
      </div>
      <div data-ui="actions" className="flex items-center gap-2">
        <GameEntityIcon
          kind="champion"
          id={content.championId}
          label={championName(t, content.championId)}
        />
        {content.opponentId && (
          <>
            <span>vs</span>
            <GameEntityIcon
              kind="champion"
              id={content.opponentId}
              label={championName(t, content.opponentId)}
            />
            <span>{championName(t, content.opponentId)}</span>
          </>
        )}
        {content.tags.map((tag) => (
          <Badge key={tag} variant="secondary">
            {tag}
          </Badge>
        ))}
      </div>
      {content.steps.length > 0 && (
        <ComboSequence championId={content.championId} steps={content.steps} />
      )}{' '}
      {content.groups.length > 0 && (
        <BuildGroups groups={content.groups} version={content.resourceVersion} />
      )}
      {content.text.length > 200 ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="group h-auto min-h-9 w-full justify-start gap-2 px-0 py-2 text-left text-sm font-normal whitespace-normal text-muted-foreground"
            >
              <ChevronRight
                aria-hidden="true"
                className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
              />
              {t('notebooks.readContent')}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent forceMount className="hidden min-w-0 pb-2 data-[state=open]:block">
            <p className="whitespace-pre-wrap wrap-anywhere leading-[1.65] max-w-[78ch]">
              {content.text}
            </p>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        content.text && (
          <p className="whitespace-pre-wrap wrap-anywhere leading-[1.65] max-w-[78ch]">
            {content.text}
          </p>
        )
      )}
      {content.links.map((link) => (
        <NotebookContentLink
          key={link.entryId}
          id={link.entryId}
          revision={fixedLinks ? link.revision : undefined}
        />
      ))}
      {content.sources.map((source, index) => (
        <NotebookReviewSource key={index} source={source} />
      ))}
    </div>
  );
}
function NotebookContentLink({ id, revision }: { id: string; revision?: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const linked = useQuery({
    queryKey: ['notebook-link', id],
    queryFn: () => transport.call('get_notebook_history', { id }),
    retry: false,
  });
  const entry = revision
    ? linked.data?.revisions.find((entry) => entry.revision === revision)
    : linked.data?.revisions[0];
  return (
    <>
      <Button variant="link" disabled={!entry} onClick={() => setOpen(true)}>
        {entry ? entry.content.title : t('notebooks.sourceUnavailable')}
        {entry?.deleted ? ` (${t('notebooks.trash')})` : ''}
        {revision ? ` · v${revision}` : ''}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={t('common.dismiss')}>
          <DialogHeader>
            <DialogTitle>{entry?.content.title}</DialogTitle>
          </DialogHeader>
          {entry && (
            <>
              <ComboSequence championId={entry.content.championId} steps={entry.content.steps} />
              <BuildGroups groups={entry.content.groups} version={entry.content.resourceVersion} />
              <p className="whitespace-pre-wrap wrap-anywhere leading-[1.65] max-w-[78ch]">
                {entry.content.text}
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function BuildActions({ entry, epoch }: { entry: NotebookEntry; epoch: string }) {
  const { t } = useTranslation();
  const [targetVersion, setTargetVersion] = useState(entry.content.resourceVersion || '');
  const [resolution, setResolution] = useState('apply');
  const connection = useQuery({
    queryKey: ['connection'],
    queryFn: () => transport.call('get_connection_state', {}),
  });
  const exportBuild = useMutation({
    mutationFn: async () => {
      const result = await transport.call('export_item_build', {
        entryId: entry.id,
        targetVersion,
        mapId: entry.content.mapId || 11,
      });
      if (result.json) {
        if (transport.mode === 'desktop')
          await transport.call('save_item_build_file', {
            entryId: entry.id,
            targetVersion,
            mapId: entry.content.mapId || 11,
          });
        else downloadJson(result.json, `item-set-${entry.content.championId}.json`);
      }
      return result;
    },
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
  return (
    <div data-ui="review-stack" className="grid grid-cols-1 gap-4 min-w-0">
      <ErrorNotice error={exportBuild.error || apply.error} />
      <div data-ui="actions" className="flex items-center gap-2">
        <Label>
          {t('notebooks.targetVersion')}
          <Input
            aria-label={t('notebooks.targetVersion')}
            value={targetVersion}
            onChange={(event) => setTargetVersion(event.target.value)}
          />
        </Label>
        <Button
          variant="outline"
          disabled={exportBuild.isPending}
          onClick={() => exportBuild.mutate()}
        >
          {t('notebooks.exportItemSet')}
        </Button>
        <SearchSelect
          label={t('notebooks.applyMode')}
          value={resolution}
          options={['apply', 'new', 'overwrite'].map((mode) => ({
            value: mode,
            label: t(`notebooks.apply_${mode}`),
          }))}
          onValueChange={setResolution}
        />
        <Button
          disabled={apply.isPending || connection.data?.phase !== 'connected'}
          onClick={() => apply.mutate()}
        >
          {t('notebooks.applyClient')}
        </Button>
        <span>{connection.data?.player?.displayName}</span>
      </div>
      {exportBuild.data?.issues.map((issue) => (
        <p key={issue} role="alert">
          {t('notebooks.buildIssue', { issue })}
        </p>
      ))}
      {apply.data && <p role="status">{t(`notebooks.application_${apply.data.state}`)}</p>}
    </div>
  );
}

function NotebookReviewSource({ source }: { source: NotebookSource }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const app = useQuery({ queryKey: ['app'], queryFn: () => transport.call('get_app_state', {}) });
  const reference = useQuery({
    queryKey: [
      'notebook-review-source',
      app.data?.workspaceEpoch,
      source.matchKey,
      source.playerKey,
      source.reportId,
    ],
    queryFn: () =>
      transport.call('get_match_review_data', {
        matchKey: source.matchKey,
        playerKey: source.playerKey,
        reportId: source.reportId,
        inputRevision: null,
      }),
    retry: false,
    enabled: !!app.data?.workspaceEpoch,
  });
  return (
    <Button
      variant="link"
      disabled={reference.isPending || reference.isError}
      onClick={() =>
        void navigate({
          to: '/matches/$matchKey/review',
          params: { matchKey: source.matchKey },
          search: {
            player: source.playerKey,
            report: source.reportId || undefined,
            evidence: source.evidenceId || undefined,
          },
        })
      }
    >
      {t(reference.isError ? 'notebooks.sourceUnavailable' : 'notebooks.reviewSource')}
    </Button>
  );
}
