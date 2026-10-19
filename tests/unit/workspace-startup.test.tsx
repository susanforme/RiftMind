import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../src/app/query-client';
import { setTransport } from '../../src/app/runtime';
import { AppShell } from '../../src/app/shell/AppShell';
import { fixtureTransport, resetFixture, setScenario } from '../../src/lib/transport/fixture';
import { defaultTab, useWorkspace } from '../../src/stores/workspace-tabs';
import i18n from '../../src/i18n';

const routing = vi.hoisted(() => ({
  location: { pathname: '/matches', search: {}, href: '/matches' },
  navigate: vi.fn(async () => {}),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => routing.navigate,
  useRouterState: (options: { select: (state: typeof routing) => unknown }) =>
    options.select(routing),
  Outlet: () => null,
}));
vi.mock('../../src/app/providers', () => ({ RuntimeEffects: () => null }));
vi.mock('../../src/app/shell/WorkspacePages', () => ({ WorkspacePages: () => null }));

beforeEach(async () => {
  resetFixture();
  queryClient.clear();
  setTransport(fixtureTransport());
  useWorkspace.setState({
    tabs: [defaultTab],
    draft: null,
    dirty: false,
    scroll: {},
    reviewDrafts: {},
    workspaceChanged: false,
  });
  routing.location = { pathname: '/matches', search: {}, href: '/matches' };
  routing.navigate.mockClear();
  await i18n.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

async function loadWorkspace() {
  const transport = fixtureTransport();
  queryClient.setQueryData(['app'], await transport.call('get_app_state', {}));
  queryClient.setQueryData(['players'], await transport.call('list_players', {}));
  queryClient.setQueryData(['connection'], await transport.call('get_connection_state', {}));
  const settings = await transport.call('get_settings', {});
  queryClient.setQueryData(['settings'], {
    ...settings,
    workspaceTabs: Array.from({ length: 12 }, (_, index) => ({
      id: `notebooks:${index + 1}`,
      kind: 'notebooks',
      playerKey: null,
      search: JSON.stringify({ champion: index + 1 }),
    })),
    activeTab: 'notebooks:12',
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>,
  );
}

describe('workspace startup', () => {
  it('opens only the current page even when settings contain a group of saved tabs', async () => {
    await loadWorkspace();
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1));
    expect(useWorkspace.getState().tabs.map((tab) => tab.id)).toEqual(['matches']);
    expect(routing.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Settings', exact: true }));
    expect(useWorkspace.getState().tabs.map((tab) => tab.id)).toEqual(['matches', 'settings']);
  });

  it('starts a direct settings link without adding an unused match history tab', async () => {
    routing.location = { pathname: '/settings', search: {}, href: '/settings' };
    await loadWorkspace();
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1));
    expect(useWorkspace.getState().tabs.map((tab) => tab.id)).toEqual(['settings']);
  });

  it('does not insert background account tabs when a client connects or changes account', async () => {
    routing.location = { pathname: '/live', search: {}, href: '/live' };
    await loadWorkspace();
    for (const scenario of ['tencent', 'riot'] as const) {
      setScenario(scenario);
      queryClient.setQueryData(
        ['connection'],
        await fixtureTransport().call('get_connection_state', {}),
      );
      await waitFor(() => expect(screen.getByText('Client connected')).toBeInTheDocument());
      expect(useWorkspace.getState().tabs.map((tab) => tab.id)).toEqual(['live']);
    }
    expect(routing.navigate).not.toHaveBeenCalled();
  });
});

describe('workspace tab context menu', () => {
  it('opens tab actions on right click without a separate action button or navigation', async () => {
    await loadWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Settings', exact: true }));
    routing.navigate.mockClear();
    expect(screen.queryByRole('button', { name: 'Tab actions' })).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Settings', exact: true }));
    expect(await screen.findByRole('menuitem', { name: 'Close other tabs' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Move tab right' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(routing.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move tab left' }));
    expect(useWorkspace.getState().tabs.map((tab) => tab.id)).toEqual(['settings', 'matches']);
  });

  it.each(['Close other tabs', 'Close tabs to the right'])(
    'runs %s against the right-clicked tab',
    async (action) => {
      await loadWorkspace();
      fireEvent.click(screen.getByRole('button', { name: 'Settings', exact: true }));
      fireEvent.contextMenu(screen.getByRole('tab', { name: 'My matches', exact: true }));
      fireEvent.click(await screen.findByRole('menuitem', { name: action }));
      expect(useWorkspace.getState().tabs.map((tab) => tab.id)).toEqual(['matches']);
    },
  );
});
