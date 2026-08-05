import { defineConfig } from '@playwright/test';

// Keep verification isolated from the normal dev (:5173) and production (:4173) servers.
const port = 43173;
const loopbackNoProxy = '127.0.0.1,localhost';
process.env.NO_PROXY = [process.env.NO_PROXY, loopbackNoProxy].filter(Boolean).join(',');
process.env.no_proxy = [process.env.no_proxy, loopbackNoProxy].filter(Boolean).join(',');

export default defineConfig({
  testDir: './tests',
  testMatch: ['e2e/**/*.spec.ts', 'canvas/**/*.spec.ts'],
  outputDir: './output/playwright',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { outputFolder: 'output/playwright-report', open: 'never' }]] : 'line',
  // Windows cold-start compilation can cross 30s when Mermaid/Office renderers are first loaded.
  timeout: 60_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
