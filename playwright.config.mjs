import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    headless: true,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      PORT: '3002',
      WEB_PORT: '5174',
      API_PROXY_TARGET: 'http://127.0.0.1:3002',
      PUBLIC_URL: 'http://127.0.0.1:5174',
      DATABASE_PATH: `./data/e2e-${Date.now()}.sqlite`,
      ADMIN_PASSWORD: '',
    },
  },
  reporter: 'list',
});
