// The live-stack e2e: runs against a REAL event server (`pnpm --filter
// @loom/core serve`, on the local `loom_dev` Postgres) proxied by the
// editor dev server on :5173. Not part of `test:e2e` (which needs no
// backend). Run: `pnpm --filter loom-app test:e2e:live`.
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e-live',
  fullyParallel: false,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5173', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
