import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const directory = resolve('.tmp/verification');
await mkdir(directory, { recursive: true });
const commands = [
  ['bun', 'run', 'check'],
  ['bun', 'run', 'test:unit'],
  ['cargo', 'test', '-p', 'riftmind-core', '--locked', '--', '--nocapture'],
  ['cargo', 'test', '-p', 'riftmind', '--locked'],
  ['cargo', 'fmt', '--all', '--check'],
  [
    'cargo',
    'clippy',
    '-p',
    'riftmind-core',
    '-p',
    'dev-harness',
    '--locked',
    '--',
    '-D',
    'warnings',
  ],
  ['bun', 'run', 'test:e2e'],
  ['bun', 'run', 'build'],
];
const results = [];
for (const command of commands) {
  const start = Date.now();
  const child = Bun.spawn(command, {
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      TMPDIR: directory,
      RIFTMIND_SCOUTING_PERF_REPORT: resolve(directory, 'scouting-perf'),
      RIFTMIND_STAGE2_PERF_REPORT: resolve(directory, 'review-perf.json'),
    },
  });
  const exitCode = await child.exited;
  results.push({ command: command.join(' '), exitCode, durationMs: Date.now() - start });
  if (exitCode) break;
}
await Bun.write(
  resolve(directory, 'review-training-report.json'),
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      results,
      clientItemSetAdapter: 'synthetic_http_and_trait_validation; real_client_gate_closed',
      nativeWindows: 'not_executed_per_mac_scope',
      nativeMacHost: 'not_added_per_mac_scope',
    },
    null,
    2,
  ) + '\n',
);
process.exit(results.some((result) => result.exitCode) ? 1 : 0);
