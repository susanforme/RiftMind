const commands = [
  ['bun', 'run', 'check'],
  ['bun', 'run', 'test:unit'],
  ['cargo', 'test', '-p', 'riftmind-core', '--locked', '--', '--nocapture'],
  ['bun', 'run', 'test:e2e'],
  ['bun', 'run', 'build'],
  ['bun', 'run', 'check:production'],
];
const results = [];
for (const command of commands) {
  const started = Date.now();
  const child = Bun.spawn(command, { stdout: 'inherit', stderr: 'inherit' });
  const code = await child.exited;
  results.push({ command: command.join(' '), exitCode: code, durationMs: Date.now() - started });
  if (code) break;
}
await Bun.write(
  '.stage1-report.json',
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      results,
      windowsCI: 'not_executed',
      liveClient: 'not_verified',
      productionRelease: 'not_configured',
    },
    null,
    2,
  ),
);
process.exit(results.some((r) => r.exitCode) ? 1 : 0);
