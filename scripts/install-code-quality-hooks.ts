import { chmod } from 'node:fs/promises';
import { runCodeQualityCommand } from './code-quality';

const repository = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], { stderr: 'pipe' });
if (repository.exitCode === 0) {
  const root = repository.stdout.toString().trim();
  const configuredHooks = Bun.spawnSync(['git', 'config', '--get', 'core.hooksPath'], {
    cwd: root,
  });
  const hooksPath = configuredHooks.stdout.toString().trim();
  if (hooksPath && hooksPath !== '.githooks') {
    throw new Error(`已有 core.hooksPath=${hooksPath}，请先合并现有 hooks，未覆盖配置。`);
  }
  await chmod(`${root}/.githooks/pre-commit`, 0o755);
  runCodeQualityCommand(root, ['git', 'config', '--local', 'core.hooksPath', '.githooks']);
  console.log('已安装提交前代码检查。');
}
