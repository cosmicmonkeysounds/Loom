// The shared teleprompter (wave 59), on real pages: Clippy's phone, a host's
// phone and the real TV terminal against a scratch server. It plays `Second
// Hunt`, the show's first beat where her lines and his alternate.
//
//   # a scratch server on a free port (scripts/sim/README.md), play + terminal built
//   SIM_BASE=http://127.0.0.1:7105 SIM_MOD_CODE=<mod> SIM_PRIME_CODE=<prime> SIM_SHOTS=<dir> \
//     pnpm --filter loom-app exec playwright test -c ../scripts/sim/playwright.config.ts prompter
//
// The codes stay in the environment, never in a screenshot's name. Rehearsal
// servers only: it restarts nothing, but it fires story beats.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../../editor/node_modules/@playwright/test/index.mjs";
import type { Browser, BrowserContext, Page } from "../../editor/node_modules/@playwright/test/index.mjs";

const BASE = (process.env["SIM_BASE"] ?? "").replace(/\/$/u, "");
const MOD = process.env["SIM_MOD_CODE"] ?? "";
const PRIME = process.env["SIM_PRIME_CODE"] ?? "";
const SHOTS = process.env["SIM_SHOTS"] ?? "test-results/prompter";
const EVENT = "default";
const API = `${BASE}/e/${EVENT}`;

interface Mod {
  token: string;
  post(path: string, body: unknown): Promise<Record<string, unknown>>;
  get(path: string): Promise<Record<string, unknown>>;
}

async function modLogin(): Promise<Mod> {
  const r = await fetch(`${API}/api/mod/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: MOD }) });
  const { token } = (await r.json()) as { token: string };
  return {
    token,
    post: async (path, body) => {
      const res = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-loom-token": token }, body: JSON.stringify(body) });
      return (await res.json().catch(() => ({}))) as Record<string, unknown>;
    },
    get: async (path) => {
      const res = await fetch(`${API}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`, { headers: { "x-loom-token": token } });
      return (await res.json().catch(() => ({}))) as Record<string, unknown>;
    },
  };
}

/** A real booth session, seeded where a phone keeps it: past the sign-in. */
async function phone(browser: Browser, part: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const r = await fetch(`${API}/api/prime/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: PRIME, character: part }) });
  const auth = (await r.json()) as { token?: string; admin?: boolean; host?: boolean; error?: string };
  expect(auth.token, `signing in as ${part}: ${auth.error ?? ""}`).toBeTruthy();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key as string, value as string);
    },
    ["loom.prime", JSON.stringify({ token: auth.token, character: part, admin: auth.admin === true, host: auth.host === true, eventId: EVENT })],
  );
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?role=performer`);
  return { ctx, page };
}

/** A real finger: touch events through the browser's own input, so the page
 *  scrolls natively and fires what a phone fires. It stays down until `lift`. */
async function swipe(p: Page, ctx: BrowserContext, dy: number): Promise<{ lift: () => Promise<void> }> {
  const cdp = await ctx.newCDPSession(p);
  const box = (await p.locator(".aloud-text").boundingBox())!;
  const x = box.x + box.width / 2;
  const from = box.y + box.height * 0.7;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: from }] });
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: from - (dy * i) / steps }] });
    await p.waitForTimeout(16);
  }
  return { lift: () => cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }).then(() => {}) };
}

const scrollOf = (p: Page) => p.locator(".aloud-text").evaluate((e) => e.scrollTop);
const nowLine = (p: Page) => p.locator(".aloud-line.now").first().innerText();

/** Press and scroll like a finger: the pointer goes down on the text, the text moves. */
async function press(p: Page, to: "start" | number): Promise<void> {
  await p.locator(".aloud-text").dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 7, bubbles: true });
  if (to !== "start") await p.locator(".aloud-text").evaluate((e, y) => void (e.scrollTop = y as number), to);
}
const letGo = (p: Page) => p.locator(".aloud-text").dispatchEvent("pointerup", { pointerType: "touch", pointerId: 7, bubbles: true });

/** The y that puts line `i` on the reading mark. */
const yOf = (p: Page, i: number) =>
  p.locator(".aloud-text").evaluate((e, n) => {
    const rows = [...e.querySelectorAll<HTMLElement>("[data-line]")];
    return rows[n as number]!.offsetTop - Math.round(e.clientHeight * 0.3);
  }, i);

test("she scrolls, he waits; she reaches his line, he speaks, it scrolls, a host sees it all", async ({ browser }) => {
  test.skip(BASE === "" || MOD === "" || PRIME === "", "set SIM_BASE, SIM_MOD_CODE and SIM_PRIME_CODE");
  test.setTimeout(180_000);
  mkdirSync(SHOTS, { recursive: true });
  const mod = await modLogin();
  await mod.post("/api/mod/start", {});
  // Past the staff upload, and him online before the TV opens, so it has no backlog.
  await mod.post("/api/mod/signal", { name: "wave_staff_through" });
  await mod.post("/api/mod/var", { path: "Night.step", value: "3" });
  await mod.post("/api/mod/signal", { name: "introduce_trabolta" });

  const tv = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const tvPage = await tv.newPage();
  await tvPage.goto(`${BASE}/terminal/?code=${encodeURIComponent(MOD)}&view=tv&name=TV&character=Trabolta&room=The%20Desktop&engine=silent`);
  // Every line the TV is told to say, as the page's own polls carry it.
  const said: Array<{ seq: number; at: number }> = [];
  const polls: number[] = [];
  tvPage.on("response", async (res) => {
    if (!res.url().includes("/api/screen/state")) return;
    polls.push(Date.now());
    const body = (await res.json().catch(() => null)) as { voice?: { lines?: Array<{ seq: number; from: string }> } } | null;
    for (const l of body?.voice?.lines ?? []) if (l.from === "Trabolta" && !said.some((s) => s.seq === l.seq)) said.push({ seq: l.seq, at: Date.now() });
  });
  await tvPage.waitForTimeout(3_000);

  // A run before this one still holds the parts.
  for (const part of ["Clippy", "Task Manager"]) await mod.post("/api/mod/prime/release", { character: part });
  const clippy = await phone(browser, "Clippy");
  const host = await phone(browser, "Task Manager");
  await clippy.page.waitForTimeout(2_500);

  const fired = said.length;
  await mod.post("/api/mod/beat", { name: "Second Hunt" });

  // The pop-up: nothing of his on the TV yet.
  const alert = clippy.page.locator(".aloud-alert");
  await expect(alert).toBeVisible({ timeout: 8_000 });
  await tvPage.waitForTimeout(6_500);
  expect(said.length, "he waits for the script past the wait for a phone").toBe(fired);
  await clippy.page.screenshot({ path: join(SHOTS, "1-popup.png") });

  await alert.click();
  await expect(clippy.page.locator(".aloud-text")).toBeVisible();
  await tvPage.waitForTimeout(1_000);
  expect(said.length, "opening it fires nothing").toBe(fired);

  // The host joins from Show.
  const joinIt = host.page.getByRole("button", { name: "📜 Join" });
  await expect(joinIt).toBeVisible({ timeout: 15_000 });
  await host.page.screenshot({ path: join(SHOTS, "2-host-show.png") });
  await joinIt.click();
  await expect(host.page.locator(".aloud-text")).toBeVisible();

  // She scrolls to her second line with a real finger: the host follows, and he still waits.
  // (A little past it: the browser keeps the first few pixels of a drag as slop.)
  const down = await swipe(clippy.page, clippy.ctx, (await yOf(clippy.page, 1)) - (await scrollOf(clippy.page)) + 40);
  await expect(host.page.getByTestId("aloud-lock")).toContainText("Clippy has it", { timeout: 5_000 });
  await expect(host.page.locator(".aloud-text")).toHaveClass(/locked/u);
  await clippy.page.waitForTimeout(600);
  await expect.poll(() => nowLine(host.page), { timeout: 5_000 }).toContain("We are going to proceed");
  await host.page.screenshot({ path: join(SHOTS, "3-host-locked.png") });

  // The other phone can't take it while she holds it.
  const hostTop = await scrollOf(host.page);
  await host.page.locator(".aloud-text").evaluate((e) => void (e.scrollTop = e.scrollTop + 300));
  await host.page.waitForTimeout(400);
  expect(Math.abs((await scrollOf(host.page)) - hostTop), "a locked phone snaps back").toBeLessThan(20);
  await down.lift();
  await expect(host.page.getByTestId("aloud-lock")).toHaveCount(0, { timeout: 5_000 });

  // She reaches his line: the time from the scroll to the TV having it.
  const y = await yOf(clippy.page, 2);
  await press(clippy.page, y);
  const reached = Date.now();
  await expect.poll(() => said.length, { timeout: 8_000 }).toBeGreaterThan(fired);
  const heard = said[fired]!.at - reached;
  await letGo(clippy.page);
  // Locked for both, and scrolling by itself.
  for (const p of [clippy.page, host.page]) await expect(p.getByTestId("aloud-lock")).toContainText("Trabolta is speaking", { timeout: 5_000 });
  await clippy.page.screenshot({ path: join(SHOTS, "4-speaking.png") });
  const a = await scrollOf(host.page);
  await host.page.waitForTimeout(5_000);
  expect(await scrollOf(host.page), "it autoscrolls through his line for everyone").toBeGreaterThan(a + 2);

  // The real TV page has the line up.
  await expect.poll(() => tvPage.locator(".tv-caption").first().innerText().catch(() => ""), { timeout: 8_000 }).toMatch(/Thank you, Clippy|Programs\. The presentation|Round two|routine/u);

  // ✓ Done ends it on both phones, and the rest of his lines come.
  await expect(clippy.page.getByTestId("aloud-lock")).toHaveCount(0, { timeout: 90_000 });
  await clippy.page.getByRole("button", { name: /✓ Done|Skip the rest/u }).first().click();
  const armed = clippy.page.getByRole("button", { name: /Skip the rest/u });
  if ((await armed.count()) > 0) await armed.first().click();
  await expect(clippy.page.locator(".aloud-prompter")).toHaveCount(0, { timeout: 5_000 });
  await expect(host.page.locator(".aloud-prompter")).toHaveCount(0, { timeout: 5_000 });
  const gaps = polls.slice(1).map((t, i) => t - polls[i]!);
  process.stdout.write(`\nscroll → TV has the line: ${heard} ms; fastest gap between TV polls: ${Math.min(...gaps)} ms\n`);
  await tv.close();
  await clippy.ctx.close();
  await host.ctx.close();
});

/** How many lines of his a poll has released, read as a TV reads them. */
async function heldNow(mod: Mod): Promise<{ lines: number; held: boolean; head: number }> {
  const r = (await mod.get(`/api/screen/state?name=probe&view=tv&character=Trabolta&voice=The%20Desktop&after=0`)) as { voice?: { lines: unknown[]; held?: boolean; head: number } };
  return { lines: r.voice?.lines.length ?? 0, held: r.voice?.held === true, head: r.voice?.head ?? -1 };
}

test("autoscroll and jumps stay shared; a host's ▶ and a reader leaving both let him speak", async ({ browser }) => {
  test.skip(BASE === "" || MOD === "" || PRIME === "", "set SIM_BASE, SIM_MOD_CODE and SIM_PRIME_CODE");
  test.setTimeout(120_000);
  const mod = await modLogin();
  await mod.post("/api/mod/start", {});
  for (const part of ["Clippy", "Task Manager"]) await mod.post("/api/mod/prime/release", { character: part });
  const clippy = await phone(browser, "Clippy");
  const host = await phone(browser, "Task Manager");
  await clippy.page.waitForTimeout(2_500);
  await mod.post("/api/mod/beat", { name: "Ad Hijack" });
  const takeover = clippy.page.locator(".aloud-alert");
  await expect(takeover).toBeVisible({ timeout: 8_000 });
  await takeover.click();
  await host.page.getByRole("button", { name: "📜 Join" }).click({ timeout: 15_000 });
  await expect(host.page.locator(".aloud-text")).toBeVisible();

  // ▶ Scroll on one phone moves both, and stops on his line by itself.
  await clippy.page.getByRole("button", { name: "▶ Scroll" }).click();
  await expect(host.page.getByRole("button", { name: "⏸ Pause" })).toBeVisible({ timeout: 5_000 });
  const a = await scrollOf(host.page);
  await host.page.waitForTimeout(2_000);
  expect(await scrollOf(host.page), "autoscroll reaches the other phone").toBeGreaterThan(a + 5);
  await host.page.getByRole("button", { name: "⏸ Pause" }).click();
  await expect(clippy.page.getByRole("button", { name: "▶ Scroll" })).toBeVisible({ timeout: 5_000 });

  // ≡ Jump to a section, and the back-a-line arrow, from the other phone.
  await host.page.getByRole("button", { name: "Back a line" }).click();
  await expect.poll(() => nowLine(clippy.page), { timeout: 5_000 }).toContain("Okay, programs");
  expect((await heldNow(mod)).held, "nothing of his has gone").toBe(true);

  // A host's ▶ from Show lets every line go, and the prompter carries on.
  await host.page.getByRole("button", { name: "Close the teleprompter" }).click();
  await host.page.getByTestId("host-prompter-release").click({ timeout: 15_000 });
  await expect.poll(async () => (await heldNow(mod)).held, { timeout: 5_000 }).toBe(false);
  await expect(clippy.page.locator(".aloud-text")).toBeVisible();

  // A newer beat: the reader goes away, and the rest plays by itself.
  await mod.post("/api/mod/beat", { name: "Second Hunt" });
  await expect.poll(async () => (await heldNow(mod)).held, { timeout: 5_000 }).toBe(true);
  await clippy.page.waitForTimeout(1_000);
  await clippy.ctx.close();
  const gone = Date.now();
  await expect.poll(async () => (await heldNow(mod)).held, { timeout: 20_000, intervals: [500] }).toBe(false);
  process.stdout.write(`\nreader gone → the hold lets go: ${Date.now() - gone} ms\n`);
  await host.ctx.close();
});

test("a director's phone shows the hold, and ▶ lets him speak", async ({ browser }) => {
  test.skip(BASE === "" || MOD === "" || PRIME === "", "set SIM_BASE, SIM_MOD_CODE and SIM_PRIME_CODE");
  test.setTimeout(60_000);
  const mod = await modLogin();
  await mod.post("/api/mod/prime/release", { character: "Clippy" });
  const clippy = await phone(browser, "Clippy");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const dir = await ctx.newPage();
  await dir.goto(`${BASE}/?role=director&code=${encodeURIComponent(MOD)}`);
  const who = dir.getByPlaceholder("Your name (the log says who fired)");
  await who.fill("Spec");
  await dir.getByRole("button", { name: /sign in/iu }).click();
  await who.waitFor({ state: "hidden", timeout: 20_000 });
  await clippy.page.waitForTimeout(2_000);
  await mod.post("/api/mod/beat", { name: "Second Hunt" });
  await expect(clippy.page.locator(".aloud-alert")).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => (await heldNow(mod)).held, { timeout: 5_000 }).toBe(true);
  const strip = dir.getByTestId("dir-prompter");
  await expect(strip).toContainText("he waits for the script", { timeout: 10_000 });
  await strip.getByRole("button", { name: /Let him speak/u }).click();
  await expect.poll(async () => (await heldNow(mod)).held, { timeout: 5_000 }).toBe(false);
  await expect(strip).toHaveCount(0, { timeout: 8_000 });
  await ctx.close();
  await clippy.ctx.close();
});

/** ✓ Done from anywhere in the script: two taps, short of its last line. */
async function doneNow(p: Page): Promise<void> {
  const done = p.locator(".aloud-row > .aloud-done");
  await done.click();
  if ((await p.locator(".aloud-prompter").count()) > 0 && (await done.innerText()).includes("Skip")) await done.click();
}

test("a beat landing mid-read keeps what it took off the phone: a chip, a sheet, and the pop-up again", async ({ browser }) => {
  test.skip(BASE === "" || MOD === "" || PRIME === "", "set SIM_BASE, SIM_MOD_CODE and SIM_PRIME_CODE");
  test.setTimeout(90_000);
  const mod = await modLogin();
  await mod.post("/api/mod/start", {});
  await mod.post("/api/mod/signal", { name: "wave_staff_through" });
  await mod.post("/api/mod/aloud", { action: "done" });
  await mod.post("/api/mod/prime/release", { character: "Clippy" });
  const { ctx, page: p } = await phone(browser, "Clippy");
  await p.waitForTimeout(2_500);
  const alert = p.locator(".aloud-alert");
  // A new phone counts back 20 minutes: an earlier test's lines come first.
  if (await alert.isVisible()) {
    await alert.click();
    await doneNow(p);
    await expect(alert).toHaveCount(0);
  }

  const cutShort = async () => {
    await mod.post("/api/mod/beat", { name: "Winning Line" });
    await alert.click({ timeout: 8_000 });
    await expect(p.locator("[data-line]")).toHaveCount(4);
    await p.waitForTimeout(500);
    await mod.post("/api/mod/beat", { name: "Corrupted Code" });
    await expect(p.locator("[data-line]")).toHaveCount(2, { timeout: 5_000 });
  };
  const chip = p.getByRole("button", { name: /earlier lines?$/u });

  // Left alone: ✓ Done brings the pop-up back for them, and the whole script opens.
  await cutShort();
  await expect(chip).toHaveText("↑ 3 earlier lines");
  await doneNow(p);
  await expect(alert).toBeVisible({ timeout: 5_000 });
  await alert.click();
  await expect(p.locator(".aloud-line.now").first()).toContainText("centre square");
  await doneNow(p);
  await expect(alert).toHaveCount(0);

  // Read on the sheet: nothing more is owed.
  await cutShort();
  await chip.click();
  await expect(p.locator(".aloud-sheet-text .aloud-line")).toHaveCount(3);
  await p.screenshot({ path: join(SHOTS, "earlier-lines.png") });
  await p.getByRole("button", { name: "✓ Read them" }).click();
  await expect(chip).toHaveCount(0);
  await doneNow(p);
  await p.waitForTimeout(800);
  await expect(alert).toHaveCount(0);
  await expect(p.locator(".aloud-prompter")).toHaveCount(0);

  // Read to the end, no ✓ Done: the newer beat owes nothing.
  await mod.post("/api/mod/beat", { name: "Winning Line" });
  await alert.click({ timeout: 8_000 });
  await p.waitForTimeout(500);
  const end = await swipe(p, ctx, 3_000);
  await end.lift();
  await expect(p.locator(".aloud-bar-title")).toContainText("line 4 of 4", { timeout: 5_000 });
  await p.waitForTimeout(800);
  await mod.post("/api/mod/beat", { name: "Corrupted Code" });
  await expect(p.locator("[data-line]")).toHaveCount(2, { timeout: 5_000 });
  await expect(chip).toHaveCount(0);
  await ctx.close();
});

test("the story going on lets a hold go, and a host who only watches doesn't keep one", async ({ browser }) => {
  test.skip(BASE === "" || MOD === "" || PRIME === "", "set SIM_BASE, SIM_MOD_CODE and SIM_PRIME_CODE");
  test.setTimeout(90_000);
  const mod = await modLogin();
  await mod.post("/api/mod/start", {});
  await mod.post("/api/mod/signal", { name: "wave_staff_through" });
  await mod.post("/api/mod/aloud", { action: "done" });
  for (const part of ["Clippy", "Task Manager"]) await mod.post("/api/mod/prime/release", { character: part });
  const tv = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const tvPage = await tv.newPage();
  const said: string[] = [];
  const seen = new Set<number>();
  tvPage.on("response", async (res) => {
    if (!res.url().includes("/api/screen/state")) return;
    const body = (await res.json().catch(() => null)) as { voice?: { lines?: Array<{ seq: number; from: string; text: string }> } } | null;
    for (const l of body?.voice?.lines ?? []) {
      if (l.from !== "Trabolta" || seen.has(l.seq)) continue;
      seen.add(l.seq);
      said.push(l.text);
    }
  });
  await tvPage.goto(`${BASE}/terminal/?code=${encodeURIComponent(MOD)}&view=tv&name=TV&character=Trabolta&room=The%20Desktop&engine=silent`);
  await tvPage.waitForTimeout(3_000);
  const clippy = await phone(browser, "Clippy");
  const host = await phone(browser, "Task Manager");
  await clippy.page.waitForTimeout(2_500);

  // Her pop-up is up, and the next scripted beat of his in the room lands.
  said.length = 0;
  await mod.post("/api/mod/beat", { name: "Full Of Beans" });
  await clippy.page.locator(".aloud-alert").first().click({ timeout: 8_000 });
  await tvPage.waitForTimeout(3_000);
  expect(said, "he waits for her").toEqual([]);
  await mod.post("/api/mod/beat", { name: "Overshare Four" });
  await expect.poll(() => said.length, { timeout: 8_000 }).toBeGreaterThanOrEqual(3);
  expect(said[0], "what she held goes first").toContain("Antivirus.");
  expect(said.findIndex((t) => t.includes("That is all.")), "and the later beat after it").toBeGreaterThan(0);
  await expect(clippy.page.locator(".aloud-text")).toBeVisible();

  // A host joins, and the reader's phone dies: watching doesn't keep him waiting.
  await mod.post("/api/mod/beat", { name: "Ad Hijack" });
  await expect(host.page.getByRole("button", { name: "📜 Join" })).toBeVisible({ timeout: 15_000 });
  await host.page.getByRole("button", { name: "📜 Join" }).click();
  await expect(host.page.locator(".aloud-text")).toBeVisible();
  await expect.poll(async () => (await heldNow(mod)).held, { timeout: 5_000 }).toBe(true);
  await clippy.ctx.close();
  const gone = Date.now();
  await expect.poll(async () => (await heldNow(mod)).held, { timeout: 20_000, intervals: [500] }).toBe(false);
  process.stdout.write(`\nreader gone, a host only watching → the hold lets go: ${Date.now() - gone} ms\n`);
  await host.ctx.close();
  await tv.close();
});

const LINES_STORY = `
TITLE: Lines

CHARACTER Clippy

CHARACTER Recycling Bin
  admin: true

LOCATION The Desktop

== Start
  setting: The Desktop

== Bingo Lines
  setting: The Desktop
  aloud: Clippy
Clippy: The first line is mine.
Recycling Bin: The second line is yours.
Clippy: The last line is mine again.
`;

test("someone else's line is a small card: they can say it, or join", async ({ browser }) => {
  test.skip(BASE === "" || MOD === "" || PRIME === "" || process.env["SIM_LINES"] !== "1", "set SIM_LINES=1 too: it loads a tiny story over the event");
  test.setTimeout(60_000);
  const mod = await modLogin();
  const loaded = await mod.post("/api/mod/load", { source: LINES_STORY, name: "Lines" });
  expect(loaded["error"]).toBeUndefined();
  await mod.post("/api/mod/start", {});
  for (const part of ["Clippy", "Recycling Bin"]) await mod.post("/api/mod/prime/release", { character: part });
  const clippy = await phone(browser, "Clippy");
  const bin = await phone(browser, "Recycling Bin");
  await clippy.page.waitForTimeout(2_000);
  await mod.post("/api/mod/beat", { name: "Bingo Lines" });
  const card = bin.page.getByTestId("aloud-card");
  await expect(card).toBeVisible({ timeout: 8_000 });
  await expect(card).toContainText("The second line is yours.");
  await expect(bin.page.locator(".aloud-prompter"), "a line never takes the phone over").toHaveCount(0);
  await bin.page.screenshot({ path: join(SHOTS, "5-card.png") });
  await card.getByRole("button", { name: /Join the teleprompter/u }).click();
  await expect(bin.page.locator(".aloud-line.mine")).toContainText("The second line is yours.");
  await clippy.ctx.close();
  await bin.ctx.close();
});
