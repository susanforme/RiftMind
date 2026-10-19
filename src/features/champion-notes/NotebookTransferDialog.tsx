import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { transport } from '../../app/runtime';
import { queryClient } from '../../app/query-client';
import type {
  NotebookExport,
  ImportPreview,
  NotebookEntry,
  NotebookLink,
} from '../../generated/contracts';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { SearchSelect } from '../../components/SearchSelect';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../components/ui/dialog';
import { ErrorNotice } from '../../components/ErrorNotice';
import { downloadJson } from './notebook-drafts';
export function NotebookTransferDialog({
  championId,
  epoch,
  entries,
  onClose,
}: {
  championId: number;
  epoch: string;
  entries: NotebookEntry[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [fileError, setFileError] = useState<unknown>(null);
  const [json, setJson] = useState('');
  const [bundle, setBundle] = useState<NotebookExport | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [replacements, setReplacements] = useState<Record<string, NotebookLink>>({});
  const saveFile = useMutation({
    mutationFn: async () => {
      if (!bundle) return;
      if (transport.mode === 'desktop')
        await transport.call('save_champion_notebook_file', {
          championId: bundle.championId,
          kind: null,
          search: '',
          opponentId: null,
          trash: false,
        });
      else downloadJson(json, `champion-${bundle.championId}-notebook.json`);
    },
  });
  const exportContent = useMutation({
    mutationFn: () =>
      transport.call('export_champion_notebook', {
        championId,
        kind: null,
        search: '',
        opponentId: null,
        trash: false,
      }),
    onSuccess: (bundle) => {
      setBundle(bundle);
      setJson(JSON.stringify(bundle, null, 2));
      setPreview(null);
    },
  });
  const importContent = useMutation({
    mutationFn: (commit: boolean) =>
      transport.call('import_champion_notebook', {
        workspaceEpoch: epoch,
        json,
        commit,
        replacements,
      }),
    onSuccess: (preview, commit) => {
      setPreview(preview);
      if (commit) {
        void queryClient.invalidateQueries({ queryKey: ['notebooks'] });
        onClose();
      }
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="w-[min(900px,calc(100vw_-_32px))] max-w-[900px] max-h-[calc(100dvh_-_48px)] overflow-auto [&_fieldset]:min-w-0 [&_fieldset]:border-0 [&_fieldset]:p-0"
        closeLabel={t('common.dismiss')}
      >
        <DialogHeader>
          <DialogTitle>{t('notebooks.exchange')}</DialogTitle>
        </DialogHeader>
        <ErrorNotice
          error={exportContent.error || importContent.error || saveFile.error || fileError}
        />
        <div data-ui="actions" className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={exportContent.isPending}
            onClick={() => exportContent.mutate()}
          >
            {t('notebooks.previewExport')}
          </Button>
          <Label>
            {t('notebooks.chooseFile')}
            <Input
              type="file"
              accept=".json,application/json"
              aria-label={t('notebooks.chooseFile')}
              onChange={(event) => {
                const file = event.target.files?.[0];
                setFileError(null);
                if (file && file.size <= 4 * 1024 * 1024)
                  void file.text().then((text) => {
                    setJson(text);
                    setBundle(null);
                    setPreview(null);
                    setReplacements({});
                  });
                else if (file) {
                  setJson('');
                  setPreview(null);
                  setFileError({ code: 'INVALID_INPUT' });
                }
              }}
            />
          </Label>
        </div>
        <Label>
          {t('notebooks.notebookJson')}
          <Textarea
            aria-label={t('notebooks.notebookJson')}
            rows={10}
            value={json}
            onChange={(event) => {
              setJson(event.target.value);
              setPreview(null);
              setBundle(null);
              setReplacements({});
            }}
          />
        </Label>
        {bundle && (
          <div>
            <p>{t('notebooks.exportCount', { count: bundle.entries.length })}</p>
            <ul>
              {bundle.entries.map((entry) => (
                <li key={entry.id}>{entry.content.title}</li>
              ))}
            </ul>
            <Button disabled={saveFile.isPending} onClick={() => saveFile.mutate()}>
              {t('notebooks.download')}
            </Button>
          </div>
        )}
        {preview && (
          <div data-ui="review-stack" className="grid grid-cols-1 gap-4 min-w-0">
            <p role="status">
              {t('notebooks.importSummary', {
                added: preview.added,
                duplicates: preview.duplicates,
                conflicts: preview.conflicts,
                missing: preview.missingLinks,
              })}
            </p>
            {preview.entries.map((entry) => (
              <div key={entry.id}>
                <strong>{entry.content.title}</strong>
                <SearchSelect
                  label={t('notebooks.importResolution')}
                  value={replacements[entry.id]?.entryId || 'new'}
                  options={[
                    { value: 'new', label: t('notebooks.importAsNew') },
                    ...entries
                      .filter(
                        (existing) =>
                          existing.content.championId === preview.championId &&
                          existing.content.kind === entry.content.kind &&
                          !existing.deleted,
                      )
                      .map((existing) => ({
                        value: existing.id,
                        label: t('notebooks.replaceEntry', { title: existing.content.title }),
                      })),
                  ]}
                  onValueChange={(id) => {
                    const next = { ...replacements };
                    const target = entries.find((entry) => entry.id === id);
                    if (target) next[entry.id] = { entryId: id, revision: target.revision };
                    else delete next[entry.id];
                    setReplacements(next);
                  }}
                />
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!json || importContent.isPending || !!bundle}
            onClick={() => importContent.mutate(!!preview)}
          >
            {t(preview ? 'notebooks.confirmImport' : 'notebooks.previewImport')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
