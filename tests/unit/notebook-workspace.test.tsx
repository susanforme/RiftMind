import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../src/app/query-client';
import { setTransport } from '../../src/app/runtime';
import { ChampionPlansPage } from '../../src/features/champion-plans/ChampionPlansPage';
import {
  blankNotebook,
  useNotebookDrafts,
} from '../../src/features/champion-notes/notebook-drafts';
import { fixtureTransport, resetFixture } from '../../src/lib/transport/fixture';
import i18n from '../../src/i18n';

const navigation = vi.hoisted(() => ({ search: { champion: 64 }, navigate: vi.fn() }));
vi.mock('../../src/app/router', () => ({ notebookRoute: { useSearch: () => navigation.search } }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigation.navigate }));

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
  vi.clearAllMocks();
});

function renderNotebook() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ChampionPlansPage />
    </QueryClientProvider>,
  );
}

it('reads full text immediately and opens an existing practice without creating duplicates', async () => {
  const transport = fixtureTransport();
  const content = blankNotebook(64, 'note');
  content.title = 'Track enemy jungle';
  content.text = 'Check the opposite jungle entrance. '.repeat(12);
  await transport.call('save_notebook_entry', {
    workspaceEpoch: 'fixture-epoch',
    id: null,
    expectedRevision: 0,
    content,
    confirmPatch: null,
  });
  renderNotebook();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'All', exact: true }), { key: 'Enter' });
  await screen.findByRole('heading', { name: content.title });
  expect(
    within(screen.getByRole('region', { name: 'Notebook reader' })).getByText(content.text.trim()),
  ).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Read content' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add to practice', exact: true }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByLabelText('Practice notes', { exact: true });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close', exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'In practice', exact: true }));
  await screen.findByRole('dialog');
  const practices = await transport.call('list_practice_entries', {
    championId: 64,
    kind: null,
    search: '',
    opponentId: null,
    trash: false,
  });
  expect(practices).toHaveLength(1);
  const reopened = screen.getByRole('dialog');
  fireEvent.change(within(reopened).getByLabelText('Practice notes', { exact: true }), {
    target: { value: 'Keep this unsaved practice note' },
  });
  fireEvent.click(within(reopened).getByRole('button', { name: 'Close', exact: true }));
  const confirmation = await screen.findByRole('dialog', { name: i18n.t('common.discard') });
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel', exact: true }));
  expect(screen.getByLabelText('Practice notes', { exact: true })).toHaveValue(
    'Keep this unsaved practice note',
  );
});

it('keeps separate new-entry drafts by category and retains comma-separated tag input', async () => {
  renderNotebook();
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'Create', exact: true })[0]).toBeEnabled(),
  );
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Combos', exact: true }), { key: 'Enter' });
  fireEvent.click(screen.getAllByRole('button', { name: 'Create', exact: true })[0]);
  let dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Title', { exact: true }), {
    target: { value: 'Ward hop draft' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Keep draft and close' }));
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Notes', exact: true }), { key: 'Enter' });
  fireEvent.click(screen.getAllByRole('button', { name: 'Create', exact: true })[0]);
  dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByLabelText('Title', { exact: true })).toHaveValue('');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Tags, position & patch' }));
  const tags = within(dialog).getByLabelText('Tags (comma separated)', { exact: true });
  fireEvent.change(tags, { target: { value: 'vision,' } });
  expect(tags).toHaveValue('vision,');
  fireEvent.change(tags, { target: { value: 'vision, jungle' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close', exact: true }));
  const drafts = Object.values(useNotebookDrafts.getState().drafts);
  expect(drafts.find((draft) => draft.content.kind === 'combo')?.content.title).toBe(
    'Ward hop draft',
  );
  expect(drafts.find((draft) => draft.content.kind === 'note')?.content.tags).toEqual([
    'vision',
    'jungle',
  ]);
});
