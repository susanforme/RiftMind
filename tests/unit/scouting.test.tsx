import { expect, it } from 'vitest';
import { validateSearch } from '../../src/app/router';
import { toAnalysisFilter } from '../../src/features/analysis/analysis-filter';
import { fixtureTransport, resetFixture, setScenario } from '../../src/lib/transport/fixture';
it('keeps both comparison identities and revisions while rejecting unsafe locations', () => {
  const search = {
    left: 'NA1:1',
    right: 'NA1:2',
    leftPlayer: 'NA1:p',
    rightPlayer: 'NA1:p',
    leftRevision: 3,
    rightRevision: 1,
    leftReport: 'old-report',
    rightReport: 'none',
    position: 'MIDDLE',
    patch: '16.20',
  };
  expect(validateSearch(search)).toEqual(search);
  expect(
    validateSearch({
      left: '../../secret',
      rightRevision: -1,
      position: 'guessed',
      patch: '<script>',
    }),
  ).toEqual({});
});
it('preserves champion, queue, patch, position and local date boundaries in analysis filters', () => {
  const f = toAnalysisFilter('NA1:p', {
    champion: 103,
    queue: 420,
    position: 'MIDDLE',
    patch: '16.20',
    from: '2026-10-01',
    to: '2026-10-02',
  });
  expect(f).toMatchObject({
    playerKey: 'NA1:p',
    championId: 103,
    queueId: 420,
    position: 'MIDDLE',
    patch: '16.20',
  });
  expect(new Date(f.from!).getDate()).toBe(1);
  expect(new Date(f.to!).getHours()).toBe(23);
});
it('fixture uses the scouting contract without fabricating live battle stats', async () => {
  resetFixture();
  setScenario('tencent');
  const transport = fixtureTransport();
  const live = await transport.call('get_live_snapshot', {});
  expect(live.seats).toHaveLength(10);
  expect(live.seats[0].current).toBe(true);
  expect(live.seats[0]).not.toHaveProperty('kills');
  const p = await transport.call('search_player', { query: 'Alice#TEST' });
  await transport.call('set_favorite', {
    workspaceEpoch: 'fixture-epoch',
    playerKey: p.playerKey,
    favorite: true,
  });
  await transport.call('set_favorite', {
    workspaceEpoch: 'fixture-epoch',
    playerKey: p.playerKey,
    favorite: true,
  });
  expect(await transport.call('list_favorites', {})).toHaveLength(1);
  setScenario('offline');
  expect(await transport.call('list_favorites', {})).toHaveLength(1);
  expect((await transport.call('get_live_snapshot', {})).stale).toBe(true);
});
