import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:3001', channel: 'chrome', headless: true, viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run start', url: 'http://127.0.0.1:3001/api/status', reuseExistingServer: false, timeout: 60000, env: { PORT: '3001', FENNLO_DATA_DIR: './data/browser-test', OPENAI_API_KEY: '', GEMINI_API_KEY: '', FENNLO_PROVIDER: 'development' } },
});
