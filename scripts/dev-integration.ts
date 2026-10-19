import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const directory =
  process.env.RIFTMIND_TEST_DIR || join(import.meta.dir, '../.riftmind-dev/workspace');
const assetDirectory = process.env.RIFTMIND_TEST_DIR
  ? join(directory, 'assets')
  : join(import.meta.dir, '../.riftmind-dev/assets');
await mkdir(directory, { recursive: true });
const harness = spawn('cargo', ['run', '--locked', '-p', 'dev-harness'], {
  env: { ...process.env, RIFTMIND_TEST_DIR: directory, RIFTMIND_ASSET_DIR: assetDirectory },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let vite: ReturnType<typeof spawn> | undefined;
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  vite?.kill('SIGTERM');
  harness.kill('SIGINT');
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', stop);
harness.on('exit', (code) => {
  if (!stopping) {
    stop();
    process.exitCode = code || 1;
  }
});
for await (const line of createInterface({ input: harness.stdout! })) {
  if (!line.startsWith('{')) continue;
  const info = JSON.parse(line) as { port: number; token: string; directory: string };
  // Kept outside the product output; used by isolated E2E workers and manual diagnostics.
  if (process.env.RIFTMIND_READY_FILE)
    await writeFile(process.env.RIFTMIND_READY_FILE, JSON.stringify(info));
  vite = spawn('bun', ['run', 'dev'], {
    env: {
      ...process.env,
      VITE_TRANSPORT: 'dev-harness',
      VITE_INITIAL_SCENARIO: process.env.RIFTMIND_SCENARIO || 'no-client',
      VITE_HARNESS_TOKEN: info.token,
      RIFTMIND_HARNESS_PORT: String(info.port),
    },
    stdio: 'inherit',
  });
  vite.on('exit', (code) => {
    stop();
    process.exitCode = code || 0;
  });
  console.log(`Integration workspace: ${directory}`);
  break;
}
