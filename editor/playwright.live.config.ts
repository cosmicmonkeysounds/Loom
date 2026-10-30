// The live-stack e2e: runs against a REAL event server (`pnpm --filter
// @loom/core serve`, on the local `loom_dev` Postgres) proxied by the
// editor dev server on :5173. Not part of `test:e2e` (which needs no
// backend). Run: `pnpm --filter loom-app test:e2e:live`. `LOOM_E2E_BASE`
// points the suite at an editor you started yourself (a scratch stack).
import { defineConfig, devices } from '@playwright/test'

const base = process.env.LOOM_E2E_BASE

export default defineConfig({
  testDir: './e2e-live',
  fullyParallel: false,
  reporter: 'list',
  use: { baseURL: base ?? 'http://localhost:5173', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(base !== undefined
    ? {}
    : {
        webServer: {
          command: 'pnpm dev --port 5173 --strictPort',
          url: 'http://localhost:5173',
          reuseExistingServer: true,
          timeout: 60_000,
        },
      }),
})
