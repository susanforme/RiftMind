import { GameEntityIcon } from '../../components/GameEntityIcon';
import { championName } from '../../lib/display-names';
import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { transport } from '../../app/runtime';
import { queryClient } from '../../app/query-client';
import type { NotebookEntry, PracticeEntry, PracticeState } from '../../generated/contracts';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import { SearchSelect } from '../../components/SearchSelect';
import { ErrorNotice } from '../../components/ErrorNotice';
export function PracticeChecklist({
  championId,
  epoch,
  entries,
  embedded = false,
  onDirtyChange,
}: {
  championId?: number;
  epoch: string;
  entries: NotebookEntry[];
  embedded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const dirtyEntries = useRef(new Set<string>());
  const recordDraftChange = useCallback(
    (id: string, dirty: boolean) => {
      if (dirty) dirtyEntries.current.add(id);
      else dirtyEntries.current.delete(id);
      onDirtyChange?.(dirtyEntries.current.size > 0);
    },
    [onDirtyChange],
  );
  const savedEntries = useQuery({
    queryKey: ['notebooks', epoch, 'practice', championId],
    queryFn: () =>
      transport.call('list_notebook_entries', {
        championId: championId || null,
        kind: null,
        search: '',
        opponentId: null,
        trash: false,
      }),
    enabled: entries.length === 0,
  });
  const availableEntries = entries.length ? entries : savedEntries.data || [];
  const practices = useQuery({
    queryKey: ['practices', epoch, championId],
    queryFn: () =>
      transport.call('list_practice_entries', {
        championId: championId || null,
        kind: null,
        search: '',
        opponentId: null,
        trash: false,
      }),
  });
  return (
    <Card
      data-ui="practice-checklist"
      className={`min-w-0 overflow-hidden ${embedded ? 'border-0 bg-transparent' : ''}`}
    >
      {!embedded && (
        <CardHeader className="border-b border-border bg-muted/20">
          <CardTitle>{t('notebooks.practice')}</CardTitle>
        </CardHeader>
      )}
      <CardContent
        data-ui="review-stack"
        className={`grid min-w-0 grid-cols-1 gap-4 pt-5 ${embedded ? 'p-0' : ''}`}
      >
        <ErrorNotice error={practices.error} />
        {!practices.data?.length && <p>{t('notebooks.noPractice')}</p>}
        {practices.data?.map((practice) => (
          <PracticeRow
            key={`${practice.id}:${practice.revision}`}
            practice={practice}
            epoch={epoch}
            source={availableEntries.find((entry) => entry.id === practice.sourceId)}
            entries={availableEntries}
            onDraftChange={recordDraftChange}
          />
        ))}
      </CardContent>
    </Card>
  );
}
function PracticeRow({
  practice,
  epoch,
  source,
  entries,
  onDraftChange,
}: {
  practice: PracticeEntry;
  epoch: string;
  source?: NotebookEntry;
  entries: NotebookEntry[];
  onDraftChange: (id: string, dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState(practice.notes);
  const [state, setState] = useState(practice.state);
  const [sourceId, setSourceId] = useState(practice.sourceId);
  const save = useMutation({
    mutationFn: (remove: boolean) =>
      transport.call('save_practice_entry', {
        workspaceEpoch: epoch,
        entry: {
          ...practice,
          notes,
          state,
          sourceId,
          sourceRevision:
            sourceId === practice.sourceId
              ? practice.sourceRevision
              : entries.find((entry) => entry.id === sourceId)?.revision || null,
        },
        expectedRevision: practice.revision,
        delete: remove,
      }),
    onSuccess: () => {
      onDraftChange(practice.id, false);
      return queryClient.invalidateQueries({ queryKey: ['practices'] });
    },
  });
  return (
    <div
      data-ui="review-stack"
      className="grid min-w-0 grid-cols-1 gap-4 border-b border-border pb-5 pt-5 last:border-b-0 last:pb-0"
    >
      <div data-ui="actions" className="flex flex-wrap items-center gap-2">
        <GameEntityIcon
          kind="champion"
          id={practice.championId}
          label={championName(t, practice.championId)}
          className="size-10 rounded-lg"
        />
        <strong className="min-w-0 flex-1 wrap-anywhere">{practice.title}</strong>
        <Badge variant="outline">{t(`notebooks.practice_${practice.state}`)}</Badge>
        {practice.sourceId && (!source || source.deleted) && (
          <Badge variant="outline">{t('notebooks.sourceUnavailable')}</Badge>
        )}
        {source && source.revision !== practice.sourceRevision && (
          <Badge variant="outline">{t('notebooks.contentChanged')}</Badge>
        )}
      </div>
      <ErrorNotice error={save.error} />
      <SearchSelect
        label={t('notebooks.practiceState')}
        value={state}
        options={(['pending', 'practicing', 'mastered'] as PracticeState[]).map((state) => ({
          value: state,
          label: t(`notebooks.practice_${state}`),
        }))}
        onValueChange={(nextState) => {
          setState(nextState as PracticeState);
          onDraftChange(
            practice.id,
            nextState !== practice.state ||
              notes !== practice.notes ||
              sourceId !== practice.sourceId,
          );
        }}
      />
      <SearchSelect
        label={t('notebooks.linkContent')}
        value={sourceId || 'none'}
        options={[
          { value: 'none', label: t('notebooks.unlink') },
          ...entries
            .filter((entry) => !entry.deleted && entry.content.championId === practice.championId)
            .map((entry) => ({ value: entry.id, label: entry.content.title })),
        ]}
        onValueChange={(id) => {
          const nextSourceId = id === 'none' ? null : id;
          setSourceId(nextSourceId);
          onDraftChange(
            practice.id,
            nextSourceId !== practice.sourceId ||
              notes !== practice.notes ||
              state !== practice.state,
          );
        }}
      />
      <Label>
        {t('notebooks.practiceNotes')}
        <Textarea
          aria-label={t('notebooks.practiceNotes')}
          value={notes}
          className="min-h-24"
          onChange={(event) => {
            setNotes(event.target.value);
            onDraftChange(
              practice.id,
              event.target.value !== practice.notes ||
                state !== practice.state ||
                sourceId !== practice.sourceId,
            );
          }}
        />
      </Label>
      <div data-ui="actions" className="flex items-center gap-2">
        <Button className="flex-1" disabled={save.isPending} onClick={() => save.mutate(false)}>
          {t('notebooks.save')}
        </Button>
        <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate(true)}>
          {t('review.delete')}
        </Button>
      </div>
    </div>
  );
}
