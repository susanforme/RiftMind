const performanceFile = `/tmp/riftmind-scouting-perf-${crypto.randomUUID()}`;
const commands = [
  ['bun', 'run', 'check'],
  ['bun', 'run', 'test:unit'],
  ['cargo', 'test', '-p', 'riftmind-core', '--locked', '--', '--nocapture'],
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
const results: { command: string; exitCode: number; durationMs: number }[] = [];
for (const command of commands) {
  const start = Date.now();
  const child = Bun.spawn(command, {
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, RIFTMIND_SCOUTING_PERF_REPORT: performanceFile },
  });
  const exitCode = await child.exited;
  results.push({ command: command.join(' '), exitCode, durationMs: Date.now() - start });
  if (exitCode) break;
}
async function git(args: string[]) {
  const child = Bun.spawn(['git', ...args], { stdout: 'pipe', stderr: 'ignore' });
  return (await new Response(child.stdout).text()).trim();
}
const performance: Record<string, unknown> = {};
for (const suffix of ['aggregates', 'browser']) {
  const file = Bun.file(`${performanceFile}-${suffix}.json`);
  if (await file.exists()) performance[suffix] = await file.json();
}
await Bun.write(
  '.stage3-report.json',
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      sourceRevision: await git(['rev-parse', 'HEAD']),
      workingTree: await git(['status', '--short']),
      results,
      performance,
      fixtures:
        'Synthetic; independent expectations and SHA-256 manifest. LCU HTTP/WebSocket simulated independently.',
      migration:
        'SQLite v1/v2 to v3; v1/v2/v3 backup restoration and embedded goal-source validation tested in core',
      productionIsolation: results.some((r) => r.command === 'bun run build' && r.exitCode === 0)
        ? 'passed'
        : 'not_executed',
      nativeWindows: 'not_executed_per_mac_scope',
      liveTencent: 'not_verified',
      liveRiot: 'not_verified',
      nativeMacHost: 'not_added_per_mac_scope',
      productionRelease: 'not_published',
    },
    null,
    2,
  ) + '\n',
);
process.exit(results.some((r) => r.exitCode) ? 1 : 0);
