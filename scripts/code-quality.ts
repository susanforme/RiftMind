import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
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

export async function sourceFingerprints(root: string) {
  const fingerprints: Record<string, string> = {};
  const paths = gitFiles(root, ['ls-files', '--cached', '--others', '--exclude-standard']);
  for (const path of new Set(paths.filter(isFormattedSource))) {
    const absolutePath = resolve(root, path);
    // Never follow a tracked symlink into another checkout or outside the repository.
    if (!lstatSync(absolutePath, { throwIfNoEntry: false })?.isFile()) continue;
    fingerprints[path] = createHash('sha256')
      .update(Buffer.from(await Bun.file(absolutePath).arrayBuffer()))
      .digest('hex');
  }
  return fingerprints;
}
