import { test, expect, type Page, type Locator } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
async function choose(page: Page, trigger: Locator, option: string) {
  await trigger.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
const port = process.env.RIFTMIND_E2E_PORT || '1421';
let server: ChildProcess; let root: string; let token: string;
async function start(scenario: string, devTools = true) {
  const ready = join(root, 'ready.json'); await rm(ready, { force: true });
  server = spawn('bun', ['run', 'dev:integration'], { env: { ...process.env, RIFTMIND_TEST_DIR: root, VITE_DEV_TOOLS: String(devTools), RIFTMIND_DEV_PORT: port, RIFTMIND_ORIGIN: `http://localhost:${port}`, RIFTMIND_READY_FILE: ready, RIFTMIND_SCENARIO: scenario }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr?.on('data', data => { void import('node:fs').then(fs => fs.appendFileSync(join(root, 'core.log'), data)); });
  await expect.poll(async () => { try { token = JSON.parse(await readFile(ready, 'utf8')).token; return true; } catch { return false; } }, { timeout: 120000 }).toBe(true);
  await expect.poll(async () => { try { return (await fetch(`http://localhost:${port}`)).status; } catch { return 0; } }).toBe(200);
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const exit = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGINT'); await exit;
  await expect.poll(async () => { try { await fetch(`http://localhost:${port}`); return false; } catch { return true; } }).toBe(true);
}
test.beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'riftmind-e2e-')); });
test.afterEach(async ({ page }, info) => { await page.close(); await stop(); if (info.status !== info.expectedStatus) { await info.attach('scenario-directory', { body: root, contentType: 'text/plain' }); try { await info.attach('core-log', { path: join(root, 'core.log') }); } catch { /* process may fail before writing logs */ } } });
test('no-client startup, navigation and settings persistence through a real process restart', async ({ page }) => {
  await start('no-client'); await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Match history' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await choose(page, page.getByLabel('Display language'), 'English'); await page.getByRole('radio', { name: 'Dark', exact: true }).check();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  await stop(); await start('no-client'); await page.reload(); await page.goto('/#/settings');
  await expect(page.getByLabel('Display language')).toHaveText('English'); await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
});
test('HTTP sync, filters, pagination, backup restore, offline process restart and account isolation', async ({ page, request }) => {
  await start('tencent'); await page.goto('/');
  await expect(page.locator('.match-row')).toHaveCount(50);
  await page.getByRole('button', { name: 'Sync matches', exact: true }).click();
  await expect(page.getByText('125 saved matches')).toBeVisible();
  await page.getByRole('button', { name: 'Next page', exact: true }).click(); await expect(page.locator('.match-row')).toHaveCount(50);
  await page.getByRole('button', { name: 'Back to latest', exact: true }).click();
  await choose(page, page.getByLabel('Game mode'), 'ARAM'); await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByText('42 saved matches')).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  const champion = page.getByRole('combobox', { name: 'Champion', exact: true });
  await champion.fill('Ahri');
  const ahri = page.getByRole('option', { name: 'Ahri', exact: true });
  await expect(ahri.locator('img')).toBeVisible();
  await ahri.click();
  await expect(champion).toHaveValue('Ahri');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByText('63 saved matches')).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Create backup', exact: true }).click();
  await expect(page.getByLabel('Backup file ID')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Restore backup', exact: true }).click(); await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Backup restored', { exact: true })).toBeVisible();
  await request.post('/bridge/scenario', { headers: { 'x-riftmind-token': token }, data: { scenario: 'riot' } });
  await page.getByRole('button', { name: 'Matches', exact: true }).click();
  await expect(page.locator('.player-banner')).toContainText('North America');
  await stop(); await start('offline'); await page.reload(); await page.goto('/#/matches');
  await choose(page, page.getByLabel('Switch player'), 'Rift Walker #DEMO · Ionia');
  await expect(page.locator('.match-row')).toHaveCount(50); await expect(page.getByRole('button', { name: 'Sync matches', exact: true })).toBeDisabled();
  await expect(page.getByText('125 saved matches')).toBeVisible();
});
test('two pages, both languages and modes, system mode and narrow layout', async ({ page }, info) => {
  await start('no-client'); await page.goto('/#/settings');
  for (const language of ['en-US', 'zh-CN']) {
    for (const mode of ['light', 'dark']) {
      await choose(page, page.locator('#language'), language === 'en-US' ? 'English' : '简体中文');
      await page.getByRole('radiogroup').getByRole('radio').nth(mode === 'light' ? 0 : 1).check();
      await page.locator('.save-bar .button-primary').click();
      await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
      await expect(page.locator('html')).toHaveCSS('color-scheme', mode);
      await expect(page.locator('.save-bar .button-primary')).toBeDisabled();
      await expect(page.locator('.sidebar-actions > .nav-item').first()).toHaveClass(/selected/);
      await page.screenshot({ animations: 'disabled', path: info.outputPath(`settings-${language}-${mode}.png`) });
      const matchesNav = page.getByRole('button', { name: language === 'en-US' ? 'Matches' : '战绩', exact: true }); await matchesNav.click(); await expect(matchesNav).toHaveClass(/selected/); await expect(page.locator('.matches-page')).toBeVisible(); await page.screenshot({ animations: 'disabled', path: info.outputPath(`matches-${language}-${mode}.png`) });
      await expect(page.locator('.main-content')).toBeVisible();
      await page.locator('.sidebar-actions > .nav-item').first().click(); await expect(page.locator('.settings-page')).toBeVisible();
    }
  }
  await page.getByRole('radiogroup').getByRole('radio').nth(2).check(); await page.locator('.save-bar .button-primary').click();
  await page.emulateMedia({ colorScheme: 'dark' }); await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  await page.emulateMedia({ colorScheme: 'light' }); await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
  await page.setViewportSize({ width: 800, height: 600 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: /恢复备份|Restore backup/, exact: true }).isVisible();
});

test('development toolbar can be disabled by environment', async ({ page }) => {
  await start('no-client', false); await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Match history' })).toBeVisible();
  await expect(page.getByTestId('dev-toolbar')).toHaveCount(0);
});

test('resource proxy loads images from disk after a real process restart with the upstream offline', async ({ page, request }) => {
  await start('tencent'); await page.goto('/');
  await expect(page.locator('.match-row')).toHaveCount(50);
  await expect.poll(() => page.locator('.match-row img').evaluateAll(images => images.length === 150 && images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  const before = await (await request.get('/bridge/stats')).json() as { assetCalls: number };
  expect(before.assetCalls).toBeGreaterThan(0);
  await readFile(join(root, 'assets/cdragon/16.20/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/103.png'));
  await page.reload();
  await expect.poll(() => page.locator('.match-row img').evaluateAll(images => images.length === 150 && images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  expect((await (await request.get('/bridge/stats')).json() as { assetCalls: number }).assetCalls).toBe(before.assetCalls);
  await stop(); await start('offline'); await page.reload(); await page.goto('/');
  await expect(page.locator('.match-row')).toHaveCount(50);
  await expect.poll(() => page.locator('.match-row img').evaluateAll(images => images.length === 150 && images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  expect((await (await request.get('/bridge/stats')).json() as { assetCalls: number }).assetCalls).toBe(0);
});

test('window controls stay at the upper right and compact navigation keeps accessible names', async ({ page }) => {
  await start('no-client', false); await page.goto('/#/settings');
  for (const width of [1280, 800]) {
    await page.setViewportSize({ width, height: 600 });
    const controls = page.getByRole('group', { name: 'Window controls' });
    await expect(controls).toBeVisible();
    const bounds = (await controls.boundingBox())!;
    expect(bounds.y).toBe(0); expect(bounds.x + bounds.width).toBe(width);
    for (const name of ['Minimize', 'Maximize', 'Close window']) await expect(controls.getByRole('button', { name, exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Matches', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Progress', exact: true })).toBeVisible();
    expect(await page.locator('.main-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await page.getByRole('link', { name: 'Skip to content' }).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await page.getByRole('button', { name: 'Progress', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible();
  await expect(page.locator('.page-heading p')).toHaveCount(0);
  expect(await page.locator('.main-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('sidebar theme cycles with keyboard and keeps the collapse control anchored', async ({ page }, info) => {
  await start('no-client', false);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const theme = page.getByRole('button', { name: /^Appearance:/ });
  await expect(theme).toHaveAccessibleName('Appearance: System. Switch to Light');
  await expect(page.locator('.mode-switch')).toHaveCount(0);
  await theme.focus();
  for (const [mode, label, key] of [
    ['light', 'Appearance: Light. Switch to Dark', 'Enter'],
    ['dark', 'Appearance: Dark. Switch to System', 'Space'],
    ['dark', 'Appearance: System. Switch to Light', 'Enter'],
  ]) {
    await expect(theme).toBeEnabled();
    await page.keyboard.press(key);
    await expect(theme).toHaveAccessibleName(label);
    await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
  const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true });
  await expect(collapse).toBeEnabled();
  const expandedBounds = (await collapse.boundingBox())!;
  await page.screenshot({ path: info.outputPath('sidebar-expanded-light.png') });
  await collapse.click();
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  const collapsedBounds = (await expand.boundingBox())!;
  expect(collapsedBounds.x).toBe(expandedBounds.x);
  expect(collapsedBounds.y).toBe(expandedBounds.y);
  await theme.click();
  await expect(theme).toHaveAccessibleName('Appearance: Light. Switch to Dark');
  await theme.click();
  await expect(theme).toHaveAccessibleName('Appearance: Dark. Switch to System');
  await page.reload();
  await expect(theme).toHaveAccessibleName('Appearance: Dark. Switch to System');
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await page.setViewportSize({ width: 800, height: 600 });
  await expect(page.locator('.sidebar-actions')).toBeInViewport();
  const actionsBounds = (await page.locator('.sidebar-actions').boundingBox())!;
  expect(actionsBounds.y + actionsBounds.height).toBeLessThanOrEqual(600);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ animations: 'disabled', path: info.outputPath('sidebar-collapsed-dark.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expand.focus();
  await page.keyboard.press('Enter');
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
});
