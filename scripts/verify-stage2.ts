const performanceFile = `/tmp/riftmind-stage2-perf-${crypto.randomUUID()}.json`;
const commands = [
  ['bun', 'run', 'check'], ['bun', 'run', 'test:unit'],
  ['cargo', 'test', '-p', 'riftmind-core', '--locked', '--', '--nocapture'],
  ['cargo', 'fmt', '--all', '--check'],
  ['cargo', 'clippy', '-p', 'riftmind-core', '-p', 'dev-harness', '--locked', '--', '-D', 'warnings'],
  ['bun', 'run', 'test:e2e'], ['bun', 'run', 'build'],
];
const results: { command: string; exitCode: number; durationMs: number }[] = [];
for (const command of commands) { const start = Date.now(); const child = Bun.spawn(command, { stdout: 'inherit', stderr: 'inherit', env: { ...process.env, RIFTMIND_PERF_REPORT: performanceFile } }); const code = await child.exited; results.push({ command: command.join(' '), exitCode: code, durationMs: Date.now() - start }); if (code) break; }
const revision = Bun.spawn(['git', 'rev-parse', 'HEAD'], { stdout: 'pipe', stderr: 'ignore' });
await Bun.write('.stage2-report.json', JSON.stringify({ timestamp: new Date().toISOString(), platform: process.platform, arch: process.arch, sourceRevision: (await new Response(revision.stdout).text()).trim(), workingTree: 'includes uncommitted Stage 1 and Stage 2 changes', results, performance: await Bun.file(performanceFile).exists() ? await Bun.file(performanceFile).json() : null, fixtures: 'synthetic; manual expected metrics and SHA-256 manifest checked by check/core tests', migration: 'real SQLite v1 to v2 and v1/v2 backup validation in core tests', productionIsolation: results.some(r => r.command === 'bun run build' && r.exitCode === 0) ? 'passed' : 'not_executed', windowsCI: 'not_executed', nativeWindows: 'not_executed', liveTencent: 'not_verified', liveRiot: 'not_verified', productionRelease: 'not_configured' }, null, 2) + '\n');
process.exit(results.some(r => r.exitCode) ? 1 : 0);
