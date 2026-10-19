import { test, expect } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness } from './harness';
let harness: Harness;
const playerKey = 'TENCENT_HN1:synthetic-player';
test.beforeEach(async ({ request }) => {
  harness = new Harness(await mkdtemp(join(tmpdir(), 'riftmind-scouting-')), request);
  await harness.start();
});
test.afterEach(async ({ page }, info) => {
  await page.close();
  await harness.stop();
  if (info.status !== info.expectedStatus)
    await info.attach('core-log', { path: join(harness.root, 'core.log') });
});
test('live phase, champion changes, anonymous players, cancellation and reconnect', async ({
  page,
}, info) => {
  await harness.scenario({ scenario: 'tencent', livePhase: 'ChampSelect' });
  await page.goto('/#/live');
  await expect(page.locator('[data-ui~=live-seat]')).toHaveCount(10);
  await expect(page.locator('[data-current=true]')).toHaveCount(1);
  await expect(page.locator('[data-ui~=profile-stats]')).toHaveCount(10);
  await expect(
    page.locator('[data-current=true]').getByRole('img', { name: 'Ahri', exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.locator('[data-current=true]').getByRole('img', { name: 'Flash', exact: true }),
  ).toBeVisible();
  const before = await harness.call('get_live_snapshot', {});
  const statsBefore = await (await harness.request.get('/bridge/stats')).json();
  await harness.scenario({
    scenario: 'tencent',
    livePhase: 'ChampSelect',
    championId: 64,
    anonymous: true,
  });
  await expect(page.getByText('Identity not public', { exact: true })).toBeVisible();
  await expect(page.locator('[data-current=true]')).toContainText('Lee Sin');
  const after = await harness.call('get_live_snapshot', {});
  expect(after.generation).toBe(before.generation);
  const statsAfter = await (await harness.request.get('/bridge/stats')).json();
  expect(statsAfter.profileCalls).toBe(statsBefore.profileCalls);
  expect(statsAfter.detailsCalls).toBe(0);
  const latencies: number[] = [];
  for (let n = 0; n < 8; n++) {
    const start = Date.now();
    await harness.scenario({
      scenario: 'tencent',
      livePhase: n % 2 ? 'ChampSelect' : 'ReadyCheck',
    });
    await expect(page.locator('[data-ui~=live-seat]')).toHaveCount(n % 2 ? 10 : 0);
    latencies.push(Date.now() - start);
  }
  latencies.sort((a, b) => a - b);
  if (process.env.RIFTMIND_SCOUTING_PERF_REPORT)
    await writeFile(
      `${process.env.RIFTMIND_SCOUTING_PERF_REPORT}-browser.json`,
      JSON.stringify({
        eventIterations: 8,
        eventToDomP95Ms: latencies[7],
        profileCalls: statsAfter.profileCalls,
        detailsCalls: statsAfter.detailsCalls,
      }),
    );
  await page.screenshot({ path: info.outputPath('live-en-light.png') });
  await harness.scenario({ scenario: 'tencent', livePhase: 'Matchmaking' });
  await expect(page.locator('[data-ui~=live-seat]')).toHaveCount(0);
  await harness.scenario({
    scenario: 'tencent',
    livePhase: 'InProgress',
    gameId: '900719925474101',
  });
  await expect(page.locator('[data-ui~=live-seat]')).toHaveCount(10);
  await expect(page.getByText('In game', { exact: true })).toBeVisible();
  await harness.scenario({ scenario: 'offline' });
  await expect(page.getByText('Snapshot is stale', { exact: true })).toBeVisible();
  await harness.scenario({ scenario: 'tencent', livePhase: 'EndOfGame' });
  await expect(page.getByText('Game ended', { exact: true })).toBeVisible();
  for (const [language, mode] of [
    ['zh-CN', 'dark'],
    ['en-US', 'light'],
  ] as const) {
    const settings = await harness.call('get_settings', {});
    await harness.call('update_settings', {
      expectedRevision: settings.revision,
      patch: {
        languagePreference: language,
        colorModePreference: mode,
        themeId: null,
        sidebarCollapsed: null,
        closeBehavior: null,
        autoConnect: null,
        autoSync: null,
        syncPages: null,
        workspaceTabs: null,
        activeTab: null,
      },
    });
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await page.setViewportSize({ width: 800, height: 600 });
    await page.screenshot({ path: info.outputPath(`live-${language}-${mode}-800.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
test('search, favorites, champion filters, fixed comparison, issue draft, backup and offline restart', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await harness.wait(await harness.call('sync_player_matches', { playerKey, pages: 1 }));
  const rows = await harness.seedReviews(playerKey);
  await page.goto('/#/matches');
  await page.getByRole('button', { name: 'Find player', exact: true }).click();
  await page.getByRole('textbox', { name: 'Player Riot ID' }).fill('Alice#TEST');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('button', { name: /Alice#TEST/ })).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Favorite player', exact: true })
    .click();
  await expect.poll(async () => (await harness.call('list_favorites', {})).length).toBe(1);
  await page
    .getByRole('button', { name: /Alice#TEST/ })
    .first()
    .click();
  await expect(page.locator('[data-ui~=player-identity]')).toContainText('Alice#TEST');
  await page.getByRole('button', { name: 'Sync matches', exact: true }).click();
  await expect(page.locator('[data-ui~=match-row]')).toHaveCount(50);
  expect((await harness.call('get_connection_state', {})).player?.playerKey).toBe(playerKey);
  await page.goto(`/#/champions?player=${encodeURIComponent(playerKey)}`);
  await expect(page.getByRole('img', { name: 'Games by champion' })).toBeVisible();
  await expect(page.locator('[data-ui~=champions-page] table tbody tr')).not.toHaveCount(0);
  await page.screenshot({ path: info.outputPath('champions-en-light.png') });
  await page.goto(
    `/#/compare?player=${encodeURIComponent(playerKey)}&left=${encodeURIComponent(rows[0].matchKey)}&right=${encodeURIComponent(rows[1].matchKey)}`,
  );
  await expect(page.locator('[data-ui~=compare-sides]')).toBeVisible();
  await expect(page).toHaveURL(/leftReport=/);
  const url = page.url();
  const leftReport = new URL(url).hash.match(/leftReport=([^&]+)/)?.[1];
  expect(leftReport).toBeTruthy();
  await expect(
    page.getByRole('img', { name: 'Time-aligned match comparison chart', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Swap sides', exact: true }).click();
  await expect(page).toHaveURL(/rightReport=/);
  await page.screenshot({ path: info.outputPath('compare-en-light.png') });
  await page
    .locator('[data-ui~=compare-sides]')
    .getByRole('button', { name: 'Events', exact: true })
    .first()
    .click();
  await expect(page.locator('[data-ui~=compare-events]')).toContainText('Item purchased');
  await expect(
    page.locator('[data-ui~=compare-events]').getByRole('img', { name: 'Boots', exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('[data-ui~=compare-events]').getByRole('img', { name: 'Skill Q', exact: true }),
  ).toBeVisible();
  await page.goto(`/#/progress?player=${encodeURIComponent(playerKey)}`);
  await expect(page.getByText('Recurring observations', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create goal draft', exact: true }).first().click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Create goal draft', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const goals = await harness.call('list_training_goals', {
    playerKey,
    state: 'draft',
    cursor: null,
    limit: 50,
  });
  expect(goals.items[0].scope.origin?.reports.length).toBeGreaterThan(0);
  await expect(page.locator('[data-ui~=goal-card]')).toContainText('Draft');
  await page
    .locator('[data-ui~=goal-card]')
    .getByRole('button', { name: 'Activate / resume', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.locator('[data-ui~=goal-card]')).toContainText('Active');
  await page.screenshot({ path: info.outputPath('issues-en-light.png') });
  for (const [language, mode] of [
    ['zh-CN', 'dark'],
    ['en-US', 'light'],
  ] as const) {
    const settings = await harness.call('get_settings', {});
    await harness.call('update_settings', {
      expectedRevision: settings.revision,
      patch: {
        languagePreference: language,
        colorModePreference: mode,
        themeId: null,
        sidebarCollapsed: null,
        closeBehavior: null,
        autoConnect: null,
        autoSync: null,
        syncPages: null,
        workspaceTabs: null,
        activeTab: null,
      },
    });
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await page.setViewportSize({ width: 800, height: 600 });
    for (const [name, path] of [
      ['champions', `/champions?player=${encodeURIComponent(playerKey)}`],
      ['compare', new URL(url).hash.slice(1)],
      ['issues', `/progress?player=${encodeURIComponent(playerKey)}`],
    ]) {
      await page.goto(`/#${path}`);
      await expect(page.locator('[data-ui~=page]')).toBeVisible();
      if (name === 'champions')
        await expect(page.locator('[data-ui~=pool-chart] canvas')).toHaveCount(1);
      if (name === 'compare')
        await expect(page.locator('[data-ui~=review-chart] canvas')).toHaveCount(1);
      if (name === 'issues')
        await expect(page.locator('[data-ui~=issues-panel] table tbody tr')).toHaveCount(2);
      await page.locator('[data-ui~=main-content]').evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.screenshot({ path: info.outputPath(`${name}-${language}-${mode}-800.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
  for (let n = 0; n < 4; n++) {
    await page.goto(`/#/champions?player=${encodeURIComponent(playerKey)}`);
    await expect(page.locator('[data-ui~=pool-chart] canvas')).toHaveCount(1);
    await page.goto('/#/matches');
    await expect(page.locator('[data-ui~=pool-chart] canvas')).toHaveCount(0);
  }
  const backup = await harness.wait(await harness.call('create_backup', {}));
  await harness.wait(await harness.call('restore_backup', { id: backup.result!.reference }));
  await harness.stop();
  await harness.start('offline');
  await page.reload();
  await page.goto('/#/matches');
  await page.getByRole('button', { name: 'Find player', exact: true }).click();
  await expect(page.locator('[data-ui~=favorites]')).toContainText('Alice#TEST');
  await page
    .getByRole('button', { name: /Alice#TEST/ })
    .first()
    .click();
  await expect(page.locator('[data-ui~=match-row]')).toHaveCount(50);
  await page.goto(`/#/champions?player=${encodeURIComponent(playerKey)}`);
  await expect(page.getByRole('img', { name: 'Games by champion' })).toBeVisible();
});
