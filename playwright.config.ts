import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  use: {
    browserName: 'chromium',
    channel: 'chromium',
    baseURL: `http://localhost:${process.env.RIFTMIND_E2E_PORT || 1421}`,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
