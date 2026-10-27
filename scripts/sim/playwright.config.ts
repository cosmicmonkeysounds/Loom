// The browser companion's config (browser.spec.ts). Run through the
// editor's Playwright: `pnpm --filter loom-app exec playwright test -c ../scripts/sim/playwright.config.ts`.
import { defineConfig, devices } from "../../editor/node_modules/@playwright/test/index.mjs";

export default defineConfig({
  testDir: ".",
  testMatch: "browser.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
