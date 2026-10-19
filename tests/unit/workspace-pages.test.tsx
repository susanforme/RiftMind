import { useId, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { router } from '../../src/app/router';
import { queryClient } from '../../src/app/query-client';
import { setTransport } from '../../src/app/runtime';
import { useWorkspaceNavigate, useWorkspaceSearch } from '../../src/app/workspace-page-context';
import { Button } from '../../src/components/ui/button';
import { Input } from '../../src/components/ui/input';
import { Label } from '../../src/components/ui/label';
import { fixtureTransport, resetFixture } from '../../src/lib/transport/fixture';
import { defaultTab, useWorkspace } from '../../src/stores/workspace-tabs';
import i18n from '../../src/i18n';

vi.mock('../../src/app/providers', () => ({ RuntimeEffects: () => null }));
vi.mock('../../src/features/matches/MatchesPage', () => ({ MatchesPage: WorkspaceProbe }));
vi.mock('../../src/features/progress/ProgressPage', () => ({ ProgressPage: WorkspaceProbe }));
vi.mock('../../src/features/review/ReviewPage', () => ({ ReviewPage: WorkspaceProbe }));

const backgroundNavigations = new Map<string, () => Promise<void>>();
const loadMatchSummary = vi.fn(async () => 'Initial summary');

function WorkspaceProbe() {
  const search = useWorkspaceSearch(undefined);
  const navigate = useWorkspaceNavigate();
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);
  const draftId = useId();
  const identity = search.match || search.player || 'current';
  const summary = useQuery({
    queryKey: ['matches', identity],
    queryFn: loadMatchSummary,
  });
  backgroundNavigations.set(identity, () =>
    navigate({
      to: search.match ? '/matches/$matchKey/review' : '/matches',
      params: { matchKey: search.match || '' },
      search: { ...search, report: 'completed-report' },
    }),
  );
  return (
    <>
      <Label htmlFor={draftId}>Draft</Label>
      <Input id={draftId} value={draft} onChange={(event) => setDraft(event.target.value)} />
      <output aria-label="Player">{identity}</output>
      <output aria-label="Report">{search.report || 'none'}</output>
      <output aria-label="Summary">{summary.data}</output>
      <Button onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
        Details
      </Button>
      {expanded && <p>Expanded details</p>}
    </>
  );
}

beforeEach(async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  resetFixture();
  queryClient.clear();
  backgroundNavigations.clear();
  loadMatchSummary.mockClear();
  loadMatchSummary.mockResolvedValue('Initial summary');
  setTransport(fixtureTransport());
  useWorkspace.setState({
    tabs: [defaultTab],
    draft: null,
    dirty: false,
    scroll: {},
    reviewDrafts: {},
    workspaceChanged: false,
  });
  await i18n.changeLanguage('en-US');
  const transport = fixtureTransport();
  for (const [key, command] of [
    ['app', 'get_app_state'],
    ['players', 'list_players'],
    ['connection', 'get_connection_state'],
    ['settings', 'get_settings'],
  ] as const) {
    queryClient.setQueryData([key], await transport.call(command, {}));
  }
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

async function openWorkspace(initialEntry = '/matches?player=NA1:alpha') {
  const workspaceRouter = createRouter({
    routeTree: router.routeTree,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={workspaceRouter} />
    </QueryClientProvider>,
  );
  await screen.findByRole('textbox', { name: 'Draft' });
  return workspaceRouter;
}

it('retains separate DOM, inputs, expanded state and scroll for two tabs of the same page', async () => {
  const workspaceRouter = await openWorkspace();
  const alphaInput = screen.getByRole('textbox', { name: 'Draft' });
  const alphaPanel = screen.getByRole('tabpanel');
  fireEvent.change(alphaInput, { target: { value: 'Alpha draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  alphaPanel.scrollTop = 240;
  await act(() => workspaceRouter.navigate({ to: '/matches', search: { player: 'NA1:beta' } }));
  expect(screen.getByRole('status', { name: 'Player' })).toHaveTextContent('NA1:beta');
  expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('');
  expect(alphaInput.isConnected).toBe(true);
  expect(alphaInput).not.toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: 'Draft' }), {
    target: { value: 'Beta draft' },
  });
  await act(() => workspaceRouter.navigate({ to: '/matches', search: { player: 'NA1:alpha' } }));
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(alphaInput);
  expect(alphaInput).toHaveValue('Alpha draft');
  expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'true');
  expect(alphaPanel.scrollTop).toBe(240);
  expect(within(alphaPanel).getByLabelText('Player')).toHaveTextContent('NA1:alpha');
  await act(() => workspaceRouter.navigate({ to: '/matches', search: { player: 'NA1:beta' } }));
  expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Beta draft');
});

it('preserves page state through tab clicks, route history, search updates and reordering', async () => {
  const workspaceRouter = await openWorkspace();
  const draft = screen.getByRole('textbox', { name: 'Draft' });
  fireEvent.change(draft, { target: { value: 'Keep me' } });
  fireEvent.click(screen.getByRole('button', { name: 'Progress', exact: true }));
  await waitFor(() => expect(workspaceRouter.state.location.pathname).toBe('/progress'));
  const matchTab = screen.getByRole('tab', { name: 'My matches' });
  fireEvent.keyDown(matchTab, { key: 'Enter' });
  await waitFor(() => expect(draft).toBeVisible());
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft);
  await act(() =>
    workspaceRouter.navigate({ to: '/matches', search: { player: 'NA1:alpha', queue: 420 } }),
  );
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft);
  act(() => useWorkspace.getState().reorder('progress:current', 'matches:NA1:alpha'));
  expect(draft).toHaveValue('Keep me');
  act(() => workspaceRouter.history.back());
  await waitFor(() => expect(workspaceRouter.state.location.search).not.toHaveProperty('queue'));
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft);
});

it('updates a background review without navigating and discards callbacks after closing it', async () => {
  const workspaceRouter = await openWorkspace('/matches/match-alpha/review?player=NA1:alpha');
  const reviewDraft = screen.getByRole('textbox', { name: 'Draft' });
  const completeReview = backgroundNavigations.get('match-alpha')!;
  fireEvent.click(screen.getByRole('button', { name: 'Progress', exact: true }));
  await waitFor(() => expect(workspaceRouter.state.location.pathname).toBe('/progress'));
  await act(completeReview);
  expect(workspaceRouter.state.location.pathname).toBe('/progress');
  expect(
    JSON.parse(useWorkspace.getState().tabs.find((tab) => tab.kind === 'review')!.search),
  ).toMatchObject({ player: 'NA1:alpha', match: 'match-alpha', report: 'completed-report' });
  const reviewTab = screen.getByRole('tab', { name: /Match review/ });
  fireEvent.keyDown(reviewTab, { key: 'Enter' });
  await waitFor(() => expect(reviewDraft).toBeVisible());
  expect(screen.getByRole('status', { name: 'Report' })).toHaveTextContent('completed-report');
  fireEvent.click(screen.getByRole('button', { name: /Close tab Match review/ }));
  await waitFor(() => expect(reviewDraft.isConnected).toBe(false));
  const location = workspaceRouter.state.location.href;
  await act(completeReview);
  expect(workspaceRouter.state.location.href).toBe(location);
  expect(useWorkspace.getState().tabs.some((tab) => tab.kind === 'review')).toBe(false);
});

it('unmounts closed tabs and starts a fresh instance when reopening', async () => {
  const workspaceRouter = await openWorkspace();
  const draft = screen.getByRole('textbox', { name: 'Draft' });
  fireEvent.change(draft, { target: { value: 'Discard on close' } });
  screen.getByRole('tabpanel').scrollTop = 180;
  fireEvent.click(screen.getByRole('button', { name: 'Progress', exact: true }));
  await waitFor(() => expect(workspaceRouter.state.location.pathname).toBe('/progress'));
  fireEvent.click(screen.getByRole('button', { name: 'Close tab My matches' }));
  await waitFor(() => expect(draft.isConnected).toBe(false));
  await act(() => workspaceRouter.navigate({ to: '/matches', search: { player: 'NA1:alpha' } }));
  expect(screen.getByRole('textbox', { name: 'Draft' })).not.toBe(draft);
  expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('');
  expect(screen.getByRole('tabpanel').scrollTop).toBe(0);
});

it('releases all removed instances when closing other tabs', async () => {
  const workspaceRouter = await openWorkspace();
  const alphaDraft = screen.getByRole('textbox', { name: 'Draft' });
  await act(() => workspaceRouter.navigate({ to: '/matches', search: { player: 'NA1:beta' } }));
  const betaDraft = screen.getByRole('textbox', { name: 'Draft' });
  fireEvent.click(screen.getByRole('button', { name: 'Progress', exact: true }));
  await waitFor(() => expect(workspaceRouter.state.location.pathname).toBe('/progress'));
  const progressDraft = screen.getByRole('textbox', { name: 'Draft' });
  fireEvent.contextMenu(screen.getByRole('tab', { name: 'Progress' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Close other tabs' }));
  await waitFor(() => expect(alphaDraft.isConnected).toBe(false));
  expect(betaDraft.isConnected).toBe(false);
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(progressDraft);
  expect(useWorkspace.getState().tabs).toHaveLength(1);
});

it('discards business page instances when the workspace epoch changes', async () => {
  await openWorkspace();
  const draft = screen.getByRole('textbox', { name: 'Draft' });
  const completeOldRequest = backgroundNavigations.get('NA1:alpha')!;
  fireEvent.change(draft, { target: { value: 'Previous workspace' } });
  screen.getByRole('tabpanel').scrollTop = 180;
  act(() => {
    queryClient.setQueryData(['app'], {
      ...queryClient.getQueryData<Record<string, unknown>>(['app']),
      workspaceEpoch: 'replacement-workspace',
    });
  });
  await waitFor(() => expect(draft.isConnected).toBe(false));
  expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('');
  expect(screen.getByRole('tabpanel').scrollTop).toBe(0);
  await act(completeOldRequest);
  expect(screen.getByRole('status', { name: 'Report' })).toHaveTextContent('none');
});

it('refreshes the selected tab instance and refetches fresh cached queries without navigation', async () => {
  const workspaceRouter = await openWorkspace();
  const draft = screen.getByRole('textbox', { name: 'Draft' });
  const completeOldRequest = backgroundNavigations.get('NA1:alpha')!;
  fireEvent.change(draft, { target: { value: 'Reset on refresh' } });
  screen.getByRole('tabpanel').scrollTop = 180;
  await waitFor(() =>
    expect(screen.getByRole('status', { name: 'Summary' })).toHaveTextContent('Initial summary'),
  );
  const location = workspaceRouter.state.location.href;
  const tabIds = useWorkspace.getState().tabs.map((tab) => tab.id);
  loadMatchSummary.mockResolvedValue('Updated summary');
  fireEvent.contextMenu(screen.getByRole('tab', { name: 'My matches' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Refresh', exact: true }));
  await waitFor(() => expect(draft.isConnected).toBe(false));
  expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('');
  expect(screen.getByRole('tabpanel').scrollTop).toBe(0);
  await waitFor(() =>
    expect(screen.getByRole('status', { name: 'Summary' })).toHaveTextContent('Updated summary'),
  );
  expect(workspaceRouter.state.location.href).toBe(location);
  expect(useWorkspace.getState().tabs.map((tab) => tab.id)).toEqual(tabIds);
  await act(completeOldRequest);
  expect(screen.getByRole('status', { name: 'Report' })).toHaveTextContent('none');
});

it('refreshes a background tab without activating it or replacing the current page', async () => {
  const workspaceRouter = await openWorkspace();
  const matchDraft = screen.getByRole('textbox', { name: 'Draft' });
  fireEvent.change(matchDraft, { target: { value: 'Old match draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Progress', exact: true }));
  await waitFor(() => expect(workspaceRouter.state.location.pathname).toBe('/progress'));
  const progressDraft = screen.getByRole('textbox', { name: 'Draft' });
  fireEvent.change(progressDraft, { target: { value: 'Keep progress draft' } });
  const location = workspaceRouter.state.location.href;
  fireEvent.contextMenu(screen.getByRole('tab', { name: 'My matches' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Refresh', exact: true }));
  await waitFor(() => expect(matchDraft.isConnected).toBe(false));
  expect(workspaceRouter.state.location.href).toBe(location);
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(progressDraft);
  expect(progressDraft).toHaveValue('Keep progress draft');
  fireEvent.keyDown(screen.getByRole('tab', { name: 'My matches' }), { key: 'Enter' });
  await waitFor(() =>
    expect(screen.getByRole('status', { name: 'Player' })).toHaveTextContent('NA1:alpha'),
  );
  expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('');
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Progress' }), { key: 'Enter' });
  await waitFor(() => expect(progressDraft).toBeVisible());
  expect(progressDraft).toHaveValue('Keep progress draft');
});
