import { useState } from 'react';
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
import { GameEntityIcon } from '../../components/GameEntityIcon';
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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = notebookRoute.useSearch();
  const championId = search.champion || 64;
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
      className="max-w-[1400px] pt-[30px] px-9 pb-[26px] m-auto max-[1150.01px]:p-[26px] max-[900.01px]:p-[22px] max-[650.01px]:py-[18px] max-[650.01px]:px-4 [&_details_>_summary]:cursor-pointer [&_details_>_summary]:py-2 [&_details_>_summary]:px-0 [&_details_>_summary]:wrap-anywhere [&_details_>_summary:focus-visible]:[outline:2px_solid_var(--ring)]"
    >
      <div
        data-ui="page-heading"
        className="flex items-center justify-between gap-6 mb-7 max-[650.01px]:mb-[22px] max-[650.01px]:gap-2.5"
      >
        <h1>{t('notebooks.titlePage')}</h1>
        <div data-ui="actions" className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setTransfer(true)} disabled={!epoch}>
            {t('notebooks.exchange')}
          </Button>
          <Button disabled={!epoch || trash} onClick={() => edit(null)}>
            {t('notebooks.create')}
          </Button>
        </div>
      </div>
      <Card>
        <CardContent className="flex items-end gap-4 flex-wrap pt-5 [&_>_[data-slot=input-group]]:flex-1 [&_>_[data-slot=input-group]]:min-w-[180px] [&_>_[data-slot=input-group]]:max-w-60">
          <div className="flex items-center gap-3 min-w-[220px]">
            <GameEntityIcon
              kind="champion"
              id={championId}
              label={championName(t, championId)}
              className="size-14"
            />
            <ChampionSelect
              value={championId}
              onValueChange={(champion) => {
                if (champion) void navigate({ to: '/notebooks', search: { champion } });
              }}
            />
          </div>
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
        <TabsList aria-label={t('notebooks.categories')}>
          {(['note', 'combo', 'matchup', 'build'] as NotebookKind[]).map((kind) => (
            <TabsTrigger key={kind} value={kind}>
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
        className="grid grid-cols-[minmax(0,2fr)_minmax(260px,1fr)] gap-5 items-start max-[1000.01px]:grid-cols-1 [&_>_[data-ui~=review-stack]_>_[data-slot='card']_>_[data-slot='card-content']]:pt-5"
      >
        <div data-ui="review-stack" className="grid grid-cols-1 gap-4 min-w-0">
          {!visible.length && (
            <Card>
              <CardContent>
                <p>{t(notebooks.isPending ? 'common.loading' : 'notebooks.empty')}</p>
              </CardContent>
            </Card>
          )}
          {visible.map((entry) => (
            <Card key={entry.id}>
              <CardContent data-ui="review-stack" className="grid grid-cols-1 gap-4 min-w-0">
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
                      <Button variant="ghost" onClick={() => setHistoryEntry(entry)}>
                        {t('notebooks.history')}
                      </Button>
                      <Button variant="ghost" onClick={() => edit(entry, true)}>
                        {t('notebooks.copy')}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={practice.isPending}
                        onClick={() => practice.mutate(entry)}
                      >
                        {t('notebooks.addPractice')}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={change.isPending}
                        onClick={() => change.mutate({ entry, action: 'trash' })}
                      >
                        {t('review.delete')}
                      </Button>
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
        <h3>{content.title}</h3>
        {content.pinned && <Badge>{t('notebooks.pinned')}</Badge>}
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
        <details>
          <summary>{t('notebooks.readContent')}</summary>
          <p className="whitespace-pre-wrap wrap-anywhere leading-[1.65] max-w-[78ch]">
            {content.text}
          </p>
        </details>
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
