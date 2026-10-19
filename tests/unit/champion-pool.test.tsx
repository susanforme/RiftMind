import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  championPoolRequest,
  selectedChampionQueues,
  useChampionPool,
} from '../../src/features/champions/champion-pool';
import { setTransport } from '../../src/app/runtime';
import type { Transport } from '../../src/lib/transport';
import type { ReactNode } from 'react';
import { MetricValue } from '../../src/features/analysis/MetricValue';
import { validateSearch } from '../../src/app/router';
import { fixtureTransport, resetFixture, setScenario } from '../../src/lib/transport/fixture';
import { scoutingFixture } from '../../src/lib/transport/scouting-fixture';
import type { ChampionPool, MatchSummary } from '../../src/generated/contracts';
import i18n from '../../src/i18n';

afterEach(cleanup);

it('retains rows while sorting but clears results when player, workspace or modes change', async () => {
  const pending: ((pool: ChampionPool) => void)[] = [];
  const call = vi.fn(() => new Promise<ChampionPool>((resolve) => pending.push(resolve)));
  setTransport({
    mode: 'fixture',
    call: call as Transport['call'],
    subscribe: async () => () => {},
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const original: ChampionPool = {
    items: [],
    nextCursor: null,
    cachedMatches: 1,
    filteredMatches: 1,
    from: null,
    to: null,
    truncated: false,
  };
  const initialProps = { player: 'first-player', epoch: 'workspace', queues: [420], sort: 'games' };
  const { result, rerender } = renderHook(
    ({ player, epoch, queues, sort }) => useChampionPool(player, epoch, { queues }, sort),
    { wrapper, initialProps },
  );
  await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
  await act(async () => {
    pending.shift()!(original);
  });
  await waitFor(() => expect(result.current.data).toEqual(original));
  rerender({ ...initialProps, sort: 'win_rate' });
  expect(result.current.isPlaceholderData).toBe(true);
  expect(result.current.data).toEqual(original);
  await act(async () => {
    pending.shift()!(original);
  });
  rerender({ ...initialProps, player: 'second-player' });
  expect(result.current.data).toBeUndefined();
  await act(async () => {
    pending.shift()!(original);
  });
  rerender({ ...initialProps, player: 'second-player', queues: [450, 2400] });
  expect(result.current.data).toBeUndefined();
  await act(async () => {
    pending.shift()!(original);
  });
  rerender({
    ...initialProps,
    player: 'second-player',
    queues: [450, 2400],
    epoch: 'another-workspace',
  });
  expect(result.current.data).toBeUndefined();
  client.clear();
});

it('defaults to solo queue, preserves explicit all modes and normalizes bookmarked mode selections', () => {
  expect(selectedChampionQueues({})).toEqual([420]);
  expect(selectedChampionQueues({ queue: 450 })).toEqual([450]);
  expect(selectedChampionQueues({ queues: [] })).toEqual([]);
  const search = validateSearch({
    queues: [2400, '450', 450],
    championSort: 'win_rate',
    championCursor: 6,
  });
  expect(search).toEqual({ queues: [450, 2400], championSort: 'win_rate', championCursor: 6 });
  expect(championPoolRequest('player', search, 'win_rate', 6).queueIds).toEqual([450, 2400]);
  expect(
    championPoolRequest('player', { queue: 420, queues: [450, 2400] }).filter.queueId,
  ).toBeNull();
  for (const queues of [[0], [1_000_000], ['invalid'], Array(33).fill(420)])
    expect(validateSearch({ queues }).queues).toBeUndefined();
});

it('omits repeated sample labels while retaining missing-data explanations', async () => {
  await i18n.changeLanguage('en-US');
  render(
    <MetricValue
      metric={{ value: 0.5, samples: 12, excluded: { missing: 2 } }}
      ratio
      showSamples={false}
    />,
  );
  expect(screen.getByText('50.0%')).toHaveAttribute('title', expect.stringContaining('2'));
  expect(screen.queryByText(/n=|sample/i)).not.toBeInTheDocument();
});

it('keeps preview aggregates consistent across default, combined, all modes and pagination', async () => {
  resetFixture();
  setScenario('tencent');
  const transport = fixtureTransport();
  const connection = await transport.call('get_connection_state', {});
  const playerKey = connection.player!.playerKey;
  const history = await transport.call('list_matches', {
    playerKey,
    queueId: null,
    championId: null,
    from: null,
    to: null,
    cursor: null,
    pageSize: 50,
  });
  const seed = history.items[0];
  const matches: MatchSummary[] = [
    { ...seed, matchKey: 'solo', queueId: 420, championId: 103, outcome: 'win' },
    { ...seed, matchKey: 'aram', queueId: 450, championId: 103, outcome: 'loss' },
    { ...seed, matchKey: 'mayhem', queueId: 2400, championId: 103, outcome: 'win' },
    { ...seed, matchKey: 'flex', queueId: 440, championId: 64, outcome: 'loss' },
    { ...seed, matchKey: 'remake', queueId: 420, championId: 103, outcome: 'remake' },
    { ...seed, matchKey: 'remake-only', queueId: 2400, championId: 157, outcome: 'remake' },
  ];
  const context = {
    matches,
    connection,
    now: new Date(),
    emit: vi.fn(),
    fail: (code: string): never => {
      throw new Error(code);
    },
    task: (): never => {
      throw new Error('Unexpected task');
    },
  };
  const query = (queues?: number[], cursor: number | null = null, limit = 6) =>
    scoutingFixture(
      'get_champion_pool',
      championPoolRequest(playerKey, { queues }, 'games', cursor, limit),
      context,
      context,
    ) as ChampionPool;
  const solo = query();
  expect(solo.filteredMatches).toBe(1);
  expect(solo.items[0].games).toBe(1);
  expect(solo.items[0].winRate).toMatchObject({ value: 1, samples: 1 });
  const combined = query([450, 2400]);
  expect(combined.items).toHaveLength(1);
  expect(combined.items[0]).toMatchObject({ games: 2, winRate: { value: 0.5, samples: 2 } });
  expect(combined.items[0].trend.map((match) => match.matchKey)).toEqual(['aram', 'mayhem']);
  const firstPage = query([], null, 1);
  expect(firstPage.filteredMatches).toBe(4);
  expect(firstPage.items[0]).toMatchObject({ championId: 103, games: 3 });
  expect(firstPage.nextCursor).toBe(1);
  expect(query([], firstPage.nextCursor, 1).items[0].championId).toBe(64);
  expect(query([]).items.some((champion) => champion.championId === 157)).toBe(false);
});
