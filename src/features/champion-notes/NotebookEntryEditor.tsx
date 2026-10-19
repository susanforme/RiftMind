import { useEffect, useState } from 'react';
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
import { ItemBuildEditor } from '../builds/ItemBuildEditor';
import { useNotebookDrafts } from './notebook-drafts';
export function NotebookEntryEditor({
  draftKey,
  entries,
  onClose,
}: {
  draftKey: string;
  entries: NotebookEntry[];
  onClose: () => void;
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
    onSuccess: () => {
      setDraft(draftKey, null);
      void queryClient.invalidateQueries({ queryKey: ['notebooks'] });
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
  const update = (patch: Partial<NotebookContent>) =>
    setDraft(draftKey, { ...draft, content: { ...content, ...patch } });
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !save.isPending) setDiscard(true);
        }}
      >
        <DialogContent
          className="w-[min(900px,calc(100vw_-_32px))] max-w-[900px] max-h-[calc(100dvh_-_48px)] overflow-auto [&_fieldset]:min-w-0 [&_fieldset]:border-0 [&_fieldset]:p-0"
          closeLabel={t('common.dismiss')}
        >
          <DialogHeader>
            <DialogTitle>
              <span className="inline-flex items-center gap-1.5 me-2.5 align-middle [&_[data-slot='avatar']]:w-6 [&_[data-slot='avatar']]:h-6">
                <GameEntityIcon
                  kind="champion"
                  id={content.championId}
                  label={championName(t, content.championId)}
                />
                {championName(t, content.championId)} · {t(`notebooks.kind_${content.kind}`)}
              </span>
            </DialogTitle>
          </DialogHeader>
          <fieldset
            disabled={save.isPending}
            data-ui="review-stack"
            className="grid grid-cols-1 gap-4 min-w-0"
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
                maxLength={300}
                onChange={(event) => update({ title: event.target.value })}
              />
            </Label>
            <Label>
              {t('notebooks.content')}
              <Textarea
                aria-label={t('notebooks.content')}
                rows={7}
                maxLength={100000}
                value={content.text}
                onChange={(event) => update({ text: event.target.value })}
              />
            </Label>
            <div data-ui="actions" className="flex items-center gap-2">
              <Label className="inline-flex items-center gap-1.5 me-2.5 align-middle [&_[data-slot='avatar']]:w-6 [&_[data-slot='avatar']]:h-6">
                <Switch checked={content.pinned} onCheckedChange={(pinned) => update({ pinned })} />
                {t('notebooks.pinned')}
              </Label>
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
              <Label className="inline-flex items-center gap-1.5 me-2.5 align-middle [&_[data-slot='avatar']]:w-6 [&_[data-slot='avatar']]:h-6">
                <Switch
                  checked={confirmation}
                  disabled={!content.confirmedPatch}
                  onCheckedChange={setConfirmation}
                />
                {t('notebooks.confirmApplicable')}
              </Label>
            </div>
            <div data-ui="actions" className="flex items-center gap-2">
              <Label>
                {t('notebooks.tags')}
                <Input
                  aria-label={t('notebooks.tags')}
                  value={content.tags.join(', ')}
                  onChange={(event) =>
                    update({
                      tags: event.target.value
                        .split(',')
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    })
                  }
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
            {content.kind === 'matchup' && (
              <div>
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
              <ItemBuildEditor
                groups={content.groups}
                version={content.resourceVersion || ''}
                mapId={content.mapId || 11}
                onChange={(groups) => update({ groups })}
                onVersion={(resourceVersion) => update({ resourceVersion })}
                onMap={(mapId) => update({ mapId })}
              />
            )}
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
                update({ links: [...content.links, { entryId: id, revision: linked.revision }] });
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
                    update({ sources: content.sources.filter((_, position) => position !== index) })
                  }
                >
                  {t('notebooks.unlink')}
                </Button>
              </div>
            ))}
          </fieldset>
          <DialogFooter>
            <span role="status">{t(save.isPending ? 'notebooks.saving' : 'common.unsaved')}</span>
            <Button variant="outline" disabled={save.isPending} onClick={onClose}>
              {t('notebooks.keepDraft')}
            </Button>
            <Button
              disabled={save.isPending || !content.title.trim()}
              onClick={() => save.mutate()}
            >
              {t('notebooks.save')}
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
