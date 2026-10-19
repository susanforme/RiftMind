import { useEffect, useState } from 'react';
import { ChevronDown, Link2, Settings2 } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { transport } from '../../app/runtime';
import { queryClient } from '../../app/query-client';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../components/ui/dialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ChampionSelect } from '../../components/ChampionSelect';
import { GameEntityIcon } from '../../components/GameEntityIcon';
import { SearchSelect } from '../../components/SearchSelect';
import { ErrorNotice } from '../../components/ErrorNotice';
import type { NotebookContent, NotebookEntry } from '../../generated/contracts';
import { championName } from '../../lib/display-names';
import { ComboEditor } from './ComboEditor';
import { ChampionBuildEditor } from '../champion-plans/ChampionBuildEditor';
import { blankNotebook, useNotebookDrafts } from './notebook-drafts';
export function NotebookEntryEditor({
  draftKey,
  entries,
  onClose,
  onSaved,
}: {
  draftKey: string;
  entries: NotebookEntry[];
  onClose: () => void;
  onSaved?: (entry: NotebookEntry) => void;
}) {
  const { t } = useTranslation();
  const draft = useNotebookDrafts((state) => state.drafts[draftKey]);
  const setDraft = useNotebookDrafts((state) => state.setDraft);
  const candidates = useQuery({
    queryKey: ['notebooks', draft?.epoch, 'link-candidates'],
    queryFn: () =>
      transport.call('list_notebook_entries', {
        championId: null,
        kind: null,
        search: '',
        opponentId: null,
        trash: false,
      }),
    enabled: !!draft,
  });
  const linkEntries = candidates.data || entries;
  const [reportSource, setReportSource] = useState('');
  const [discard, setDiscard] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [tagsText, setTagsText] = useState(draft?.content.tags.join(', ') || '');
  const addSource = useMutation({
    mutationFn: () => transport.call('get_review', { id: reportSource }),
    onSuccess: (report) => {
      const draft = useNotebookDrafts.getState().drafts[draftKey];
      if (!draft) return;
      setDraft(draftKey, {
        ...draft,
        content: {
          ...draft.content,
          sources: [
            ...draft.content.sources,
            {
              matchKey: report.matchKey,
              playerKey: report.playerKey,
              reportId: report.id,
              evidenceId: null,
            },
          ],
        },
      });
      setReportSource('');
    },
  });
  const save = useMutation({
    mutationFn: () =>
      transport.call('save_notebook_entry', {
        workspaceEpoch: draft.epoch,
        id: draft.entry?.id || null,
        expectedRevision: draft.entry?.revision || 0,
        content: draft.content,
        confirmPatch: confirmation ? draft.content.confirmedPatch : null,
      }),
    onSuccess: (entry) => {
      setDraft(draftKey, null);
      void queryClient.invalidateQueries({ queryKey: ['notebooks'] });
      onSaved?.(entry);
      onClose();
    },
  });
  useEffect(() => {
    if (!draft) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [draft]);
  if (!draft) return null;
  const content = draft.content;
  function closeDraft() {
    if (save.isPending) return;
    if (
      JSON.stringify(content) ===
      JSON.stringify(draft.entry?.content || blankNotebook(content.championId, content.kind))
    )
      setDraft(draftKey, null);
    onClose();
  }
  const update = (patch: Partial<NotebookContent>) =>
    setDraft(draftKey, { ...draft, content: { ...content, ...patch } });
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) closeDraft();
        }}
      >
        <DialogContent
          className="flex max-h-[calc(100dvh-32px)] w-[calc(100vw-2rem)] max-w-[900px] flex-col gap-0 overflow-hidden p-0 [&_label]:grid [&_label]:gap-2 [&_label]:text-sm"
          closeLabel={t('common.dismiss')}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key === 's')) {
              event.preventDefault();
              if (!save.isPending && content.title.trim() && !event.nativeEvent.isComposing)
                save.mutate();
            }
          }}
        >
          <DialogHeader className="shrink-0 border-b border-border p-5 pr-12">
            <DialogTitle>
              <span className="inline-flex items-center gap-3 align-middle">
                <GameEntityIcon
                  kind="champion"
                  id={content.championId}
                  label={championName(t, content.championId)}
                  className="size-10 rounded-lg"
                />
                {championName(t, content.championId)} · {t(`notebooks.kind_${content.kind}`)}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <fieldset
              disabled={save.isPending}
              data-ui="review-stack"
              className="grid min-w-0 grid-cols-1 gap-5 border-0 p-6 max-[600px]:p-4 [&_[data-ui~=actions]]:flex-wrap"
            >
              <ErrorNotice error={save.error || addSource.error} />
              {(save.error as { code?: string } | null)?.code === 'REVISION_CONFLICT' && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDraft(draftKey, { ...draft, entry: null });
                    save.reset();
                  }}
                >
                  {t('notebooks.saveConflictCopy')}
                </Button>
              )}
              <Label>
                {t('notebooks.title')}
                <Input
                  aria-label={t('notebooks.title')}
                  value={content.title}
                  autoFocus
                  className="h-12 text-lg font-semibold"
                  maxLength={300}
                  onChange={(event) => update({ title: event.target.value })}
                />
              </Label>
              {content.kind === 'matchup' && (
                <div className="grid gap-2">
                  <Label>{t('notebooks.opponent')}</Label>
                  <ChampionSelect
                    value={content.opponentId || undefined}
                    onValueChange={(opponent) => update({ opponentId: opponent || null })}
                  />
                </div>
              )}
              {content.kind === 'combo' && (
                <ComboEditor
                  championId={content.championId}
                  steps={content.steps}
                  onChange={(steps) => update({ steps })}
                />
              )}
              {content.kind === 'build' && (
                <ChampionBuildEditor content={content} onChange={update} />
              )}
              {content.kind !== 'build' && (
                <Label>
                  {t('notebooks.content')}
                  <Textarea
                    aria-label={t('notebooks.content')}
                    rows={7}
                    className="min-h-48 resize-y text-base leading-7"
                    maxLength={100000}
                    value={content.text}
                    onChange={(event) => update({ text: event.target.value })}
                  />
                </Label>
              )}
              <div className="flex items-center gap-3">
                <Switch
                  id="notebook-pin"
                  checked={content.pinned}
                  onCheckedChange={(pinned) => update({ pinned })}
                />
                <Label htmlFor="notebook-pin">{t('notebooks.pinned')}</Label>
              </div>
              <Collapsible
                defaultOpen={
                  !!content.confirmedPatch || !!content.tags.length || !!content.position
                }
                className="rounded-lg border border-border"
              >
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="group h-12 w-full justify-start px-4">
                    <Settings2 aria-hidden="true" />
                    {t('notebooks.entryDetails')}
                    <ChevronDown
                      aria-hidden="true"
                      className="ml-auto group-data-[state=open]:rotate-180"
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="grid gap-4 border-t border-border p-4">
                  <div data-ui="actions" className="flex items-center gap-4">
                    <Label>
                      {t('notebooks.confirmedPatch')}
                      <Input
                        aria-label={t('notebooks.confirmedPatch')}
                        value={content.confirmedPatch || ''}
                        onChange={(event) => {
                          update({ confirmedPatch: event.target.value || null });
                          setConfirmation(false);
                        }}
                      />
                    </Label>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="notebook-confirm-patch"
                        checked={confirmation}
                        disabled={!content.confirmedPatch}
                        onCheckedChange={setConfirmation}
                      />
                      <Label htmlFor="notebook-confirm-patch">
                        {t('notebooks.confirmApplicable')}
                      </Label>
                    </div>
                  </div>
                  <div data-ui="actions" className="flex items-center gap-2">
                    <Label>
                      {t('notebooks.tags')}
                      <Input
                        aria-label={t('notebooks.tags')}
                        value={tagsText}
                        onChange={(event) => {
                          setTagsText(event.target.value);
                          update({
                            tags: event.target.value
                              .split(',')
                              .map((tag) => tag.trim())
                              .filter(Boolean),
                          });
                        }}
                      />
                    </Label>
                    <SearchSelect
                      label={t('review.position')}
                      value={content.position || 'all'}
                      options={['all', 'TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].map(
                        (position) => ({
                          value: position,
                          label:
                            position === 'all'
                              ? t('review.allPositions')
                              : t(`matches.position_${position}`),
                        }),
                      )}
                      onValueChange={(position) =>
                        update({ position: position === 'all' ? null : position })
                      }
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>
              <Collapsible
                defaultOpen={!!content.links.length || !!content.sources.length}
                className="rounded-lg border border-border"
              >
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="group h-12 w-full justify-start px-4">
                    <Link2 aria-hidden="true" />
                    {t('notebooks.references')}
                    <ChevronDown
                      aria-hidden="true"
                      className="ml-auto group-data-[state=open]:rotate-180"
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="grid gap-4 border-t border-border p-4">
                  <SearchSelect
                    label={t('notebooks.linkContent')}
                    value=""
                    options={linkEntries
                      .filter(
                        (entry) =>
                          entry.id !== draft.entry?.id &&
                          !entry.deleted &&
                          !content.links.some((link) => link.entryId === entry.id),
                      )
                      .map((entry) => ({
                        value: entry.id,
                        label: entry.content.title,
                        icon: (
                          <GameEntityIcon
                            kind="champion"
                            id={entry.content.championId}
                            label={championName(t, entry.content.championId)}
                          />
                        ),
                      }))}
                    onValueChange={(id) => {
                      const linked = linkEntries.find((entry) => entry.id === id)!;
                      update({
                        links: [...content.links, { entryId: id, revision: linked.revision }],
                      });
                    }}
                  />
                  {content.links.map((link) => (
                    <div data-ui="actions" className="flex items-center gap-2" key={link.entryId}>
                      <span>
                        {linkEntries.find((entry) => entry.id === link.entryId)?.content.title ||
                          t('notebooks.sourceUnavailable')}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          update({
                            links: content.links.filter(
                              (candidate) => candidate.entryId !== link.entryId,
                            ),
                          })
                        }
                      >
                        {t('notebooks.unlink')}
                      </Button>
                    </div>
                  ))}
                  <Label>
                    {t('notebooks.reportReference')}
                    <Input
                      aria-label={t('notebooks.reportReference')}
                      value={reportSource}
                      onChange={(event) => setReportSource(event.target.value)}
                    />
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!reportSource || addSource.isPending}
                    onClick={() => addSource.mutate()}
                  >
                    {t('notebooks.addReportSource')}
                  </Button>
                  {content.sources.map((source, index) => (
                    <div data-ui="actions" className="flex items-center gap-2" key={index}>
                      <span>
                        {t('notebooks.reviewSource')} · {source.matchKey}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          update({
                            sources: content.sources.filter((_, position) => position !== index),
                          })
                        }
                      >
                        {t('notebooks.unlink')}
                      </Button>
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            </fieldset>
          </div>
          <DialogFooter className="shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card p-4 max-sm:flex-row">
            <Button
              variant="ghost"
              disabled={save.isPending}
              onClick={() => setDiscard(true)}
              className="mr-auto"
            >
              {t('notebooks.discardDraft')}
            </Button>
            <Button variant="outline" disabled={save.isPending} onClick={closeDraft}>
              {t('notebooks.keepDraft')}
            </Button>
            <Button
              disabled={save.isPending || !content.title.trim()}
              onClick={() => save.mutate()}
              title={t('notebooks.saveShortcut')}
            >
              {t(save.isPending ? 'notebooks.saving' : 'notebooks.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={discard}
        title={t('common.discard')}
        description={t('common.discardHelp')}
        onClose={() => setDiscard(false)}
        onConfirm={() => {
          setDraft(draftKey, null);
          setDiscard(false);
          onClose();
        }}
      />
    </>
  );
}
