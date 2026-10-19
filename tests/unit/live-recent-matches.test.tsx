import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LiveRecentMatches } from '../../src/features/live/LiveRecentMatches';
import { setTransport } from '../../src/app/runtime';
import { fixtureTransport, resetFixture, setScenario } from '../../src/lib/transport/fixture';
import type { CommandName, Transport } from '../../src/lib/transport';
import type {
  CommandMap,
  MatchScoreboard,
  ScoreboardParticipant,
} from '../../src/generated/contracts';
import i18n from '../../src/i18n';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));
afterEach(cleanup);

async function renderRecentMatches({ failHistory = false, empty = false, current = false } = {}) {
  await i18n.changeLanguage('en-US');
  resetFixture();
  setScenario('party');
  const base = fixtureTransport();
  const connection = await base.call('get_connection_state', {});
  const player = {
    ...connection.player!,
    playerKey: 'TENCENT_HN1:room-friend',
    displayName: 'Room friend#TEST',
  };
  const overview = await base.call('get_player_overview', {
    playerKey: connection.player!.playerKey,
    queueId: 420,
    days: null,
  });
  const template = overview.matches[0];
  expect(template).toBeDefined();
  const matches = empty
    ? []
    : Array.from({ length: 12 }, (_, index) => ({
        ...template,
        playerKey: player.playerKey,
        matchKey: `TENCENT_HN1:${100 + index}`,
        gameId: `${100 + index}`,
        startedAt: new Date(Date.UTC(2026, 9, 19, 0, index)).toISOString(),
        kills: index,
      }));
  const member: ScoreboardParticipant = {
    id: 1,
    playerKey: player.playerKey,
    displayName: player.displayName,
    teamId: 100,
    championId: 103,
    level: 18,
    position: 'MIDDLE',
    win: true,
    kills: 11,
    deaths: 2,
    assists: 5,
    cs: 200,
    gold: 14000,
    damage: 28000,
    damageTaken: 10000,
    visionScore: 22,
    wardsPlaced: 10,
    wardsKilled: 4,
    controlWards: 2,
    spells: [4, 14],
    primaryRune: 8112,
    secondaryRune: 8200,
    items: [3020, 3089, 0, 0, 0, 0, 3340],
    roleItem: null,
    multiKill: 2,
  };
  const board: MatchScoreboard = {
    matchKey: 'TENCENT_HN1:111',
    targetId: 1,
    source: 'sgp',
    participants: [
      member,
      {
        ...member,
        id: 2,
        playerKey: 'TENCENT_HN1:opponent',
        displayName: 'Opponent#TEST',
        teamId: 200,
        win: false,
      },
    ],
    teams: [100, 200].map((id) => ({
      id,
      win: id === 100,
      kills: 20,
      gold: 40000,
      damage: 60000,
      barons: 1,
      dragons: 2,
      towers: 5,
      inhibitors: 1,
      riftHeralds: 0,
      voidGrubs: 3,
    })),
  };
  const requests: { command: CommandName; args: unknown }[] = [];
  let shouldFail = failHistory;
  const recentTransport: Transport = {
    ...base,
    async call<K extends CommandName>(
      command: K,
      args: CommandMap[K]['input'],
    ): Promise<CommandMap[K]['output']> {
      requests.push({ command, args });
      if (command === 'get_player_overview') {
        if (shouldFail) {
          shouldFail = false;
          throw { code: 'network_unavailable' };
        }
        return {
          ...overview,
          isSelf: current,
          profile: { ...overview.profile, player },
          matches,
        } as CommandMap[K]['output'];
      }
      if (command === 'get_match_scoreboard') return board as CommandMap[K]['output'];
      return base.call(command, args);
    },
  };
  setTransport(recentTransport);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <LiveRecentMatches
        player={player}
        queueId={420}
        epoch="room-epoch"
        session="room-session"
        enabled
        current={current}
      />
    </QueryClientProvider>,
  );
  return { client, view, requests };
}

it('shows ten latest games and opens the shared full match summary and scoreboard only on click', async () => {
  const { view, client, requests } = await renderRecentMatches();
  const region = screen.getByRole('region', { name: 'Recent matches' });
  await waitFor(() => expect(within(region).getAllByRole('button')).toHaveLength(10));
  expect(within(region).getAllByRole('button')[0]).toHaveTextContent('11 /');
  expect(requests.filter(({ command }) => command === 'get_match_scoreboard')).toHaveLength(0);
  expect(requests.find(({ command }) => command === 'get_player_overview')?.args).toEqual({
    playerKey: 'TENCENT_HN1:room-friend',
    queueId: 420,
    days: null,
  });
  fireEvent.click(within(region).getAllByRole('button')[0]);
  const dialog = await screen.findByRole('dialog', { name: 'Room friend#TEST · Match details' });
  expect(await within(dialog).findByRole('tab', { name: 'Overview' })).toBeVisible();
  expect(within(dialog).getByText('Opponent#TEST')).toBeVisible();
  expect(dialog.querySelector('[data-ui="match-row"]')).not.toBeNull();
  expect(dialog.querySelector('[data-ui="match-details-content"]')).toHaveAttribute(
    'aria-hidden',
    'false',
  );
  expect(within(dialog).queryByRole('button', { name: /Select match/ })).toBeNull();
  expect(within(dialog).queryByRole('button', { name: 'Open review' })).toBeNull();
  fireEvent.mouseDown(within(dialog).getByRole('tab', { name: 'Items' }), {
    button: 0,
    ctrlKey: false,
  });
  expect(within(dialog).getByRole('tab', { name: 'Items' })).toHaveAttribute(
    'data-state',
    'active',
  );
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(requests.filter(({ command }) => command === 'get_match_scoreboard')).toHaveLength(1);
  view.unmount();
  client.clear();
});

it('retries history failures and leaves an empty history without selectable games', async () => {
  const { view, client, requests } = await renderRecentMatches({ failHistory: true, empty: true });
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('No records')).toBeVisible();
  expect(requests.filter(({ command }) => command === 'get_player_overview')).toHaveLength(2);
  expect(requests.filter(({ command }) => command === 'get_match_scoreboard')).toHaveLength(0);
  view.unmount();
  client.clear();
});

it('keeps review available for the local player inside the reused details', async () => {
  const { view, client } = await renderRecentMatches({ current: true });
  const region = screen.getByRole('region', { name: 'Recent matches' });
  await waitFor(() => expect(within(region).getAllByRole('button')).toHaveLength(10));
  fireEvent.click(within(region).getAllByRole('button')[0]);
  expect(await screen.findByRole('button', { name: 'Open review' })).toBeVisible();
  view.unmount();
  client.clear();
});
