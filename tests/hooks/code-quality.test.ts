import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmod, cp, mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dir, '../..');
let repositoryRoot: string;

function execute(command: string[], stdin?: string) {
  return Bun.spawnSync(command, {
    cwd: repositoryRoot,
    stdin: stdin === undefined ? undefined : Buffer.from(stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

function git(...argumentsList: string[]) {
  const result = execute(['git', ...argumentsList]);
  if (result.exitCode) throw new Error(result.stderr.toString());
  return result.stdout.toString();
}

function aiHook(hookEventName: string, turnId = 'format-turn') {
  const result = execute(
    [process.execPath, join(projectRoot, 'scripts/ai-code-quality.ts')],
    JSON.stringify({
      cwd: repositoryRoot,
      session_id: 'format-session',
      turn_id: turnId,
      hook_event_name: hookEventName,
    }),
  );
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout.toString());
}

function stagedCheck() {
  return execute([process.execPath, join(projectRoot, 'scripts/check-staged-code.ts')]);
}

beforeEach(async () => {
  const testParent = join(projectRoot, '.tmp', 'code-quality-verification');
  await mkdir(testParent, { recursive: true });
  repositoryRoot = await mkdtemp(join(testParent, 'repository-'));
  git('init', '--quiet');
  await symlink(
    join(projectRoot, 'node_modules'),
    join(repositoryRoot, 'node_modules'),
    'junction',
  );
  await Bun.write(join(repositoryRoot, 'package.json'), '{"type":"module"}\n');
  await Bun.write(join(repositoryRoot, '.gitignore'), '.tmp/\nnode_modules/\n');
  for (const config of ['biome.json', 'eslint.config.js']) {
    await Bun.write(join(repositoryRoot, config), Bun.file(join(projectRoot, config)));
  }
  await mkdir(join(repositoryRoot, 'src'), { recursive: true });
  git('add', '.');
});

afterEach(async () => {
  await rm(repositoryRoot, { recursive: true, force: true });
});

test('AI completion formats new and previously dirty files changed in this turn only', async () => {
  const ongoingSource = 'export const ongoing={value:1}\n';
  await Bun.write(join(repositoryRoot, 'src/ongoing.ts'), ongoingSource);
  await Bun.write(join(repositoryRoot, 'src/edited.ts'), 'export const edited={value:1}\n');
  git('add', 'src');
  await Bun.write(join(repositoryRoot, 'src/edited.ts'), 'export const edited={value:2}\n');
  expect(aiHook('UserPromptSubmit')).toEqual({});
  await Bun.write(join(repositoryRoot, 'src/edited.ts'), 'export const edited={value:3}\n');
  await Bun.write(join(repositoryRoot, 'src/new file.ts'), 'export const created={value:4}\n');
  await Bun.write(join(repositoryRoot, 'src/generated/contracts.ts'), 'unformatted generated\n');
  expect(aiHook('Stop')).toEqual({});
  expect(await Bun.file(join(repositoryRoot, 'src/ongoing.ts')).text()).toBe(ongoingSource);
  expect(await Bun.file(join(repositoryRoot, 'src/edited.ts')).text()).toBe(
    'export const edited = { value: 3 };\n',
  );
  expect(await Bun.file(join(repositoryRoot, 'src/new file.ts')).text()).toBe(
    'export const created = { value: 4 };\n',
  );
  expect(await Bun.file(join(repositoryRoot, 'src/generated/contracts.ts')).text()).toBe(
    'unformatted generated\n',
  );
  expect(git('show', ':src/edited.ts')).toBe('export const edited={value:1}\n');
});

test('AI completion blocks lint failures and preserves the baseline on retries', async () => {
  aiHook('UserPromptSubmit');
  await Bun.write(
    join(repositoryRoot, 'src/broken.ts'),
    'const unusedValue = 1;\nexport const broken = 1;\n',
  );
  expect(aiHook('Stop').decision).toBe('block');
  aiHook('UserPromptSubmit');
  expect(aiHook('Stop').decision).toBe('block');
  await Bun.write(join(repositoryRoot, 'src/broken.ts'), 'export const repaired=1\n');
  expect(aiHook('Stop')).toEqual({});
  expect(await Bun.file(join(repositoryRoot, 'src/broken.ts')).text()).toBe(
    'export const repaired = 1;\n',
  );
});

test('missing snapshots warn without formatting the existing workspace', async () => {
  const ongoingSource = 'export const ongoing={value:1}\n';
  await Bun.write(join(repositoryRoot, 'src/ongoing.ts'), ongoingSource);
  expect(aiHook('Stop').systemMessage).toContain('未找到本轮代码快照');
  expect(await Bun.file(join(repositoryRoot, 'src/ongoing.ts')).text()).toBe(ongoingSource);
});

test('AI completion formats changed CSS and Tailwind directives while preserving earlier CSS work', async () => {
  const ongoingStyles = '.ongoing{color:red}\n';
  await Bun.write(join(repositoryRoot, 'src/ongoing.css'), ongoingStyles);
  await Bun.write(join(repositoryRoot, 'src/champion.module.css'), '.champion{color:red}\n');
  git('add', 'src');
  expect(aiHook('UserPromptSubmit')).toEqual({});
  await Bun.write(join(repositoryRoot, 'src/champion.module.css'), '.champion{color:blue}\n');
  await Bun.write(
    join(repositoryRoot, 'src/theme.css'),
    '@theme inline{--color-background:var(--background);}\n',
  );
  expect(aiHook('Stop')).toEqual({});
  expect(await Bun.file(join(repositoryRoot, 'src/champion.module.css')).text()).toBe(
    '.champion {\n  color: blue;\n}\n',
  );
  expect(await Bun.file(join(repositoryRoot, 'src/theme.css')).text()).toBe(
    '@theme inline {\n  --color-background: var(--background);\n}\n',
  );
  expect(await Bun.file(join(repositoryRoot, 'src/ongoing.css')).text()).toBe(ongoingStyles);
});

test('CSS-only staged checks reject unformatted styles and preserve unstaged CSS', async () => {
  git(
    '-c',
    'user.name=Code Quality Verification',
    '-c',
    'user.email=code-quality@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'Record formatter configuration',
  );
  const stylesheetPath = join(repositoryRoot, 'src/champion.module.css');
  const unformattedStyles = '.champion{color:red}\n';
  await Bun.write(stylesheetPath, unformattedStyles);
  git('add', 'src');
  const rejected = stagedCheck();
  expect(rejected.exitCode).not.toBe(0);
  expect(rejected.stderr.toString()).toContain('champion.module.css');
  expect(await Bun.file(stylesheetPath).text()).toBe(unformattedStyles);
  const formattedStyles = '.champion {\n  color: red;\n}\n';
  await Bun.write(stylesheetPath, formattedStyles);
  git('add', 'src');
  await Bun.write(stylesheetPath, '.champion{color:blue}\n');
  const accepted = stagedCheck();
  expect(accepted.exitCode).toBe(0);
  expect(accepted.stderr.toString()).toBe('');
  expect(await Bun.file(stylesheetPath).text()).toBe('.champion{color:blue}\n');
  expect(git('show', ':src/champion.module.css')).toBe(formattedStyles);
});

test('staged checks reject unformatted index content even when the working file is formatted', async () => {
  await Bun.write(join(repositoryRoot, 'src/partially staged.ts'), 'export const staged=1\n');
  git('add', 'src');
  await Bun.write(join(repositoryRoot, 'src/partially staged.ts'), 'export const staged = 1;\n');
  const indexBefore = git('write-tree');
  expect(stagedCheck().exitCode).not.toBe(0);
  expect(git('write-tree')).toBe(indexBefore);
  expect(await Bun.file(join(repositoryRoot, 'src/partially staged.ts')).text()).toBe(
    'export const staged = 1;\n',
  );
});

test('staged checks accept clean index content and ignore unfinished working files', async () => {
  await Bun.write(join(repositoryRoot, 'src/partially staged.ts'), 'export const staged = 1;\n');
  git('add', 'src');
  const ongoingSource = 'export const unfinished = missingValue\n';
  await Bun.write(join(repositoryRoot, 'src/partially staged.ts'), ongoingSource);
  const result = stagedCheck();
  expect(result.stderr.toString()).toBe('');
  expect(result.exitCode).toBe(0);
  expect(await Bun.file(join(repositoryRoot, 'src/partially staged.ts')).text()).toBe(
    ongoingSource,
  );
});

test('staged checks use the staged ESLint configuration', async () => {
  await Bun.write(
    join(repositoryRoot, 'src/lint-error.ts'),
    'const unusedValue = 1;\nexport const value = 1;\n',
  );
  git('add', 'src');
  await Bun.write(join(repositoryRoot, 'eslint.config.js'), 'export default [];\n');
  const result = stagedCheck();
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain('unusedValue');
});

test('installed pre-commit blocks a real commit and accepts it after formatting', async () => {
  await Bun.write(
    join(repositoryRoot, 'package.json'),
    JSON.stringify({
      type: 'module',
      scripts: { 'check:staged': `bun "${join(projectRoot, 'scripts/check-staged-code.ts')}"` },
    }),
  );
  await Bun.write(
    join(repositoryRoot, '.githooks/pre-commit'),
    Bun.file(join(projectRoot, '.githooks/pre-commit')),
  );
  await chmod(join(repositoryRoot, '.githooks/pre-commit'), 0o755);
  const install = execute([
    process.execPath,
    join(projectRoot, 'scripts/install-code-quality-hooks.ts'),
  ]);
  expect(install.exitCode).toBe(0);
  expect(git('config', '--get', 'core.hooksPath').trim()).toBe('.githooks');
  await Bun.write(join(repositoryRoot, 'src/commit.ts'), 'export const committed=1\n');
  git('add', '.');
  const commit = () =>
    execute([
      'git',
      '-c',
      'user.name=Code Quality Verification',
      '-c',
      'user.email=code-quality@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'Verify commit checks',
    ]);
  expect(commit().exitCode).not.toBe(0);
  await Bun.write(join(repositoryRoot, 'src/commit.ts'), 'export const committed = 1;\n');
  git('add', 'src/commit.ts');
  const result = commit();
  expect(result.exitCode).toBe(0);
});

test('installation preserves an existing custom hooks directory', () => {
  git('config', '--local', 'core.hooksPath', '.existing-hooks');
  const install = execute([
    process.execPath,
    join(projectRoot, 'scripts/install-code-quality-hooks.ts'),
  ]);
  expect(install.exitCode).not.toBe(0);
  expect(git('config', '--get', 'core.hooksPath').trim()).toBe('.existing-hooks');
});

test('staged Rust format checks reject an unformatted crate without touching working files', async () => {
  await Bun.write(
    join(repositoryRoot, 'Cargo.toml'),
    '[workspace]\n\n[package]\nname = "code-quality-verification"\nversion = "0.1.0"\nedition = "2021"\n',
  );
  await Bun.write(join(repositoryRoot, 'src/lib.rs'), 'pub fn champion_id()->u32{1}\n');
  git('add', 'Cargo.toml', 'src/lib.rs');
  expect(stagedCheck().exitCode).not.toBe(0);
  const formattedSource = 'pub fn champion_id() -> u32 {\n    1\n}\n';
  await Bun.write(join(repositoryRoot, 'src/lib.rs'), formattedSource);
  git('add', 'src/lib.rs');
  const result = stagedCheck();
  expect(result.stderr.toString()).toBe('');
  expect(result.exitCode).toBe(0);
  expect(await Bun.file(join(repositoryRoot, 'src/lib.rs')).text()).toBe(formattedSource);
});

test('AI completion formats changed and new Rust files without rewriting untouched modules', async () => {
  const ongoingRust = 'pub fn champion_name()->u32{1}\n';
  await Bun.write(join(repositoryRoot, 'src/champion.rs'), ongoingRust);
  await Bun.write(join(repositoryRoot, 'src/lib.rs'), 'mod champion;\n');
  git('add', 'src');
  expect(aiHook('UserPromptSubmit')).toEqual({});
  await Bun.write(
    join(repositoryRoot, 'src/lib.rs'),
    'mod champion;\npub async fn champion_id()->u32{1}\n',
  );
  await Bun.write(join(repositoryRoot, 'src/champion_build.rs'), 'pub fn item_id()->u32{2}\n');
  expect(aiHook('Stop')).toEqual({});
  expect(await Bun.file(join(repositoryRoot, 'src/lib.rs')).text()).toContain(
    'pub async fn champion_id() -> u32 {\n    1\n}',
  );
  expect(await Bun.file(join(repositoryRoot, 'src/champion_build.rs')).text()).toBe(
    'pub fn item_id() -> u32 {\n    2\n}\n',
  );
  expect(await Bun.file(join(repositoryRoot, 'src/champion.rs')).text()).toBe(ongoingRust);
  expect(git('show', ':src/lib.rs')).toBe('mod champion;\n');
});

test('AI completion formats Rust, CSS and TypeScript together', async () => {
  expect(aiHook('UserPromptSubmit')).toEqual({});
  await Bun.write(join(repositoryRoot, 'src/champion.rs'), 'pub fn champion_id()->u32{1}\n');
  await Bun.write(join(repositoryRoot, 'src/champion.ts'), 'export const championId=1\n');
  await Bun.write(join(repositoryRoot, 'src/champion.css'), '.champion{color:red}\n');
  expect(aiHook('Stop')).toEqual({});
  expect(await Bun.file(join(repositoryRoot, 'src/champion.rs')).text()).toBe(
    'pub fn champion_id() -> u32 {\n    1\n}\n',
  );
  expect(await Bun.file(join(repositoryRoot, 'src/champion.ts')).text()).toBe(
    'export const championId = 1;\n',
  );
  expect(await Bun.file(join(repositoryRoot, 'src/champion.css')).text()).toBe(
    '.champion {\n  color: red;\n}\n',
  );
});

test('AI completion blocks when Rust syntax cannot be formatted', async () => {
  expect(aiHook('UserPromptSubmit')).toEqual({});
  const invalidRust = 'pub fn champion_id(\n';
  await Bun.write(join(repositoryRoot, 'src/champion.rs'), invalidRust);
  const result = aiHook('Stop');
  expect(result.decision).toBe('block');
  expect(result.reason).toContain('rustfmt');
  expect(await Bun.file(join(repositoryRoot, 'src/champion.rs')).text()).toBe(invalidRust);
});

test('older snapshots without Rust fingerprints never trigger workspace-wide Rust formatting', async () => {
  const ongoingRust = 'pub fn champion_id()->u32{1}\n';
  await Bun.write(join(repositoryRoot, 'src/champion.rs'), ongoingRust);
  expect(aiHook('UserPromptSubmit')).toEqual({});
  const snapshotDirectory = join(repositoryRoot, '.tmp/ai-code-quality');
  const [snapshotName] = await readdir(snapshotDirectory);
  await Bun.write(join(snapshotDirectory, snapshotName), '{}');
  expect(aiHook('Stop').systemMessage).toContain('旧版 Hook');
  expect(await Bun.file(join(repositoryRoot, 'src/champion.rs')).text()).toBe(ongoingRust);
});

test('staged fixture checks reject stale hashes and accept a refreshed manifest', async () => {
  await cp(join(projectRoot, 'tests/fixtures'), join(repositoryRoot, 'tests/fixtures'), {
    recursive: true,
  });
  for (const path of [
    'scripts/fixture-manifest.ts',
    'crates/riftmind-core/src/clients/mod.rs',
    'crates/riftmind-core/src/domain/servers.json',
    'src/lib/transport/fixture.ts',
  ]) {
    await Bun.write(join(repositoryRoot, path), Bun.file(join(projectRoot, path)));
  }
  const manifestCommand = [process.execPath, 'scripts/fixture-manifest.ts'];
  expect(execute(manifestCommand).exitCode).toBe(0);
  git('add', '.');
  // Establish a clean index so only the changed fixture triggers this check.
  git(
    '-c',
    'user.name=Code Quality Verification',
    '-c',
    'user.email=code-quality@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'Record fixture baseline',
  );
  const fixturePath = 'tests/fixtures/review/expected.json';
  await Bun.write(
    join(repositoryRoot, fixturePath),
    `${await Bun.file(join(repositoryRoot, fixturePath)).text()}\n`,
  );
  git('add', fixturePath);
  expect(stagedCheck().exitCode).not.toBe(0);
  expect(execute(manifestCommand).exitCode).toBe(0);
  git('add', 'tests/fixtures/manifest.json');
  const result = stagedCheck();
  expect(result.exitCode).toBe(0);
});

test('the configured AI command works when invoked from a repository subdirectory', async () => {
  for (const path of ['scripts/ai-code-quality.ts', 'scripts/code-quality.ts']) {
    await Bun.write(join(repositoryRoot, path), Bun.file(join(projectRoot, path)));
  }
  const configuration = await Bun.file(join(projectRoot, '.codex/hooks.json')).json();
  const command = configuration.hooks.UserPromptSubmit[0].hooks[0].command;
  expect(configuration.hooks.Stop[0].hooks[0].command).toBe(command);
  const event = {
    cwd: join(repositoryRoot, 'src'),
    session_id: 'configured-command',
    turn_id: 'configured-turn',
    hook_event_name: 'UserPromptSubmit',
  };
  function configuredHook() {
    const result = Bun.spawnSync(['sh', '-c', command], {
      cwd: event.cwd,
      stdin: Buffer.from(JSON.stringify(event)),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(result.exitCode).toBe(0);
    return JSON.parse(result.stdout.toString());
  }
  expect(configuredHook()).toEqual({});
  await Bun.write(join(repositoryRoot, 'src/configured.ts'), 'export const configured=1\n');
  event.hook_event_name = 'Stop';
  expect(configuredHook()).toEqual({});
  expect(await Bun.file(join(repositoryRoot, 'src/configured.ts')).text()).toBe(
    'export const configured = 1;\n',
  );
});
