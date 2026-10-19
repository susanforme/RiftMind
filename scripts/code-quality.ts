import { resolve } from 'node:path';

export function runCodeQualityCommand(root: string, command: string[]) {
  const result = Bun.spawnSync(command, { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(' ')}\n${result.stdout.toString()}${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

export function gitFiles(root: string, argumentsList: string[]) {
  return runCodeQualityCommand(root, ['git', ...argumentsList, '-z'])
    .split('\0')
    .filter(Boolean);
}

export function isFormattedSource(path: string) {
  return (
    /\.(?:[cm]?[jt]s|[jt]sx|css|rs)$/.test(path) &&
    !path.split('/').includes('.agents') &&
    !path.startsWith('src/generated/')
  );
}

export function localTool(root: string, tool: 'eslint' | 'biome') {
  return [
    process.execPath,
    resolve(
      root,
      'node_modules',
      tool === 'eslint' ? 'eslint/bin/eslint.js' : '@biomejs/biome/bin/biome',
    ),
  ];
}
