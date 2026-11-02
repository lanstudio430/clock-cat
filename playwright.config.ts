import { defineConfig } from '@playwright/test';

// 用電腦上已安裝的 Chrome，不另外下載瀏覽器
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/',
    channel: 'chrome',
    serviceWorkers: 'block',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile',
      testIgnore: /desktop\.spec\.ts/,
      use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    },
    {
      name: 'desktop',
      testMatch: /desktop\.spec\.ts/,
      use: { viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command: 'npm run build && npx vite preview',
    url: 'http://localhost:4173/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
