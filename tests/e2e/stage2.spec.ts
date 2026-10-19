import { test, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness } from './harness';
let harness: Harness; const playerKey = 'TENCENT_HN1:synthetic-player';
async function expectThemeBorders(page: import('@playwright/test').Page) {
  const darkBorders = await page.evaluate(() => { const ink = getComputedStyle(document.body).color; return Array.from(document.querySelectorAll('*')).flatMap(element => { const style = getComputedStyle(element); return ['Top', 'Right', 'Bottom', 'Left'].filter(side => element.getBoundingClientRect().width > 0 && Number.parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none' && style.getPropertyValue(`border-${side.toLowerCase()}-color`) === ink).map(side => `${element.tagName}.${element.className}:${side}`); }); });
  expect(darkBorders).toEqual([]);
}
test.beforeEach(async ({ request }) => { harness = new Harness(await mkdtemp(join(tmpdir(), 'riftmind-stage2-')), request); await harness.start(); });
test.afterEach(async ({ page }, info) => { await page.close(); await harness.stop(); if (info.status !== info.expectedStatus) { await info.attach('directory', { body: harness.root, contentType: 'text/plain' }); try { await info.attach('core-log', { path: join(harness.root, 'core.log') }); } catch { /* startup can fail before logging */ } } });
test('review evidence, draft close, feedback, goal adoption, assessment, backup and offline restart', async ({ page }, info) => {
  test.setTimeout(120000);
  await harness.wait(await harness.call('sync_player_matches', { playerKey, pages: 1 })); await page.goto('/#/matches');
  const rows = await harness.seedReviews(playerKey); const m = rows[0];
  await page.goto(`/#/matches/${encodeURIComponent(m.matchKey)}/review?player=${encodeURIComponent(playerKey)}`);
  await expect(page.getByText('Review overview', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Personal and opponent gold chart' })).toBeVisible();
  await page.getByRole('button', { name: '2:00', exact: true }).first().click(); await expect(page.getByText('Source evidence', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Annotate this evidence', exact: true }).click();
  await page.getByRole('textbox', { name: 'Note text' }).fill('<script>remains plain text</script>');
  await page.getByRole('button', { name: 'Save note', exact: true }).click(); await expect(page.locator('.note-text')).toHaveText('<script>remains plain text</script>');
  await page.getByRole('button', { name: 'Helpful', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Note text' }).fill('draft survives closing failure');
  await page.getByRole('button', { name: /^Close tab Match review/ }).click(); await expect(page.getByRole('dialog')).toContainText('Unsaved notes'); await expectThemeBorders(page); await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveValue('draft survives closing failure');
  await page.getByRole('button', { name: 'Save note', exact: true }).click(); await expect(page.locator('.note-text')).toHaveCount(2);
  await page.getByRole('button', { name: 'Adopt training goal', exact: true }).click(); await page.getByRole('button', { name: 'Confirm goal', exact: true }).click();
  await expect(page.locator('.goal-card')).toContainText('Active');
  await harness.scenario({ scenario: 'tencent', generation: 1 }); await harness.wait(await harness.call('sync_player_matches', { playerKey, pages: 1 })); await harness.seedReviews(playerKey);
  const goals = await harness.call('list_training_goals', { playerKey, state: 'active', cursor: null, limit: 50 }); await harness.wait(await harness.call('evaluate_training_goal', { id: goals.items[0].id }));
  await page.reload(); await expect(page.locator('.goal-card')).toContainText('Current window meets the target');
  await page.screenshot({ path: info.outputPath('progress-en-light.png'), animations: 'disabled' });
  const backup = await harness.wait(await harness.call('create_backup', {})); await harness.wait(await harness.call('restore_backup', { id: backup.result!.reference }));
  await harness.stop(); await harness.start('offline');
  await page.goto(`/#/matches/${encodeURIComponent(m.matchKey)}/review?player=${encodeURIComponent(playerKey)}`);
  await expect(page.locator('.note-text')).toHaveCount(2); await expect(page.getByText('Review overview', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fetch details', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Note text' }).fill('offline note'); await page.getByRole('button', { name: 'Save note', exact: true }).click(); await expect(page.locator('.note-text')).toHaveCount(3);
  await expectThemeBorders(page);
  await page.locator('.main-content').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath('review-en-light.png'), animations: 'disabled' });
  for (const [language, mode] of [['en-US', 'dark'], ['zh-CN', 'light'], ['zh-CN', 'dark']] as const) {
    const settings = await harness.call('get_settings', {}); await harness.call('update_settings', { expectedRevision: settings.revision, patch: { languagePreference: language, themeId: null, colorModePreference: mode, sidebarCollapsed: null, closeBehavior: null, autoConnect: null, autoSync: null, syncPages: null, workspaceTabs: null, activeTab: null } });
    await expect(page.locator('html')).toHaveAttribute('lang', language); await expect(page.locator('html')).toHaveAttribute('data-mode', mode); await expectThemeBorders(page);
    await page.locator('.main-content').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: info.outputPath(`review-${language}-${mode}.png`), animations: 'disabled' });
  }
  await page.setViewportSize({ width: 800, height: 600 }); await expect(page.getByRole('heading', { name: '对局复盘' })).toBeVisible(); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('.main-content')!.scrollWidth <= document.querySelector('.main-content')!.clientWidth)).toBe(true);
  await page.locator('.main-content').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath('review-zh-dark-800.png'), animations: 'disabled' });
});
test('invalid old report links stay explicit and list reads never fetch DETAILS', async ({ page }) => {
  await harness.wait(await harness.call('sync_player_matches', { playerKey, pages: 1 }));
  const before = await (await harness.request.get('/bridge/stats')).json();
  await page.goto('/#/matches'); await expect(page.locator('.match-row')).toHaveCount(50);
  const after = await (await harness.request.get('/bridge/stats')).json(); expect(after.calls).toBe(before.calls);
  const rows = await harness.call('list_matches', { playerKey, queueId: 420, championId: null, from: null, to: null, cursor: null, pageSize: 1 });
  await page.goto(`/#/matches/${encodeURIComponent(rows.items[0].matchKey)}/review?player=${encodeURIComponent(playerKey)}&report=missing-report`);
  await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByText('Review overview', { exact: true })).toHaveCount(0);
});

test('chart failures keep report text and editable notes available', async ({ page }) => {
  await harness.wait(await harness.call('sync_player_matches', { playerKey, pages: 1 })); const rows = await harness.seedReviews(playerKey);
  await page.route('**/src/features/review/ReviewChart.tsx*', route => route.abort());
  await page.goto(`/#/matches/${encodeURIComponent(rows[0].matchKey)}/review?player=${encodeURIComponent(playerKey)}`);
  await expect(page.getByText('Chart unavailable. Use the numeric table below.', { exact: true })).toBeVisible();
  await expect(page.getByText('Review overview', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Note text' }).fill('note remains editable when chart fails'); await page.getByRole('button', { name: 'Save note', exact: true }).click(); await expect(page.locator('.note-text')).toHaveText('note remains editable when chart fails');
});
