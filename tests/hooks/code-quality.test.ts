import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmod, cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dir, '../..');
let repositoryRoot: string;

function execute(command: string[]) {
  return Bun.spawnSync(command, {
    cwd: repositoryRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

function git(...argumentsList: string[]) {
  const result = execute(['git', ...argumentsList]);
  if (result.exitCode) throw new Error(result.stderr.toString());
  return result.stdout.toString();
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
