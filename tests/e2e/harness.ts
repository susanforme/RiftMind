import { expect, type APIRequestContext } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandMap, Task } from '../../src/generated/contracts';
export class Harness {
  process?: ChildProcess;
  token = '';
  port = process.env.RIFTMIND_E2E_PORT || '1421';
  constructor(
    public root: string,
    public request: APIRequestContext,
  ) {}
  async start(scenario = 'tencent') {
    const ready = join(this.root, 'ready.json');
    await rm(ready, { force: true });
    this.process = spawn('bun', ['run', 'dev:integration'], {
      env: {
        ...process.env,
        RIFTMIND_TEST_DIR: this.root,
        RIFTMIND_DEV_PORT: this.port,
        RIFTMIND_ORIGIN: `http://localhost:${this.port}`,
        RIFTMIND_READY_FILE: ready,
        RIFTMIND_SCENARIO: scenario,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.process.stderr?.on('data', (data) => {
      void import('node:fs').then((fs) => fs.appendFileSync(join(this.root, 'core.log'), data));
    });
    await expect
      .poll(
        async () => {
          try {
            this.token = JSON.parse(await readFile(ready, 'utf8')).token;
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 120000 },
      )
      .toBe(true);
    await expect
      .poll(async () => {
        try {
          return (await fetch(`http://localhost:${this.port}`)).status;
        } catch {
          return 0;
        }
      })
      .toBe(200);
  }
  async stop() {
    const p = this.process;
    if (!p || p.exitCode != null) return;
    const exit = new Promise((resolve) => p.once('exit', resolve));
    p.kill('SIGINT');
    await exit;
    await expect
      .poll(async () => {
        try {
          await fetch(`http://localhost:${this.port}`);
          return false;
        } catch {
          return true;
        }
      })
      .toBe(true);
  }
  async call<K extends keyof CommandMap>(
    command: K,
    args: CommandMap[K]['input'],
  ): Promise<CommandMap[K]['output']> {
    const response = await this.request.post('/bridge/command', {
      headers: { 'x-riftmind-token': this.token },
      data: { command, args },
    });
    const body = await response.json();
    if (body.error) throw new Error(JSON.stringify(body.error));
    return body.ok;
  }
  async scenario(value: Record<string, unknown>) {
    await this.request.post('/bridge/scenario', {
      headers: { 'x-riftmind-token': this.token },
      data: value,
    });
  }
  async wait(task: Task) {
    let value = task;
    await expect
      .poll(async () => {
        value = await this.call('get_task_status', { id: task.id });
        return value.state;
      })
      .toMatch(/completed|cancelled|failed|interrupted/);
    if (value.state !== 'completed') throw new Error(JSON.stringify(value));
    return value;
  }
  async seedReviews(playerKey: string) {
    const page = await this.call('list_matches', {
      playerKey,
      queueId: 420,
      championId: null,
      from: null,
      to: null,
      cursor: null,
      pageSize: 5,
    });
    for (const m of page.items) {
      await this.wait(await this.call('fetch_match_details', { matchKey: m.matchKey, playerKey }));
      const data = await this.call('get_match_review_data', {
        matchKey: m.matchKey,
        playerKey,
        inputRevision: null,
        reportId: null,
      });
      await this.wait(
        await this.call('generate_review', {
          matchKey: m.matchKey,
          playerKey,
          inputRevision: data.latestInputRevision!,
        }),
      );
    }
    return page.items;
  }
}
