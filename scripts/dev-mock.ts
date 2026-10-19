const child = Bun.spawn(['bun', 'run', 'dev'], {
  env: { ...process.env, VITE_TRANSPORT: 'fixture' },
  stdout: 'inherit',
  stderr: 'inherit',
});
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
process.exit(await child.exited);
