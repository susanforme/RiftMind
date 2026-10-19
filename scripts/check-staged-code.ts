import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { gitFiles, isFormattedSource, localTool, runCodeQualityCommand } from './code-quality';

const root = runCodeQualityCommand(process.cwd(), ['git', 'rev-parse', '--show-toplevel']).trim();
const stagedPaths = gitFiles(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
const sourcePaths = stagedPaths.filter(isFormattedSource);
const biomePaths = sourcePaths.filter((path) => !path.endsWith('.rs'));
const hasRustChanges = sourcePaths.some((path) => path.endsWith('.rs'));
const hasFixtureChanges = stagedPaths.some(
  (path) =>
    path.startsWith('tests/fixtures/') ||
    path === 'src/lib/transport/fixture.ts' ||
    path === 'crates/riftmind-core/src/clients/mod.rs',
);
if (sourcePaths.length || hasFixtureChanges) {
  const snapshotParent = join(root, '.tmp', 'staged-code-quality');
  mkdirSync(snapshotParent, { recursive: true });
  const snapshotRoot = await mkdtemp(join(snapshotParent, 'index-'));
  try {
    // Check the index without stashing or changing partially staged working files.
    runCodeQualityCommand(root, [
      'git',
      'checkout-index',
      '--all',
      `--prefix=${snapshotRoot.replaceAll('\\', '/')}/`,
    ]);
    if (biomePaths.length) {
      const scriptPaths = biomePaths.filter((path) => !path.endsWith('.css'));
      if (scriptPaths.length) {
        runCodeQualityCommand(snapshotRoot, [
          ...localTool(root, 'eslint'),
          '--no-warn-ignored',
          '--',
          ...scriptPaths,
        ]);
      }
      runCodeQualityCommand(snapshotRoot, [
        ...localTool(root, 'biome'),
        'format',
        '--vcs-enabled=false',
        '--no-errors-on-unmatched',
        '--',
        ...biomePaths,
      ]);
    }
    if (hasRustChanges) {
      runCodeQualityCommand(snapshotRoot, ['cargo', 'fmt', '--all', '--check']);
    }
    if (hasFixtureChanges) {
      runCodeQualityCommand(snapshotRoot, [
        process.execPath,
        'scripts/fixture-manifest.ts',
        '--check',
      ]);
    }
  } finally {
    await rm(snapshotRoot, { recursive: true, force: true });
  }
}
