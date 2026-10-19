import { beforeEach, expect, it } from 'vitest';
import {
  blankNotebook,
  useNotebookDrafts,
} from '../../src/features/champion-notes/notebook-drafts';
import { fixtureTransport, resetFixture } from '../../src/lib/transport/fixture';
beforeEach(() => {
  resetFixture();
  useNotebookDrafts.setState({ drafts: {} });
});
it('a second editor conflict preserves the first editor input and fixed revision', async () => {
  const transport = fixtureTransport();
  const content = blankNotebook(64, 'note');
  content.title = 'Ward route';
  content.text = 'Original';
  const first = await transport.call('save_notebook_entry', {
    workspaceEpoch: 'fixture-epoch',
    id: null,
    expectedRevision: 0,
    content,
    confirmPatch: null,
  });
  const draft = {
    epoch: 'fixture-epoch',
    entry: first,
    content: { ...first.content, text: 'My unsaved edit' },
  };
  useNotebookDrafts.getState().setDraft('first-editor', draft);
  await transport.call('save_notebook_entry', {
    workspaceEpoch: 'fixture-epoch',
    id: first.id,
    expectedRevision: 1,
    content: { ...first.content, text: 'Other editor' },
    confirmPatch: null,
  });
  await expect(
    transport.call('save_notebook_entry', {
      workspaceEpoch: 'fixture-epoch',
      id: first.id,
      expectedRevision: 1,
      content: draft.content,
      confirmPatch: null,
    }),
  ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  expect(useNotebookDrafts.getState().drafts['first-editor'].content.text).toBe('My unsaved edit');
  expect(useNotebookDrafts.getState().drafts['first-editor'].entry?.revision).toBe(1);
});
it('workspace replacement and changing champion do not discard knowledge drafts', () => {
  const lee = blankNotebook(64, 'combo');
  lee.title = 'Ward hop';
  lee.text = 'Pending';
  const ahri = blankNotebook(103, 'note');
  ahri.title = 'Charm';
  ahri.text = 'Pending';
  useNotebookDrafts.getState().setDraft('old:lee', { epoch: 'old', entry: null, content: lee });
  useNotebookDrafts.getState().setDraft('new:ahri', { epoch: 'new', entry: null, content: ahri });
  expect(useNotebookDrafts.getState().drafts['old:lee'].content.text).toBe('Pending');
  useNotebookDrafts.getState().setDraft('new:ahri', null);
  expect(useNotebookDrafts.getState().drafts['old:lee'].content.championId).toBe(64);
});
it('notebook export excludes fixed private match evidence and keeps only internal links', async () => {
  const transport = fixtureTransport();
  const content = blankNotebook(64, 'note');
  content.title = 'Private source';
  content.text = 'Player knowledge';
  content.sources = [
    {
      matchKey: 'NA1:private',
      playerKey: 'NA1:private-player',
      reportId: 'private-report',
      evidenceId: 'private-evidence',
    },
  ];
  content.links = [{ entryId: 'other-champion-entry', revision: 1 }];
  await transport.call('save_notebook_entry', {
    workspaceEpoch: 'fixture-epoch',
    id: null,
    expectedRevision: 0,
    content,
    confirmPatch: null,
  });
  const bundle = await transport.call('export_champion_notebook', {
    championId: 64,
    kind: null,
    search: '',
    opponentId: null,
    trash: false,
  });
  expect(bundle.entries[0].content.sources).toEqual([]);
  expect(bundle.entries[0].content.links).toEqual([]);
  expect(JSON.stringify(bundle)).not.toContain('private-player');
  expect(bundle.entries[0].content.text).toBe('Player knowledge');
});
