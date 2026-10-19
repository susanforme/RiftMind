import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { localTool, runCodeQualityCommand, sourceFingerprints } from './code-quality';

interface CodeQualityEvent {
  cwd: string;
  session_id: string;
  turn_id: string;
  hook_event_name: 'UserPromptSubmit' | 'Stop';
}

interface SourceBaseline {
  schemaVersion: 1;
  fingerprints: Record<string, string>;
}

async function checkAiTurn(event: CodeQualityEvent) {
  if (!event.session_id || !event.turn_id || !event.cwd) {
    throw new Error('AI code quality hook requires cwd, session_id and turn_id.');
  }
  const root = runCodeQualityCommand(event.cwd, ['git', 'rev-parse', '--show-toplevel']).trim();
  const stateDirectory = join(root, '.tmp', 'ai-code-quality');
  const stateKey = createHash('sha256')
    .update(`${event.session_id}:${event.turn_id}`)
    .digest('hex');
  const baselineFile = Bun.file(join(stateDirectory, `${stateKey}.json`));
  const fingerprints = await sourceFingerprints(root);
  if (event.hook_event_name === 'UserPromptSubmit') {
    // A continuation must not replace the original baseline and hide failed checks.
    if (!(await baselineFile.exists())) {
      await mkdir(stateDirectory, { recursive: true });
      const baseline: SourceBaseline = { schemaVersion: 1, fingerprints };
      await Bun.write(baselineFile, JSON.stringify(baseline));
    }
    return {};
  }
  if (!(await baselineFile.exists())) {
    return {
      systemMessage:
        '未找到本轮代码快照，未自动修改文件；请手动检查本次修改。新一轮对话将自动记录快照。',
    };
  }
  const savedBaseline: SourceBaseline = await baselineFile.json();
  // Older snapshots omit Rust; treating those omissions as additions would rewrite existing work.
  if (savedBaseline.schemaVersion !== 1 || !savedBaseline.fingerprints) {
    return {
      systemMessage:
        '本轮快照来自旧版 Hook，未自动修改文件；请手动检查本次修改，下一轮将记录完整快照。',
    };
  }
  const baseline = savedBaseline.fingerprints;
  const changedPaths = Object.keys(fingerprints).filter(
    (path) => fingerprints[path] !== baseline[path],
  );
  if (changedPaths.length === 0) return {};
  const rustPaths = changedPaths.filter((path) => path.endsWith('.rs'));
  const biomePaths = changedPaths.filter((path) => !path.endsWith('.rs'));
  const scriptPaths = biomePaths.filter((path) => !path.endsWith('.css'));
  if (scriptPaths.length) {
    runCodeQualityCommand(root, [
      ...localTool(root, 'eslint'),
      '--fix',
      '--no-warn-ignored',
      '--',
      ...scriptPaths,
    ]);
  }
  if (biomePaths.length) {
    runCodeQualityCommand(root, [
      ...localTool(root, 'biome'),
      'format',
      '--write',
      '--no-errors-on-unmatched',
      '--',
      ...biomePaths,
    ]);
    runCodeQualityCommand(root, [
      ...localTool(root, 'biome'),
      'format',
      '--no-errors-on-unmatched',
      '--',
      ...biomePaths,
    ]);
  }
  if (rustPaths.length) {
    // All project crates use edition 2024; avoid recursively rewriting untouched modules.
    const rustfmtArguments = ['--edition', '2024', '--config', 'skip_children=true'];
    runCodeQualityCommand(root, ['rustfmt', ...rustfmtArguments, ...rustPaths]);
    runCodeQualityCommand(root, ['rustfmt', '--check', ...rustfmtArguments, ...rustPaths]);
  }
  if (
    changedPaths.includes('src/lib/transport/fixture.ts') ||
    changedPaths.includes('crates/riftmind-core/src/clients/mod.rs')
  ) {
    runCodeQualityCommand(root, [process.execPath, 'scripts/fixture-manifest.ts', '--check']);
  }
  return {};
}

try {
  const event: CodeQualityEvent = await Bun.stdin.json();
  console.log(JSON.stringify(await checkAiTurn(event)));
} catch (error) {
  console.log(
    JSON.stringify({
      decision: 'block',
      reason: `请修复本轮代码质量问题后再结束任务，不要关闭规则或修改无关文件。\n${String(error).slice(-6000)}`,
    }),
  );
}
