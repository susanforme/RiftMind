import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LivePage } from '../../src/features/live/LivePage';
import { isPartyPhase, sortLiveSeats } from '../../src/features/live/live-roster';
import { setTransport } from '../../src/app/runtime';
import { fixtureTransport, resetFixture, setScenario } from '../../src/lib/transport/fixture';
import i18n from '../../src/i18n';
import type { PlayerProfile } from '../../src/generated/contracts';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));

afterEach(cleanup);

it('orders both rosters by role, keeps unknown roles last, and preserves the snapshot', async () => {
  resetFixture();
  setScenario('tencent');
  const snapshot = await fixtureTransport().call('get_live_snapshot', {});
  const seats = snapshot.seats.slice(0, 5);
  const original = [...seats];
  const unknownSeat = { ...seats[0], seat: 99, position: null };
  const ordered = sortLiveSeats([unknownSeat, ...seats]);
  expect(ordered.map((seat) => seat.position?.toUpperCase())).toEqual([
    'TOP',
    'JUNGLE',
    'MIDDLE',
    'BOTTOM',
    'UTILITY',
    undefined,
  ]);
  expect(seats).toEqual(original);
  expect(
    sortLiveSeats([
      { ...seats[0], position: 'support' },
      { ...seats[1], position: 'mid' },
    ]).map((seat) => seat.position),
  ).toEqual(['mid', 'support']);
});

it('shows lobby identities and levels before champion select and removes departed members', async () => {
  await i18n.changeLanguage('en-US');
  resetFixture();
  setScenario('party');
  const partyTransport = fixtureTransport();
  setTransport(partyTransport);
  const app = await partyTransport.call('get_app_state', {});
  const connection = await partyTransport.call('get_connection_state', {});
  const snapshot = await partyTransport.call('get_live_snapshot', {});
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(['app'], app);
  client.setQueryData(['connection'], connection);
  const liveKey = ['live', app.workspaceEpoch, connection.sessionEpoch];
  client.setQueryData(liveKey, snapshot);
  const calls = vi.spyOn(partyTransport, 'call');
  const view = render(
    <QueryClientProvider client={client}>
      <LivePage />
    </QueryClientProvider>,
  );
  expect(screen.getByRole('heading', { name: 'Lobby members' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Party Friend#TEST' })).toBeVisible();
  expect(screen.getByLabelText('Level 182')).toBeVisible();
  expect(screen.getByLabelText('Level 225')).toBeVisible();
  expect(screen.queryByRole('tab', { name: 'Current champion' })).toBeNull();
  await waitFor(() => expect(screen.getAllByText('Unranked')).toHaveLength(2));
  expect(calls.mock.calls.filter(([command]) => command === 'get_player_profile')).toHaveLength(2);
  for (const phase of ['Matchmaking', 'ReadyCheck', 'Lobby']) {
    expect(isPartyPhase(phase)).toBe(true);
    client.setQueryData(liveKey, { ...snapshot, phase });
    await waitFor(() =>
      expect(view.container.querySelectorAll('[data-ui="live-seat"]')).toHaveLength(2),
    );
  }
  client.setQueryData(liveKey, {
    ...snapshot,
    seats: snapshot.seats.filter((seat) => seat.current),
  });
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Party Friend#TEST' })).toBeNull(),
  );
  expect(screen.getByRole('button', { name: 'Rift Walker#TEST' })).toBeVisible();
  expect(isPartyPhase('ChampSelect')).toBe(false);
  view.unmount();
  client.clear();
  calls.mockRestore();
});

it('switches all ten players to champion statistics without additional profile requests', async () => {
  await i18n.changeLanguage('en-US');
  resetFixture();
  setScenario('tencent');
  const liveTransport = fixtureTransport();
  setTransport(liveTransport);
  const app = await liveTransport.call('get_app_state', {});
  const connection = await liveTransport.call('get_connection_state', {});
  const snapshot = await liveTransport.call('get_live_snapshot', {});
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(['app'], app);
  client.setQueryData(['connection'], connection);
  client.setQueryData(['live', app.workspaceEpoch, connection.sessionEpoch], snapshot);
  const seededProfiles: Array<{ queryKey: unknown[]; profile: PlayerProfile }> = [];
  for (const seat of snapshot.seats) {
    const profile = await liveTransport.call('get_player_profile', {
      playerKey: seat.player!.playerKey,
      queueId: snapshot.queueId,
      championId: seat.championId,
    });
    const queryKey = [
      'player-profile',
      app.workspaceEpoch,
      snapshot.sessionEpoch,
      seat.player!.playerKey,
      snapshot.queueId,
      seat.championId,
    ];
    const seededProfile = {
      ...profile,
      games: 20,
      championGames: 4,
      winRate: { value: 0.6, samples: 20, excluded: {} },
      kda: { value: 3, samples: 18, excluded: { missing: 2 } },
      championWinRate: { value: 0.25, samples: 4, excluded: {} },
      championKda: { value: 2, samples: 3, excluded: { missing: 1 } },
    };
    seededProfiles.push({ queryKey, profile: seededProfile });
    client.setQueryData(queryKey, seededProfile);
  }
  const calls = vi.spyOn(liveTransport, 'call');
  const view = render(
    <QueryClientProvider client={client}>
      <LivePage />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(client.isFetching({ queryKey: ['player-profile'] })).toBe(0));
  for (const { queryKey, profile } of seededProfiles) client.setQueryData(queryKey, profile);
  await waitFor(() => expect(screen.getAllByText('60.0%')).toHaveLength(10));
  expect(screen.getAllByText('3', { selector: '[data-ui="profile-stats"] dd span' })).toHaveLength(
    10,
  );
  expect(screen.queryByText(/^n=\d+$/)).toBeNull();
  const initialProfileRequests = calls.mock.calls.filter(
    ([command]) => command === 'get_player_profile',
  ).length;
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Current champion' }), {
    button: 0,
    ctrlKey: false,
  });
  await waitFor(() => expect(screen.getAllByText('25.0%')).toHaveLength(10));
  expect(screen.getAllByText('2', { selector: '[data-ui="profile-stats"] dd span' })).toHaveLength(
    10,
  );
  expect(screen.queryByText(/^n=\d+$/)).toBeNull();
  expect(screen.queryByText('60.0%')).toBeNull();
  expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Current champion');
  expect(calls.mock.calls.filter(([command]) => command === 'get_player_profile')).toHaveLength(
    initialProfileRequests,
  );
  view.unmount();
  client.clear();
  calls.mockRestore();
});
