import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 90000,
  retries: 1,
  workers: 2,
  use: {
    baseURL: 'https://garten.infinityspace42.de',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  reporter: [['list'], ['html', { open: 'never' }]],
});
