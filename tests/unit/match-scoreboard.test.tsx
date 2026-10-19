import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  MatchScoreboard as Scoreboard,
  MatchSummary,
  ScoreboardParticipant,
  ScoreboardTeam,
} from '../../src/generated/contracts';
import { MatchScoreboard } from '../../src/features/matches/MatchScoreboard';
import {
  csPerMinute,
  formatMatchKda,
  killParticipation,
  matchRelativeTime,
} from '../../src/features/matches/match-scoreboard-formatters';
import { setTransport } from '../../src/app/runtime';
import { fixtureTransport } from '../../src/lib/transport/fixture';
import i18n from '../../src/i18n';
import { defaultTab, useWorkspace } from '../../src/stores/workspace-tabs';
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
afterEach(() => {
  cleanup();
  useWorkspace.getState().setTabs([defaultTab]);
  navigate.mockClear();
});

const participant: ScoreboardParticipant = {
  id: 1,
  playerKey: 'NA1:player',
  displayName: 'Player#NA1',
  teamId: 100,
  championId: 103,
  level: 12,
  position: 'MIDDLE',
  win: true,
  kills: 2,
  deaths: 0,
  assists: 4,
  cs: 0,
  gold: 0,
  damage: 1000,
  damageTaken: 2000,
  visionScore: 0,
  wardsPlaced: 0,
  wardsKilled: 0,
  controlWards: 0,
  spells: [4, 14],
  primaryRune: 8112,
  secondaryRune: 8200,
  items: [0, 3020, 0, 0, 0, 0, 3340],
  roleItem: null,
  multiKill: 2,
};
const team: ScoreboardTeam = {
  id: 100,
  win: true,
  kills: 8,
  gold: 0,
  damage: 1000,
  barons: 0,
  dragons: 2,
  towers: 3,
  inhibitors: 0,
  riftHeralds: 1,
  voidGrubs: null,
};

it('distinguishes missing statistics from zero and uses actual team kills for participation', () => {
  expect(csPerMinute(0, 1200)).toBe('0.0');
  expect(csPerMinute(null, 1200)).toBeNull();
  expect(csPerMinute(123, 1000)).toBe('7.4');
  expect(formatMatchKda(2, 0, 4)).toBe('Perfect');
  expect(formatMatchKda(2, null, 4)).toBe('—');
  expect(killParticipation(participant, team)).toBe(75);
  expect(killParticipation(participant, { ...team, kills: null })).toBeNull();
  expect(killParticipation({ ...participant, kills: 0, assists: 0 }, { ...team, kills: 0 })).toBe(
    0,
  );
  expect(
    matchRelativeTime('2026-10-16T00:00:00Z', 'zh-CN', Date.parse('2026-10-19T00:00:00Z')),
  ).toBe('3天前');
});

it('renders both teams with real loadout slots and highlights the inspected player without an external score column', async () => {
  await i18n.changeLanguage('en-US');
  setTransport(fixtureTransport());
  const scoreboard: Scoreboard = {
    matchKey: 'NA1:42',
    targetId: 1,
    source: 'sgp',
    participants: Array.from({ length: 10 }, (_, index) => ({
      ...participant,
      id: index + 1,
      teamId: index < 5 ? 100 : 200,
      displayName: `Player ${index + 1}`,
      playerKey: index === 9 ? null : `NA1:player-${index + 1}`,
    })),
    teams: [team, { ...team, id: 200, win: false }],
  };
  const match: MatchSummary = {
    matchKey: 'NA1:42',
    playerKey: 'NA1:player',
    gameId: '42',
    serverId: 'NA1',
    startedAt: '2026-10-19T00:00:00Z',
    queueId: 420,
    championId: 103,
    version: '16.20.1',
    outcome: 'win',
    kills: 2,
    deaths: 0,
    assists: 4,
    duration: 1200,
    position: 'MIDDLE',
    cs: 0,
    items: [],
    source: 'sgp',
    fallbackReason: null,
    revision: 1,
    reviewState: null,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MatchScoreboard scoreboard={scoreboard} match={match} />
    </QueryClientProvider>,
  );
  const tables = screen.getAllByRole('table');
  expect(tables).toHaveLength(2);
  expect(within(tables[0]).getAllByRole('row')).toHaveLength(6);
  expect(within(tables[1]).getAllByRole('row')).toHaveLength(6);
  expect(screen.getByText('Player 1').closest('tr')).toHaveAttribute('data-current', 'true');
  expect(within(tables[0]).getAllByLabelText('Items')).toHaveLength(5);
  expect(screen.queryByText('OP Score')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open review' })).toBeEnabled();

  const spell = within(tables[0]).getAllByRole('button', { name: 'Flash', exact: true })[0];
  expect(spell.parentElement?.closest('button')).toBeNull();
  fireEvent.click(spell);
  expect(await screen.findByRole('dialog', { name: 'Flash' })).toBeVisible();
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: 'Escape' });

  for (const playerNumber of [1, 6, 1]) {
    fireEvent.click(
      screen.getByRole('button', { name: `Player ${playerNumber} · Player overview` }),
    );
    expect(navigate).toHaveBeenLastCalledWith({
      to: '/players',
      search: { player: `NA1:player-${playerNumber}`, tab: `players:NA1:player-${playerNumber}` },
    });
  }
  expect(useWorkspace.getState().tabs).toEqual([
    defaultTab,
    { id: 'players:NA1:player-1', kind: 'players', playerKey: 'NA1:player-1', search: '{}' },
    { id: 'players:NA1:player-6', kind: 'players', playerKey: 'NA1:player-6', search: '{}' },
  ]);
  expect(screen.getByText('Player 10').closest('button')).toBeNull();

  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Items' }), { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByRole('button', { name: 'Player 2 · Player overview' }));
  expect(navigate).toHaveBeenLastCalledWith({
    to: '/players',
    search: { player: 'NA1:player-2', tab: 'players:NA1:player-2' },
  });
  client.clear();
});
