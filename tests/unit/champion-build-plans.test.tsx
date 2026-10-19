import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../src/app/query-client';
import { setTransport } from '../../src/app/runtime';
import { NotebookEntryEditor } from '../../src/features/champion-notes/NotebookEntryEditor';
import { BuildSyncPanel } from '../../src/features/champion-plans/BuildSyncPanel';
import {
  blankNotebook,
  useNotebookDrafts,
} from '../../src/features/champion-notes/notebook-drafts';
import { fixtureTransport, resetFixture } from '../../src/lib/transport/fixture';
import i18n from '../../src/i18n';

beforeEach(async () => {
  resetFixture();
  queryClient.clear();
  useNotebookDrafts.setState({ drafts: {} });
  setTransport(fixtureTransport());
  await i18n.changeLanguage('en-US');
});
afterEach(() => {
  cleanup();
  queryClient.clear();
});

it('saves items, per-level skill choices and notes as one plan across editor tabs', async () => {
  const content = blankNotebook(64, 'build');
  content.title = 'Jungle plan';
  content.groups = [{ name: 'Start', items: [{ id: 1001, count: 1 }] }];
  useNotebookDrafts
    .getState()
    .setDraft('jungle-plan', { epoch: 'fixture-epoch', entry: null, content });
  const saved = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <NotebookEntryEditor
        draftKey="jungle-plan"
        entries={[]}
        onClose={() => undefined}
        onSaved={saved}
      />
    </QueryClientProvider>,
  );
  const dialog = screen.getByRole('dialog');
  fireEvent.keyDown(within(dialog).getByRole('tab', { name: 'Skill order' }), { key: 'Enter' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Level 1: Q', exact: true }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Level 2: W', exact: true }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Level 6: R', exact: true }));
  fireEvent.keyDown(within(dialog).getByRole('tab', { name: 'Notes', exact: true }), {
    key: 'Enter',
  });
  fireEvent.change(within(dialog).getByLabelText('Content', { exact: true }), {
    target: { value: 'Check lane priority before invading.' },
  });
  fireEvent.keyDown(within(dialog).getByRole('tab', { name: 'Skill order' }), { key: 'Enter' });
  expect(within(dialog).getByRole('button', { name: 'Level 6: R', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes', exact: true }));
  await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const entry = saved.mock.calls[0][0];
  expect(entry.content.groups).toEqual(content.groups);
  expect(entry.content.skillOrder.slice(0, 6)).toEqual([1, 2, 0, 0, 0, 4]);
  expect(entry.content.text).toBe('Check lane priority before invading.');
  expect(await fixtureTransport().call('list_build_sync_rules', { championId: 64 })).toEqual([]);
});

it('requires explicit opt-in and can disable an active rule after removing items', async () => {
  const transport = fixtureTransport();
  const content = blankNotebook(64, 'build');
  content.title = 'Boots plan';
  content.groups = [{ name: 'Start', items: [{ id: 1001, count: 1 }] }];
  const entry = await transport.call('save_notebook_entry', {
    workspaceEpoch: 'fixture-epoch',
    id: null,
    expectedRevision: 0,
    content,
    confirmPatch: null,
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <BuildSyncPanel entry={entry} epoch="fixture-epoch" />
    </QueryClientProvider>,
  );
  const automatic = await screen.findByRole('switch', {
    name: 'Auto-sync items when this champion is selected',
  });
  await vi.waitFor(() => expect(automatic).toBeEnabled());
  expect(automatic).not.toBeChecked();
  fireEvent.click(automatic);
  await vi.waitFor(() => expect(automatic).toBeChecked());
  expect(screen.getByRole('button', { name: 'Sync items to client' })).toBeDisabled();
  const withoutItems = { ...entry, content: { ...content, groups: [] } };
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <BuildSyncPanel entry={withoutItems} epoch="fixture-epoch" />
    </QueryClientProvider>,
  );
  expect(automatic).toBeEnabled();
  fireEvent.click(automatic);
  await vi.waitFor(() => expect(automatic).not.toBeChecked());
});
