// The simulator's optional browser companion: while `evening.ts` plays the
// night, three real pages watch it (the director phone, the server-room
// heart terminal and the TV), and each beat lands as screenshots.
//
//   # terminal 1 (build play + terminal first: the server serves them)
//   SIM_BASE=http://127.0.0.1:7391 SIM_MOD_CODE=<mod> SIM_BEAT_FILE=/tmp/beat.json \
//     SIM_SHOTS=/tmp/sim-shots pnpm --filter loom-app exec playwright test -c ../scripts/sim/playwright.config.ts
//   # terminal 2
//   node --experimental-strip-types scripts/sim/evening.ts --base … --code … --beat-file /tmp/beat.json --pace 1500
//
// It never joins as a guest (a phone that registers would sit on the roster
// and in the head counts): the bots are the guests. Rehearsal servers only;
// the codes stay in the environment, never in a screenshot's name.
//
// `@playwright/test` is the editor's (pnpm keeps it there); the runner and
// this file share that one install through the editor's path.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../../editor/node_modules/@playwright/test/index.mjs";

const BASE = (process.env["SIM_BASE"] ?? "").replace(/\/$/u, "");
const MOD = process.env["SIM_MOD_CODE"] ?? "";
const BEAT_FILE = process.env["SIM_BEAT_FILE"] ?? "";
const SHOTS = process.env["SIM_SHOTS"] ?? "test-results/sim";
const MINUTES = Number(process.env["SIM_MINUTES"] ?? "20");

function beatNow(): { n: number; beat: string; done?: boolean } | null {
  try {
    return JSON.parse(readFileSync(BEAT_FILE, "utf8")) as { n: number; beat: string; done?: boolean };
  } catch {
    return null;
  }
}
const slug = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/gu, "").toLowerCase().slice(0, 48);

test("watch a simulated evening: director, heart terminal, TV", async ({ browser }) => {
  test.skip(BASE === "" || MOD === "" || BEAT_FILE === "", "set SIM_BASE, SIM_MOD_CODE and SIM_BEAT_FILE");
  test.setTimeout(MINUTES * 60_000);
  mkdirSync(SHOTS, { recursive: true });
  const code = encodeURIComponent(MOD);
  const pages = {
    director: { url: `${BASE}/?code=${code}&role=director`, size: { width: 430, height: 932 } },
    heart: { url: `${BASE}/terminal/?code=${code}&room=The%20Server%20Room&spot=server-room&door=off&keys=1&cam=0`, size: { width: 1280, height: 800 } },
    tv: { url: `${BASE}/terminal/?code=${code}&view=tv&cam=0`, size: { width: 1280, height: 720 } },
  };
  const open = await Promise.all(
    Object.entries(pages).map(async ([name, p]) => {
      const ctx = await browser.newContext({ viewport: p.size });
      const page = await ctx.newPage();
      await page.goto(p.url);
      // The director phone asks a name for its log, then signs in.
      if (name === "director") {
        const who = page.getByPlaceholder(/your name/iu);
        if (await who.isVisible({ timeout: 5000 }).catch(() => false)) {
          await who.fill("Sim watcher");
          await page.getByRole("button", { name: /sign in/iu }).click();
        }
      }
      return { name, page };
    }),
  );
  for (const { page } of open) await expect(page.locator("body")).toBeVisible();
  let last = -1;
  const deadline = Date.now() + MINUTES * 60_000;
  while (Date.now() < deadline) {
    const b = beatNow();
    if (b !== null && b.n !== last) {
      last = b.n;
      await new Promise((r) => setTimeout(r, 700)); // let the screens settle
      for (const { name, page } of open) await page.screenshot({ path: join(SHOTS, `${String(b.n).padStart(2, "0")}-${slug(b.beat)}-${name}.png`) });
      if (b.done === true) break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  expect(last, "the evening never wrote a beat").toBeGreaterThan(0);
});
