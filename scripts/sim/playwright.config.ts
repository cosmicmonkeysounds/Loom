// The browser specs' config: the evening's companion (browser.spec.ts) and
// the heart terminal (heart.spec.ts). Run through the
// editor's Playwright: `pnpm --filter loom-app exec playwright test -c ../scripts/sim/playwright.config.ts`.
import { defineConfig, devices } from "../../editor/node_modules/@playwright/test/index.mjs";

export default defineConfig({
  testDir: ".",
  testMatch: ["ads.spec.ts", "browser.spec.ts", "handover.spec.ts", "heart.spec.ts", "photos.spec.ts", "prompter.spec.ts"],
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
