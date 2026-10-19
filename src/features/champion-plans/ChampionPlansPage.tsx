import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '../../components/ui/collapsible';
import { useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  FileText,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Pin,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Swords,
  Trash2,
  Upload,
  X,
  Zap,
  Shield,
} from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useWorkspaceNavigate, useWorkspaceSearch } from '../../app/workspace-page-context';
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
import { Skeleton } from '../../components/ui/skeleton';
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
import { ComboSequence } from '../champion-notes/ComboEditor';
import { BuildGroups } from '../builds/ItemBuildEditor';
import { NotebookEntryEditor } from '../champion-notes/NotebookEntryEditor';
import { NotebookEntryList } from '../champion-notes/NotebookEntryList';
import { NotebookTransferDialog } from '../champion-notes/NotebookTransferDialog';
import { PracticeChecklist } from '../champion-notes/PracticeChecklist';
import { blankNotebook, useNotebookDrafts } from '../champion-notes/notebook-drafts';
import { BuildSyncPanel } from './BuildSyncPanel';
import { SkillOrderView } from './SkillOrderEditor';
import {
  filterNotebookEntries,
  notebookKinds,
  reviewStatus,
  type NotebookCategory,
} from '../champion-notes/notebook-browser';

const categoryIcons = { all: BookOpen, note: FileText, combo: Zap, matchup: Swords, build: Shield };

export function ChampionPlansPage() {
  const search = useWorkspaceSearch(notebookRoute.useSearch({ shouldThrow: false }));
  // Champion-specific filters and mobile navigation reset when changing notebooks.
  return <ChampionPlansWorkspace key={search.champion || 64} championId={search.champion || 64} />;
}

function ChampionPlansWorkspace({ championId }: { championId: number }) {
  const { t, i18n } = useTranslation();
  const navigate = useWorkspaceNavigate();
  const search = useWorkspaceSearch(notebookRoute.useSearch({ shouldThrow: false }));
  const [category, setCategory] = useState<NotebookCategory>(search.entry ? 'all' : 'build');
  const [text, setText] = useState('');
  const [trash, setTrash] = useState(false);
  const [opponent, setOpponent] = useState<number>();
  const [patch, setPatch] = useState('');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [sort, setSort] = useState('updated');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(!!search.entry);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [historyEntry, setHistoryEntry] = useState<NotebookEntry | null>(null);
  const [purge, setPurge] = useState<NotebookEntry | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [practiceDirty, setPracticeDirty] = useState(false);
  const [discardPractice, setDiscardPractice] = useState(false);
  const drafts = useNotebookDrafts((state) => state.drafts);
  const setDraft = useNotebookDrafts((state) => state.setDraft);
  const app = useQuery({ queryKey: ['app'], queryFn: () => transport.call('get_app_state', {}) });
  const epoch = app.data?.workspaceEpoch;
  const skins = useQuery({
    queryKey: ['champion-skins', portraitCatalogueVersion, i18n.language, championId],
    queryFn: () =>
      transport.call('get_champion_skins', {
        championId,
        version: portraitCatalogueVersion,
        locale: i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US',
      }),
    staleTime: Infinity,
    retry: false,
  });
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
  const practices = useQuery({
    queryKey: ['practices', epoch, championId],
    queryFn: () =>
      transport.call('list_practice_entries', {
        championId,
        kind: null,
        search: '',
        opponentId: null,
        trash: false,
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['practices'] });
      setPracticeOpen(true);
    },
  });
  const pin = useMutation({
    mutationFn: (entry: NotebookEntry) =>
      transport.call('save_notebook_entry', {
        workspaceEpoch: epoch!,
        id: entry.id,
        expectedRevision: entry.revision,
        content: { ...entry.content, pinned: !entry.content.pinned },
        confirmPatch: null,
      }),
    onSuccess: (entry) => {
      void navigate({
        to: '/notebooks',
        search: { champion: championId, entry: entry.id },
        replace: true,
      });
      return queryClient.invalidateQueries({ queryKey: ['notebooks'] });
    },
  });
  function edit(entry: NotebookEntry | null, copy = false, kind?: NotebookKind) {
    if (!epoch) return;
    const entryKind = kind || entry?.content.kind || (category === 'all' ? 'build' : category);
    const key = copy
      ? `${epoch}:${championId}:copy:${crypto.randomUUID()}`
      : `${epoch}:${entry?.id || `${championId}:new:${entryKind}`}`;
    if (!drafts[key])
      setDraft(key, {
        epoch,
        entry: copy ? null : entry,
        content: entry
          ? {
              ...structuredClone(entry.content),
              title: copy ? `${entry.content.title} (${t('notebooks.copy')})` : entry.content.title,
            }
          : blankNotebook(championId, entryKind),
      });
    setDraftKey(key);
  }
  const entries = notebooks.data || [];
  const filters = { category, query: text, opponent, patch, review: reviewFilter, sort };
  const visible = filterNotebookEntries(entries, filters);
  const selected = visible.find((entry) => entry.id === search.entry) || visible[0];
  const championDrafts = Object.entries(drafts).filter(
    ([, draft]) => draft.epoch === epoch && draft.content.championId === championId,
  );
  const hasFilters = !!text.trim() || !!opponent || reviewFilter !== 'all';
  const practiceExists = practices.data?.some((practice) => practice.sourceId === selected?.id);
  function clearSelection() {
    setMobileDetail(false);
    void navigate({ to: '/notebooks', search: { champion: championId }, replace: true });
  }
  function resetFilters() {
    setText('');
    setOpponent(undefined);
    setReviewFilter('all');
    setPatch('');
  }
  return (
    <div
      data-ui="page notebook-page"
      className="mx-auto flex h-full min-h-0 w-full max-w-[1600px] flex-col gap-4 p-6 max-[900px]:p-4 [&_[data-ui~=actions]]:flex-wrap [&_label]:grid [&_label]:gap-1.5 [&_label]:text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('notebooks.titlePage')}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={!epoch} onClick={() => setPracticeOpen(true)}>
            <ListChecks aria-hidden="true" />
            {t('notebooks.practice')}
            {!!practices.data?.length && (
              <span className="tabular-nums">{practices.data.length}</span>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('notebooks.exchange')}
            title={t('notebooks.exchange')}
            disabled={!epoch}
            onClick={() => setTransfer(true)}
          >
            <Upload aria-hidden="true" />
          </Button>
          <Button disabled={!epoch || trash} onClick={() => edit(null)}>
            <Plus aria-hidden="true" />
            {t('notebooks.create')}
          </Button>
        </div>
      </div>
      <Card
        data-ui="notebook-identity"
        className="relative isolate shrink-0 overflow-hidden border-primary/20"
      >
        <ChampionArtwork
          skin={selectedChampionSkin(skins.data?.skins || [], undefined)}
          version={portraitCatalogueVersion}
          banner
        />
        <CardContent className="relative flex items-center justify-between gap-4 p-5 max-[680px]:gap-2 max-[680px]:p-4">
          <div className="flex min-w-0 flex-1 items-center gap-4 max-[680px]:gap-3">
            <GameEntityIcon
              kind="champion"
              id={championId}
              label={championName(t, championId)}
              className="size-16 rounded-xl border border-primary/40 max-[680px]:size-12"
            />
            <div className="grid min-w-0 flex-1 gap-2">
              <h2 className="text-2xl font-semibold tracking-tight max-[680px]:text-xl">
                {championName(t, championId)}
              </h2>
              <div className="w-full max-w-48">
                <ChampionSelect
                  value={championId}
                  onValueChange={(champion) => {
                    if (champion) void navigate({ to: '/notebooks', search: { champion } });
                  }}
                />
              </div>
            </div>
          </div>
          <Button
            variant={trash ? 'secondary' : 'outline'}
            aria-pressed={trash}
            aria-label={t('notebooks.trash')}
            title={t('notebooks.trash')}
            className="shrink-0 max-[680px]:size-9 max-[680px]:p-0"
            onClick={() => {
              setTrash(!trash);
              clearSelection();
            }}
          >
            <Trash2 aria-hidden="true" />
            <span className="max-[680px]:sr-only">{t('notebooks.trash')}</span>
          </Button>
        </CardContent>
      </Card>
      <ErrorNotice
        error={notebooks.error || change.error || practice.error || pin.error || practices.error}
      />
      {championDrafts.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-2">
          {championDrafts.map(([key, draft]) => (
            <Button key={key} variant="outline" size="sm" onClick={() => setDraftKey(key)}>
              <Pencil aria-hidden="true" />
              {t('notebooks.resumeDraft')}:{' '}
              {draft.content.title || t(`notebooks.kind_${draft.content.kind}`)}
            </Button>
          ))}
        </div>
      )}
      <Card
        data-ui="notebook-layout"
        className="flex min-h-[360px] min-w-0 flex-1 flex-col overflow-hidden"
      >
        <Tabs
          value={category}
          onValueChange={(value) => {
            setCategory(value as NotebookCategory);
            setOpponent(undefined);
            clearSelection();
          }}
          className="shrink-0 overflow-x-auto border-b border-border px-3"
        >
          <TabsList
            aria-label={t('notebooks.categories')}
            className="h-12 justify-start gap-1 rounded-none bg-transparent p-0"
          >
            {(['all', ...notebookKinds] as NotebookCategory[]).map((kind) => {
              const Icon = categoryIcons[kind];
              return (
                <TabsTrigger
                  key={kind}
                  value={kind}
                  className="h-12 gap-2 rounded-none border-b-2 border-transparent px-3 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary"
                >
                  <Icon aria-hidden="true" className="size-4 max-[600px]:hidden" />
                  {t(kind === 'all' ? 'notebooks.allEntries' : `notebooks.kind_${kind}`)}
                  <span aria-hidden="true" className="text-xs tabular-nums text-muted-foreground">
                    {kind === 'all'
                      ? entries.length
                      : entries.filter((entry) => entry.content.kind === kind).length}
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,30%)_minmax(0,1fr)] max-[680px]:grid-cols-1">
          <section
            aria-label={t('notebooks.directory')}
            className={`flex min-h-0 min-w-0 flex-col border-r border-border max-[680px]:border-r-0 ${mobileDetail ? 'max-[680px]:hidden' : ''}`}
          >
            <div className="grid shrink-0 gap-3 border-b border-border p-3">
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
                />
                <Input
                  aria-label={t('notebooks.search')}
                  placeholder={t('notebooks.search')}
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                    setMobileDetail(false);
                  }}
                  className="pr-9 pl-9"
                />
                {text && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('notebooks.clearSearch')}
                    className="absolute top-0 right-0 size-9"
                    onClick={() => setText('')}
                  >
                    <X aria-hidden="true" />
                  </Button>
                )}
              </div>
              <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
                <div className="flex items-center justify-between gap-2">
                  <span role="status" className="text-xs text-muted-foreground">
                    {t('notebooks.entryCount', { count: visible.length })}
                  </span>
                  <CollapsibleTrigger asChild>
                    <Button variant={hasFilters ? 'secondary' : 'ghost'} size="sm">
                      <SlidersHorizontal aria-hidden="true" />
                      {t('notebooks.filters')}
                    </Button>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent className="grid gap-3 pt-3">
                  <SearchSelect
                    label={t('notebooks.sort')}
                    value={sort}
                    options={['updated', 'title'].map((value) => ({
                      value,
                      label: t(`notebooks.sort_${value}`),
                    }))}
                    onValueChange={setSort}
                  />
                  <Label>
                    {t('notebooks.targetPatch')}
                    <Input
                      aria-label={t('notebooks.targetPatch')}
                      value={patch}
                      onChange={(event) => setPatch(event.target.value.trim())}
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
                  {category === 'matchup' && (
                    <div className="grid gap-1.5">
                      <Label>{t('notebooks.opponent')}</Label>
                      <ChampionSelect value={opponent} onValueChange={setOpponent} />
                    </div>
                  )}
                  {hasFilters && (
                    <Button variant="ghost" size="sm" onClick={resetFilters}>
                      {t('notebooks.resetFilters')}
                    </Button>
                  )}
                </CollapsibleContent>
              </Collapsible>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {notebooks.isPending ? (
                <div aria-label={t('common.loading')} className="grid gap-3 p-4">
                  <Skeleton className="h-24" />
                  <Skeleton className="h-24" />
                  <Skeleton className="h-24" />
                </div>
              ) : visible.length ? (
                <NotebookEntryList
                  entries={visible}
                  selectedId={selected?.id}
                  onSelect={(entry) => {
                    setMobileDetail(true);
                    void navigate({
                      to: '/notebooks',
                      search: { champion: championId, entry: entry.id },
                      replace: true,
                    });
                  }}
                />
              ) : (
                <div className="grid justify-items-center gap-3 p-6 py-10 text-center">
                  <Search aria-hidden="true" className="size-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {t(
                      notebooks.isError
                        ? 'notebooks.loadFailed'
                        : hasFilters
                          ? 'notebooks.noResults'
                          : trash
                            ? 'notebooks.trashEmpty'
                            : 'notebooks.emptyCategory',
                    )}
                  </p>
                  {notebooks.isError ? (
                    <Button variant="outline" onClick={() => void notebooks.refetch()}>
                      {t('notebooks.retry')}
                    </Button>
                  ) : hasFilters ? (
                    <Button variant="outline" onClick={resetFilters}>
                      {t('notebooks.resetFilters')}
                    </Button>
                  ) : (
                    !trash && (
                      <Button variant="outline" disabled={!epoch} onClick={() => edit(null)}>
                        <Plus aria-hidden="true" />
                        {t('notebooks.create')}
                      </Button>
                    )
                  )}
                </div>
              )}
            </div>
          </section>
          <section
            aria-label={t('notebooks.reader')}
            className={`flex min-h-0 min-w-0 flex-col ${mobileDetail ? '' : 'max-[680px]:hidden'}`}
          >
            {selected ? (
              <>
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border p-3">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="min-[681px]:hidden"
                      aria-label={t('notebooks.backToList')}
                      onClick={clearSelection}
                    >
                      <ArrowLeft aria-hidden="true" />
                    </Button>
                    <Badge variant="secondary" className="max-[680px]:hidden">
                      {t(`notebooks.kind_${selected.content.kind}`)}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {trash ? (
                      <>
                        <Button
                          variant="outline"
                          disabled={change.isPending}
                          onClick={() => change.mutate({ entry: selected, action: 'recover' })}
                        >
                          {t('notebooks.recover')}
                        </Button>
                        <Button variant="destructive" onClick={() => setPurge(selected)}>
                          {t('notebooks.purge')}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="max-[680px]:hidden"
                          aria-label={t(
                            selected.content.pinned ? 'notebooks.unpin' : 'notebooks.pinned',
                          )}
                          title={t(
                            selected.content.pinned ? 'notebooks.unpin' : 'notebooks.pinned',
                          )}
                          aria-pressed={selected.content.pinned}
                          disabled={pin.isPending}
                          onClick={() => pin.mutate(selected)}
                        >
                          <Pin
                            aria-hidden="true"
                            className={
                              selected.content.pinned ? 'fill-primary/20 text-primary' : ''
                            }
                          />
                        </Button>
                        <Button
                          variant="outline"
                          className="max-[680px]:size-9 max-[680px]:p-0"
                          title={t(
                            practiceExists ? 'notebooks.inPractice' : 'notebooks.addPractice',
                          )}
                          disabled={practice.isPending || practices.isPending || practices.isError}
                          onClick={() =>
                            practiceExists ? setPracticeOpen(true) : practice.mutate(selected)
                          }
                        >
                          {practiceExists ? (
                            <Check aria-hidden="true" />
                          ) : (
                            <Play aria-hidden="true" />
                          )}
                          <span className="max-[680px]:sr-only">
                            {t(practiceExists ? 'notebooks.inPractice' : 'notebooks.addPractice')}
                          </span>
                        </Button>
                        <Button onClick={() => edit(selected)}>
                          <Pencil aria-hidden="true" />
                          {t('notebooks.edit')}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`${t('notebooks.moreActions')}: ${selected.content.title}`}
                            >
                              <MoreHorizontal aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="min-[681px]:hidden"
                              disabled={pin.isPending}
                              onSelect={() => pin.mutate(selected)}
                            >
                              {t(selected.content.pinned ? 'notebooks.unpin' : 'notebooks.pinned')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setHistoryEntry(selected)}>
                              {t('notebooks.history')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => edit(selected, true)}>
                              {t('notebooks.copy')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={change.isPending}
                              onSelect={() => change.mutate({ entry: selected, action: 'trash' })}
                            >
                              {t('review.delete')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    )}
                  </div>
                </div>
                <div
                  key={selected.id}
                  data-ui="notebook-reader"
                  className="min-h-0 flex-1 overflow-y-auto p-6 max-[900px]:p-4"
                >
                  <NotebookEntryView
                    entry={selected}
                    patch={patch}
                    expanded
                    clientControls={
                      !trash && selected.content.kind === 'build' ? (
                        <BuildSyncPanel
                          key={`${selected.id}:${selected.revision}`}
                          entry={selected}
                          epoch={epoch!}
                        />
                      ) : undefined
                    }
                  />
                  <p className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground">
                    {t('notebooks.updatedAt', {
                      date: new Date(selected.updatedAt).toLocaleString(i18n.language),
                    })}
                  </p>
                </div>
              </>
            ) : (
              <div className="grid flex-1 content-center justify-items-center gap-5 p-8 text-center">
                <GameEntityIcon
                  kind="champion"
                  id={championId}
                  label={championName(t, championId)}
                  className="size-20 rounded-2xl border border-primary/25"
                />
                <h2 className="text-lg">
                  {t(
                    hasFilters
                      ? 'notebooks.noResults'
                      : trash
                        ? 'notebooks.trashEmpty'
                        : 'notebooks.startNotebook',
                  )}
                </h2>
                {!trash && !hasFilters && !notebooks.isPending && !notebooks.isError && (
                  <div className="grid grid-cols-2 gap-2">
                    {notebookKinds.map((kind) => {
                      const Icon = categoryIcons[kind];
                      return (
                        <Button
                          key={kind}
                          variant="outline"
                          disabled={!epoch}
                          onClick={() => edit(null, false, kind)}
                        >
                          <Icon aria-hidden="true" />
                          {t(`notebooks.create_${kind}`)}
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </Card>
      {draftKey && drafts[draftKey] && (
        <NotebookEntryEditor
          key={draftKey}
          draftKey={draftKey}
          entries={entries}
          onClose={() => setDraftKey(null)}
          onSaved={(entry) => {
            setCategory(category === 'all' ? 'all' : entry.content.kind);
            resetFilters();
            setTrash(false);
            setMobileDetail(true);
            void navigate({
              to: '/notebooks',
              search: { champion: championId, entry: entry.id },
              replace: true,
            });
          }}
        />
      )}
      <Dialog
        open={practiceOpen}
        onOpenChange={(open) => {
          if (!open && practiceDirty) setDiscardPractice(true);
          else setPracticeOpen(open);
        }}
      >
        <DialogContent
          className="max-h-[85dvh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto"
          closeLabel={t('common.dismiss')}
        >
          <DialogHeader>
            <DialogTitle>{t('notebooks.practice')}</DialogTitle>
          </DialogHeader>
          {epoch && (
            <PracticeChecklist
              key={`${epoch}:${championId}`}
              championId={championId}
              epoch={epoch}
              entries={trash ? [] : entries}
              embedded
              onDirtyChange={setPracticeDirty}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={discardPractice}
        title={t('common.discard')}
        description={t('common.discardHelp')}
        onClose={() => setDiscardPractice(false)}
        onConfirm={() => {
          setDiscardPractice(false);
          setPracticeDirty(false);
          setPracticeOpen(false);
        }}
      />
      <Dialog
        open={!!historyEntry}
        onOpenChange={(open) => {
          if (!open) setHistoryEntry(null);
        }}
      >
        <DialogContent
          className="max-h-[85dvh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto"
          closeLabel={t('common.dismiss')}
        >
          <DialogHeader>
            <DialogTitle>
              {t('notebooks.history')}: {historyEntry?.content.title}
            </DialogTitle>
          </DialogHeader>
          <ErrorNotice error={history.error || change.error} />
          {history.isPending && <Skeleton className="h-32" />}
          {history.data?.revisions.map((revision) => (
            <Card key={revision.revision}>
              <CardHeader>
                <CardTitle>
                  v{revision.revision} ·{' '}
                  {new Date(revision.updatedAt).toLocaleString(i18n.language)}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid min-w-0 gap-4">
                <NotebookEntryView entry={revision} fixedLinks expanded />
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
          entries={trash ? [] : entries}
          onClose={() => setTransfer(false)}
        />
      )}
    </div>
  );
}
export function NotebookEntryView({
  entry,
  patch,
  fixedLinks = false,
  expanded = false,
  clientControls,
}: {
  entry: NotebookEntry;
  patch?: string;
  fixedLinks?: boolean;
  expanded?: boolean;
  clientControls?: ReactNode;
}) {
  const { t } = useTranslation();
  const content = entry.content;
  return (
    <div data-ui="review-stack" className="grid grid-cols-1 gap-4 min-w-0">
      <div data-ui="actions" className="flex items-center gap-2">
        <h3
          className={`min-w-0 flex-1 font-semibold wrap-anywhere ${expanded ? 'text-2xl leading-snug tracking-tight' : 'text-lg'}`}
        >
          {content.title}
        </h3>
        {content.pinned && !expanded && (
          <Badge variant="secondary">
            <BookOpen aria-hidden="true" className="mr-1 size-3" />
            {t('notebooks.pinned')}
          </Badge>
        )}
        {(content.confirmedPatch || patch) && (
          <Badge variant="outline">{t(`notebooks.review_${reviewStatus(entry, patch)}`)}</Badge>
        )}
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
        {content.position && (
          <Badge variant="outline">{t(`matches.position_${content.position}`)}</Badge>
        )}
        {content.kind === 'build' && content.mapId && (
          <Badge variant="outline">
            {t(content.mapId === 12 ? 'notebooks.abyss' : 'notebooks.rift')}
          </Badge>
        )}
      </div>
      {content.steps.length > 0 && (
        <ComboSequence championId={content.championId} steps={content.steps} />
      )}{' '}
      {clientControls}
      {content.kind === 'build' && (
        <div className="grid gap-3">
          <h4 className="m-0 text-sm font-semibold">{t('notebooks.equipmentPlan')}</h4>
          {content.groups.some((group) => group.items.length) ? (
            <BuildGroups groups={content.groups} version={content.resourceVersion} />
          ) : (
            <p className="text-sm text-muted-foreground">{t('notebooks.noEquipment')}</p>
          )}
        </div>
      )}
      {(content.kind === 'build' || content.skillOrder?.some(Boolean)) && (
        <div className="grid gap-3">
          <h4 className="m-0 text-sm font-semibold">{t('notebooks.skillOrder')}</h4>
          {content.skillOrder?.some(Boolean) ? (
            <SkillOrderView championId={content.championId} order={content.skillOrder} />
          ) : (
            <p className="text-sm text-muted-foreground">{t('notebooks.noSkillOrder')}</p>
          )}
        </div>
      )}
      {(!expanded || content.kind === 'build') && content.text.length > 200 ? (
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
        <DialogContent className="max-h-[85dvh] overflow-y-auto" closeLabel={t('common.dismiss')}>
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
function NotebookReviewSource({ source }: { source: NotebookSource }) {
  const { t } = useTranslation();
  const navigate = useWorkspaceNavigate();
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
