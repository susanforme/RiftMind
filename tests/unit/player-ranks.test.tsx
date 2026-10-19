import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RankEntry } from '../../src/generated/contracts';
import { LivePlayerCard } from '../../src/features/live/LivePlayerCard';
import {
  allRankQueues,
  rankForRoom,
  rankedTier,
  rankDivision,
} from '../../src/features/live/player-ranks';
import { fixtureTransport, resetFixture, setScenario } from '../../src/lib/transport/fixture';
import { setTransport } from '../../src/app/runtime';
import i18n from '../../src/i18n';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));

const soloRank: RankEntry = { queue: 'RANKED_SOLO_5x5', tier: 'GOLD', division: 'II', points: 44 };
const flexRank: RankEntry = {
  queue: 'RANKED_FLEX_SR',
  tier: 'EMERALD',
  division: 'III',
  points: 68,
};

afterEach(cleanup);

it.each([420, 450, 400, 490, null])('uses the solo rank for room queue %s', (queueId) => {
  expect(rankForRoom([flexRank, soloRank], queueId)).toBe(soloRank);
});

it('uses only flex in flex rooms and never substitutes a different ranked mode', () => {
  expect(rankForRoom([soloRank, flexRank], 440)).toBe(flexRank);
  expect(rankForRoom([soloRank], 440)).toBeUndefined();
  expect(rankForRoom([flexRank], 450)).toBeUndefined();
  expect(rankForRoom([{ ...soloRank, queue: '420' }], 420)?.tier).toBe('GOLD');
  expect(rankForRoom([{ ...flexRank, queue: '440' }], 440)?.tier).toBe('EMERALD');
});

it('retains all returned ranked modes and leaves undivided or unranked tiers without a division', () => {
  const tftRank = { ...soloRank, queue: 'RANKED_TFT', tier: 'MASTER', division: 'I' };
  expect(allRankQueues([flexRank, tftRank]).map(({ queue }) => queue)).toEqual([
    soloRank.queue,
    flexRank.queue,
    'RANKED_TFT',
  ]);
  expect(rankDivision(tftRank)).toBe('');
  expect(rankedTier({ ...soloRank, tier: 'NONE' })).toBeNull();
  expect(rankDivision({ ...soloRank, tier: 'UNRANKED' })).toBe('');
});

async function renderPlayerRanks(queueId: number | null, ranks = [soloRank, flexRank]) {
  await i18n.changeLanguage('en-US');
  resetFixture();
  setScenario('party');
  const rankTransport = fixtureTransport();
  setTransport(rankTransport);
  const app = await rankTransport.call('get_app_state', {});
  const snapshot = await rankTransport.call('get_live_snapshot', {});
  const seat = snapshot.seats[0];
  const profile = await rankTransport.call('get_player_profile', {
    playerKey: seat.player!.playerKey,
    queueId,
    championId: seat.championId,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(['app'], app);
  client.setQueryData(
    [
      'player-profile',
      app.workspaceEpoch,
      snapshot.sessionEpoch,
      seat.player!.playerKey,
      queueId,
      seat.championId,
    ],
    { ...profile, ranks },
  );
  const view = render(
    <QueryClientProvider client={client}>
      <LivePlayerCard
        seat={seat}
        queueId={queueId}
        epoch={app.workspaceEpoch}
        session={snapshot.sessionEpoch}
        stale={false}
        metricScope="recent"
      />
    </QueryClientProvider>,
  );
  return { client, view };
}

it.each([
  [420, 'Ranked Solo/Duo · Gold II'],
  [440, 'Ranked Flex · Emerald III'],
  [450, 'Ranked Solo/Duo · Gold II'],
] as const)('places the selected rank after the name in queue %s', async (queueId, label) => {
  const { view, client } = await renderPlayerRanks(queueId);
  const rankBadge = screen.getByLabelText(label);
  expect(rankBadge.previousElementSibling).toBe(
    screen.getByRole('button', { name: 'Rift Walker#TEST', exact: true }),
  );
  expect(screen.getByText('You')).toBeVisible();
  expect(screen.queryByText('Signed in')).toBeNull();
  view.unmount();
  client.clear();
});

it('opens all modes from the avatar on hover, focus and click, and closes on Escape', async () => {
  const { view, client } = await renderPlayerRanks(440, [
    soloRank,
    flexRank,
    { ...soloRank, queue: 'RANKED_TFT', tier: 'MASTER', division: 'I', points: 120 },
  ]);
  const avatar = screen.getByRole('button', {
    name: 'All ranks for Rift Walker#TEST',
    exact: true,
  });
  fireEvent.pointerEnter(avatar, { pointerType: 'mouse' });
  const panel = await screen.findByRole('dialog', { name: 'All ranks for Rift Walker#TEST' });
  expect(within(panel).getByText('Ranked Solo/Duo')).toBeVisible();
  expect(within(panel).getByText('Ranked Flex')).toBeVisible();
  expect(within(panel).getByText('Ranked TFT')).toBeVisible();
  expect(within(panel).getByText('68')).toBeVisible();
  expect(within(panel).getByText('Ranked Flex').closest('tr')).toHaveAttribute(
    'data-current-queue',
    'true',
  );
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(avatar).toHaveAttribute('aria-expanded', 'false'));
  fireEvent.focus(avatar);
  await waitFor(() => expect(avatar).toHaveAttribute('aria-expanded', 'true'));
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(avatar).toHaveAttribute('aria-expanded', 'false'));
  fireEvent.click(avatar);
  expect(avatar).toHaveAttribute('aria-expanded', 'true');
  fireEvent.blur(avatar);
  expect(avatar).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(avatar);
  expect(avatar).toHaveAttribute('aria-expanded', 'false');
  view.unmount();
  client.clear();
});
