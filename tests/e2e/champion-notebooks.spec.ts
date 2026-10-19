import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Harness } from './harness';
import { blankNotebook } from '../../src/features/champion-notes/notebook-drafts';
import type { NotebookContent, NotebookEntry } from '../../src/generated/contracts';
let harness: Harness;
const playerKey = 'TENCENT_HN1:synthetic-player';
test.beforeEach(async ({ request }, testInfo) => {
  const parent = join(process.cwd(), '.tmp/e2e-notebooks');
  await mkdir(parent, { recursive: true });
  harness = new Harness(await mkdtemp(join(parent, 'workspace-')), request);
  await harness.start(testInfo.title.includes('without matches') ? 'no-client' : 'tencent');
});
test.afterEach(async ({ page }) => {
  await page.close();
  await harness.stop();
});
async function epoch() {
  return (await harness.call('get_app_state', {})).workspaceEpoch;
}
async function save(content: NotebookContent, old?: NotebookEntry) {
  return harness.call('save_notebook_entry', {
    workspaceEpoch: await epoch(),
    id: old?.id || null,
    expectedRevision: old?.revision || 0,
    content,
    confirmPatch: null,
  });
}
async function entries(championId = 64, trash = false) {
  return harness.call('list_notebook_entries', {
    championId,
    kind: null,
    search: '',
    opponentId: null,
    trash,
  });
}
test('create a champion combo without matches, keep drafts, practice, history, trash and exchange', async ({
  page,
}) => {
  await harness.scenario({ scenario: 'no-client' });
  await page.goto('/#/notebooks?champion=64');
  await expect(
    page.getByRole('heading', { name: 'Champion notebooks', exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Combos', exact: true }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('Q1 ward hop Q2');
  await dialog
    .getByLabel('Content', { exact: true })
    .fill('Use a ward before W1. <script>literal content</script>');
  await dialog.getByRole('button', { name: 'Add step', exact: true }).click();
  await dialog.getByLabel('Action label', { exact: true }).fill('1');
  await dialog.getByRole('button', { name: 'Add step', exact: true }).click();
  await dialog.getByLabel('Action label', { exact: true }).nth(1).fill('2');
  await dialog.getByRole('button', { name: 'Move up', exact: true }).nth(1).click();
  await expect(dialog.getByLabel('Action label', { exact: true }).first()).toHaveValue('2');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-ui~=combo-sequence]')).toContainText('Q 2');
  expect(await entries()).toHaveLength(1);
  const combo = (await entries())[0];
  await page.getByRole('button', { name: 'Add to practice', exact: true }).click();
  await expect(page.getByLabel('Practice notes', { exact: true })).toBeVisible();
  await page.getByLabel('Practice notes', { exact: true }).fill('Slowly, then at full speed');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect(
    (
      await harness.call('list_practice_entries', {
        championId: 64,
        kind: null,
        search: '',
        opponentId: null,
        trash: false,
      })
    )[0].notes,
  ).toBe('Slowly, then at full speed');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await dialog.getByLabel('Content', { exact: true }).fill('Unsaved across navigation');
  await dialog.getByRole('button', { name: 'Keep draft and close', exact: true }).click();
  await page.getByRole('button', { name: /Resume draft:/ }).click();
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(
    'Unsaved across navigation',
  );
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Edit: Q1 ward hop Q2', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Revision history', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Restore this revision', exact: true })
    .last()
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await entries())[0].content.text).toContain('Use a ward');
  await page.getByRole('button', { name: 'Edit: Q1 ward hop Q2', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByRole('button', { name: 'Recover', exact: true }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  expect((await entries())[0].id).toBe(combo.id);
  const bundle = await harness.call('export_champion_notebook', {
    championId: 64,
    kind: null,
    search: '',
    opponentId: null,
    trash: false,
  });
  const imported = await harness.call('import_champion_notebook', {
    workspaceEpoch: await epoch(),
    json: JSON.stringify(bundle),
    commit: true,
    replacements: {},
  });
  expect(imported.duplicates).toBe(1);
  expect(
    (await harness.request.get('/bridge/stats').then((response) => response.json())).itemSetWrites,
  ).toBe(0);
  const backup = await harness.wait(await harness.call('create_backup', {}));
  await harness.wait(await harness.call('restore_backup', { id: backup.result!.reference }));
  await page.goto('about:blank');
  await harness.stop();
  await harness.start('no-client');
  expect((await entries())[0].content.steps[0].label).toBe('2');
  await page.goto('/#/notebooks?champion=64');
  await page.getByRole('tab', { name: 'Combos', exact: true }).click();
  await expect(page.locator('[data-ui~=combo-sequence]')).toBeVisible();
  await mkdir('.tmp/browser', { recursive: true });
  await page.screenshot({ path: '.tmp/browser/notebooks-combo.png' });
  const settings = await harness.call('get_settings', {});
  await harness.call('update_settings', {
    expectedRevision: settings.revision,
    patch: {
      languagePreference: 'zh-CN',
      themeId: null,
      colorModePreference: 'dark',
      sidebarCollapsed: null,
      closeBehavior: null,
      autoConnect: null,
      autoSync: null,
      syncPages: null,
      workspaceTabs: null,
      activeTab: null,
    },
  });
  await expect(page.getByRole('heading', { name: '英雄笔记', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '笔记', exact: true }).click();
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByRole('dialog').getByLabel('标题', { exact: true }).fill('河道视野');
  await page
    .getByRole('dialog')
    .getByLabel('内容', { exact: true })
    .fill('确认视野后选择入侵路线。');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '河道视野', exact: true })).toBeVisible();
  expect((await entries()).find((entry) => entry.content.title === '河道视野')?.content.text).toBe(
    '确认视野后选择入侵路线。',
  );
  await page.setViewportSize({ width: 800, height: 600 });
  await page.screenshot({ path: '.tmp/browser/notebooks-zh-dark.png' });
});
test('two builds export safe JSON and simulated client merges; quick reference and notebook import never write', async ({
  page,
}) => {
  const combo = blankNotebook(64, 'combo');
  combo.title = 'Ward hop';
  combo.text = 'Practice W1';
  combo.steps = [{ action: 'skill', entityId: 2, label: '1' }];
  const savedCombo = await save(combo);
  const matchup = blankNotebook(64, 'matchup');
  matchup.title = 'Against Ahri';
  matchup.text = 'Track charm cooldown';
  matchup.opponentId = 103;
  matchup.links = [{ entryId: savedCombo.id, revision: 1 }];
  await save(matchup);
  let chosen: NotebookEntry | undefined;
  for (const title of ['Jungle utility', 'Damage']) {
    const build = blankNotebook(64, 'build');
    build.title = title;
    build.text = 'Private conditions never exported';
    build.groups = [
      { name: 'Start', items: [{ id: 1001, count: 1 }] },
      { name: 'Core', items: [{ id: 1052, count: 2 }] },
    ];
    chosen = await save(build);
  }
  await harness.scenario({ scenario: 'tencent', livePhase: 'ChampSelect', championId: 64 });
  const exported = await harness.call('export_item_build', {
    entryId: chosen!.id,
    targetVersion: '16.20.1',
    mapId: 11,
  });
  expect(exported.issues).toEqual([]);
  const client = JSON.parse(exported.json);
  expect(client.associatedChampions).toEqual([64]);
  expect(client.associatedMaps).toEqual([11]);
  expect(client.blocks[1].items).toEqual([{ id: '1052', count: 2 }]);
  expect(exported.json).not.toContain('Private conditions');
  const request = {
    workspaceEpoch: await epoch(),
    entryId: chosen!.id,
    expectedRevision: 1,
    targetVersion: '16.20.1',
    mapId: 11,
    saveAsNew: false,
    overwriteRemote: false,
  };
  expect((await harness.call('apply_item_build', request)).state).toBe('applied');
  expect((await harness.call('apply_item_build', request)).state).toBe('applied');
  const stats = await harness.request.get('/bridge/stats').then((response) => response.json());
  expect(stats.itemSetWrites).toBe(1);
  expect(stats.itemSets.itemSets).toHaveLength(2);
  expect(stats.itemSets.itemSets[0]).toEqual({
    uid: 'client-original',
    title: 'Existing set',
    customField: 'preserve',
  });
  expect(stats.itemSets.unknown).toBe('preserve');
  await page.goto('/#/live');
  await page.getByRole('button', { name: 'Pre-game reference', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ward hop', exact: true })).toBeVisible();
  await harness.scenario({ scenario: 'tencent', livePhase: 'ChampSelect', championId: 103 });
  await expect(page.locator('[data-current=true]')).toContainText('Ahri');
  await expect(
    page.locator('[data-ui~=live-page]').getByText('Ward hop', { exact: true }),
  ).toHaveCount(0);
  const bundle = await harness.call('export_champion_notebook', {
    championId: 64,
    kind: null,
    search: '',
    opponentId: null,
    trash: false,
  });
  await harness.call('import_champion_notebook', {
    workspaceEpoch: await epoch(),
    json: JSON.stringify(bundle),
    commit: true,
    replacements: {},
  });
  expect(
    (await harness.request.get('/bridge/stats').then((response) => response.json())).itemSetWrites,
  ).toBe(1);
  await page.goto('/#/notebooks?champion=64');
  await page.getByRole('tab', { name: 'Builds', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Damage', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 800, height: 600 });
  await page.screenshot({ path: '.tmp/browser/notebooks-builds-800.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('selected preparation, cancellation, permission failures, progress and offline restore', async ({
  page,
}) => {
  const matches = await harness.call('list_matches', {
    playerKey,
    queueId: 420,
    championId: null,
    from: null,
    to: null,
    cursor: null,
    pageSize: 20,
  });
  const selected = matches.items.slice(0, 20).map((match) => match.matchKey);
  expect(selected).toHaveLength(20);
  const workspaceEpoch = await epoch();
  const request = {
    workspaceEpoch,
    playerKey,
    matchKeys: selected,
    batchId: null,
    recompute: false,
  };
  const preview = await harness.call('preview_match_preparation', request);
  expect(preview.members).toHaveLength(20);
  expect(
    preview.members.every((member) => member.details === 'required' || member.details === 'cached'),
  ).toBe(true);
  await harness.scenario({ scenario: 'tencent', delay: 80 });
  const start = Date.now();
  const batch = await harness.call('start_match_preparation', request);
  await harness.call('change_match_preparation', {
    workspaceEpoch,
    id: batch.id,
    action: 'cancel',
  });
  await expect
    .poll(
      async () =>
        (await harness.call('list_match_preparations', {})).find(
          (candidate) => candidate.id === batch.id,
        )?.state,
    )
    .toBe('cancelled');
  const cancelMs = Date.now() - start;
  await harness.scenario({ scenario: 'tencent', delay: 0 });
  await harness.call('change_match_preparation', {
    workspaceEpoch,
    id: batch.id,
    action: 'resume',
  });
  await expect
    .poll(
      async () =>
        (await harness.call('list_match_preparations', {})).find(
          (candidate) => candidate.id === batch.id,
        )?.state,
      { timeout: 30000 },
    )
    .toBe('completed');
  const batchMs = Date.now() - start;
  expect(batchMs).toBeLessThan(30000);
  expect(cancelMs).toBeLessThan(2000);
  const completed = (await harness.call('list_match_preparations', {}))[0];
  expect(completed.members.every((member) => member.reportId)).toBe(true);
  const target = completed.members[0];
  await page.goto(
    `/#/matches/${encodeURIComponent(target.matchKey)}/review?player=${encodeURIComponent(playerKey)}&report=${target.reportId}`,
  );
  await page.getByRole('tab', { name: 'Timeline & evidence', exact: true }).click();
  await expect(page.getByText('Event context', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Review overview', exact: true }).click();
  await expect(page.getByText('Personal history baseline', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 800, height: 600 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.tmp/browser/review-context-800.png' });
  const baseline = await harness.call('get_personal_baseline', {
    workspaceEpoch,
    reportId: target.reportId!,
    allChampions: false,
    refresh: false,
  });
  expect(baseline.metrics.every((metric) => metric.count <= 20)).toBe(true);
  expect(
    baseline.metrics
      .flatMap((metric) => metric.samples)
      .every((sample) => sample.matchKey !== target.matchKey),
  ).toBe(true);
  const backup = await harness.wait(await harness.call('create_backup', {}));
  await harness.wait(await harness.call('restore_backup', { id: backup.result!.reference }));
  expect(await epoch()).not.toBe(workspaceEpoch);
  await page.goto('about:blank');
  await harness.stop();
  await harness.start('no-client');
  const restored = await harness.call('get_review', { id: target.reportId! });
  expect(restored.id).toBe(target.reportId);
  expect((await harness.call('list_match_preparations', {}))[0].members).toHaveLength(20);
  expect(
    (await harness.request.get('/bridge/stats').then((response) => response.json())).detailsCalls,
  ).toBe(0);
  await writeFile(
    '.tmp/verification/preparation-performance.json',
    JSON.stringify(
      {
        matches: 20,
        batchMs,
        workflowMs: Date.now() - start,
        cancelMs,
        environment: 'macOS loopback simulation',
      },
      null,
      2,
    ),
  );
});
test('batch authorization errors stop remaining requests and restart requires explicit resume', async ({
  page,
}) => {
  const list = await harness.call('list_matches', {
    playerKey,
    queueId: 420,
    championId: null,
    from: null,
    to: null,
    cursor: null,
    pageSize: 10,
  });
  const workspaceEpoch = await epoch();
  for (const [index, status] of [403, 401, 429].entries()) {
    await harness.scenario({ scenario: 'tencent', status });
    const keys = list.items.slice(index * 2, index * 2 + 2).map((match) => match.matchKey);
    const batch = await harness.call('start_match_preparation', {
      workspaceEpoch,
      playerKey,
      matchKeys: keys,
      batchId: null,
      recompute: false,
    });
    await expect
      .poll(
        async () =>
          (await harness.call('list_match_preparations', {})).find(
            (candidate) => candidate.id === batch.id,
          )?.state,
      )
      .toBe('interrupted');
    const current = (await harness.call('list_match_preparations', {})).find(
      (candidate) => candidate.id === batch.id,
    )!;
    expect(current.members[0].error?.code).toBe(
      status === 403 ? 'FORBIDDEN' : status === 401 ? 'WAITING_AUTH' : 'RATE_LIMITED',
    );
    expect(current.members[1].reportId).toBeNull();
  }
  await harness.scenario({ scenario: 'riot' });
  await harness.scenario({ scenario: 'tencent', delay: 500 });
  const batch = await harness.call('start_match_preparation', {
    workspaceEpoch,
    playerKey,
    matchKeys: list.items.slice(6, 10).map((match) => match.matchKey),
    batchId: null,
    recompute: false,
  });
  await page.goto('about:blank');
  await harness.stop();
  await harness.start('tencent');
  const restarted = (await harness.call('list_match_preparations', {})).find(
    (candidate) => candidate.id === batch.id,
  )!;
  expect(restarted.state).toBe('interrupted');
  expect(
    (await harness.request.get('/bridge/stats').then((response) => response.json())).detailsCalls,
  ).toBe(0);
  await harness.call('change_match_preparation', {
    workspaceEpoch: await epoch(),
    id: batch.id,
    action: 'resume',
  });
  await expect
    .poll(
      async () =>
        (await harness.call('list_match_preparations', {})).find(
          (candidate) => candidate.id === batch.id,
        )?.state,
    )
    .toBe('completed');
});
