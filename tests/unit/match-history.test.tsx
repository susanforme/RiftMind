import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MatchSummary } from '../../src/generated/contracts';
import {
  groupMatchesByDate,
  recentMatchStats,
  MatchHistoryRow,
} from '../../src/features/matches/MatchHistory';
import { setTransport } from '../../src/app/runtime';
import { fixtureTransport } from '../../src/lib/transport/fixture';
import i18n from '../../src/i18n';
import { selectedChampionSkin, ChampionArtwork } from '../../src/components/ChampionArtwork';
import { PlayerAvatar } from '../../src/features/players/PlayerAvatar';

const match: MatchSummary = {
  matchKey: 'NA1:100',
  playerKey: 'NA1:player',
  gameId: '100',
  serverId: 'NA1',
  startedAt: '2026-10-19T12:00:00',
  queueId: 420,
  championId: 103,
  version: '16.20.1',
  outcome: 'win',
  kills: 5,
  deaths: 0,
  assists: 7,
  duration: 1800,
  position: 'MIDDLE',
  cs: 200,
  items: [1001, 2003],
  source: 'lcu',
  fallbackReason: null,
  revision: 1,
  reviewState: 'missing',
};
afterEach(cleanup);

it('groups by local calendar date and preserves the input order across years', () => {
  const sameDay = { ...match, matchKey: 'NA1:101', startedAt: '2026-10-19T01:00:00' };
  const previousYear = { ...match, matchKey: 'NA1:102', startedAt: '2025-10-19T12:00:00' };
  const groups = groupMatchesByDate([match, sameDay, previousYear], 'en-US');
  expect(groups).toHaveLength(2);
  expect(groups[0].matches.map((entry) => entry.matchKey)).toEqual(['NA1:100', 'NA1:101']);
  expect(groups[1].date).toContain('2025');
});

it('excludes remakes and unknown results from win rate and missing stats from KDA', () => {
  expect(recentMatchStats([])).toMatchObject({ winRate: null, kda: null });
  expect(
    recentMatchStats([
      match,
      { ...match, outcome: 'loss', kills: 1, deaths: 2, assists: 1 },
      { ...match, outcome: 'remake', kills: null, deaths: null, assists: null },
      { ...match, outcome: 'unknown', kills: null, deaths: null, assists: null },
    ]),
  ).toEqual({ wins: 1, losses: 1, winRate: 50, kda: '7.0' });
  expect(recentMatchStats([match]).kda).toBe('12.0');
});

it('keeps inspecting a match separate from the batch selection and its limit', async () => {
  await i18n.changeLanguage('en-US');
  setTransport(fixtureTransport());
  const inspect = vi.fn();
  const select = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MatchHistoryRow
        match={match}
        active
        selected={false}
        disabled
        onSelect={select}
        onInspect={inspect}
      />
    </QueryClientProvider>,
  );
  const selectionButton = screen.getByRole('button', { name: /Select match/ });
  const detailsButton = screen.getByRole('button', { name: /Match details/ });
  expect(selectionButton).toBeDisabled();
  expect(selectionButton).toHaveAttribute('aria-pressed', 'false');
  expect(detailsButton).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(detailsButton);
  expect(inspect).toHaveBeenCalledOnce();
  expect(select).not.toHaveBeenCalled();
});

it('uses only catalogue skins and falls back to the base artwork after a stale selection', () => {
  const skins = [
    { id: 103000, name: 'Ahri', isBase: true },
    { id: 103001, name: 'Dynasty Ahri', isBase: false },
  ];
  expect(selectedChampionSkin(skins, 103001)).toEqual(skins[1]);
  expect(selectedChampionSkin(skins, 64001)).toEqual(skins[0]);
  expect(selectedChampionSkin([], 103001)).toBeUndefined();
});

it('requests the valid zero profile icon and displays only a real player level', async () => {
  await i18n.changeLanguage('en-US');
  const playerTransport = fixtureTransport();
  const calls = vi.spyOn(playerTransport, 'call');
  setTransport(playerTransport);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const player = {
    playerKey: 'NA1:player',
    serverId: 'NA1',
    puuid: 'player',
    displayName: 'Rift Walker',
    updatedAt: '2026-10-19T12:00:00Z',
    profileIconId: 0,
    summonerLevel: 182,
  };
  const view = render(
    <QueryClientProvider client={client}>
      <PlayerAvatar player={player} />
    </QueryClientProvider>,
  );
  expect(screen.getByLabelText('Level 182')).toBeVisible();
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith(
      'resolve_assets',
      expect.objectContaining({ resourceIds: [{ kind: 'profile_icon', id: 0 }] }),
    ),
  );
  calls.mockClear();
  view.rerender(
    <QueryClientProvider client={client}>
      <PlayerAvatar player={{ ...player, profileIconId: null, summonerLevel: null }} />
    </QueryClientProvider>,
  );
  expect(screen.queryByLabelText('Level 182')).toBeNull();
  expect(calls).not.toHaveBeenCalled();
});

it('removes failed splash artwork without replacing it with another image', async () => {
  await i18n.changeLanguage('en-US');
  setTransport(fixtureTransport());
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(
    ['champion-splash', '16.20.1', 'en-US', 103000],
    [{ reference: 'https://assets.example/ahri.jpg' }],
  );
  render(
    <QueryClientProvider client={client}>
      <ChampionArtwork skin={{ id: 103000, name: 'Ahri', isBase: true }} version="16.20.1" />
    </QueryClientProvider>,
  );
  fireEvent.error(screen.getByRole('img', { name: 'Ahri artwork' }));
  expect(screen.queryByRole('img')).toBeNull();
});
