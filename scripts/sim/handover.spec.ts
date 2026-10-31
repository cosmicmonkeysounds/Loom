// Her last line is his cue (wave 59, the prompter contract's C11), on real pages:
// Clippy's phone and the real TV terminal. Her arrow past "Trabolta, would you
// explain the rules?" starts him; so does her ✓ Done; 🤖 first leaves both with
// nothing to do. Each run resets the event: scratch servers only.
//
//   SIM_BASE=http://127.0.0.1:7107 SIM_MOD_CODE=<mod> SIM_PRIME_CODE=<prime> SIM_SHOTS=<dir> \
//     pnpm --filter loom-app exec playwright test -c ../scripts/sim/playwright.config.ts handover
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../../editor/node_modules/@playwright/test/index.mjs";
import type { Browser, BrowserContext, Page } from "../../editor/node_modules/@playwright/test/index.mjs";

const BASE = (process.env["SIM_BASE"] ?? "").replace(/\/$/u, "");
const MOD = process.env["SIM_MOD_CODE"] ?? "";
const PRIME = process.env["SIM_PRIME_CODE"] ?? "";
const SHOTS = process.env["SIM_SHOTS"] ?? "test-results/handover";
const API = `${BASE}/e/default`;
const HIS_FIRST = "Thank you, Clippy, for hosting this marvelous evening.";
const ONLINE = "TRABOLTA IS ONLINE";

interface Rig {
  post(path: string, body?: unknown): Promise<Record<string, unknown>>;
  /** Every line the event holds, as a director reads them. */
  lines(): Promise<Array<{ channel: string; text: string }>>;
  /** `# hosts`, as a host's booth reads it. */
  hosts(): Promise<string[]>;
  phone: Page;
  tv: Page;
  /** When each of his lines reached the TV, by text. */
  said: Map<string, number>;
  close(): Promise<void>;
}

async function rig(browser: Browser, size?: number): Promise<Rig> {
  const login = await fetch(`${API}/api/mod/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: MOD }) });
  const { token } = (await login.json()) as { token: string };
  const headers = { "content-type": "application/json", "x-loom-token": token };
  const post = async (path: string, body: unknown = {}) => {
    const r = await fetch(`${API}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    return (await r.json().catch(() => ({}))) as Record<string, unknown>;
  };
  await post("/api/mod/reset");
  await post("/api/mod/start");
  await post("/api/mod/signal", { name: "wave_staff_through" });
  for (const name of ["call_to_the_desktop", "start_the_bingo", "bingo_time"]) await post("/api/mod/signal", { name });
  for (const character of ["Clippy", "Task Manager"]) await post("/api/mod/prime/release", { character });
  const host = (await (await fetch(`${API}/api/prime/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ character: "Task Manager", passcode: PRIME }) })).json()) as { token: string };

  const tvCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const tv = await tvCtx.newPage();
  await tv.goto(`${BASE}/terminal/?code=${encodeURIComponent(MOD)}&view=tv&name=TV&character=Trabolta&room=The%20Desktop&engine=silent`);
  const said = new Map<string, number>();
  tv.on("response", async (res) => {
    if (!res.url().includes("/api/screen/state")) return;
    const body = (await res.json().catch(() => null)) as { voice?: { lines?: Array<{ from: string; text: string }> } } | null;
    for (const l of body?.voice?.lines ?? []) if (l.from === "Trabolta" && !said.has(l.text)) said.set(l.text, Date.now());
  });

  const r = await fetch(`${API}/api/prime/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ character: "Clippy", passcode: PRIME }) });
  const auth = (await r.json()) as { token?: string; admin?: boolean; host?: boolean; error?: string };
  expect(auth.token, `signing in as Clippy: ${auth.error ?? ""}`).toBeTruthy();
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(
    ([key, value, sizeKey, sizeValue]) => {
      localStorage.setItem(key as string, value as string);
      if (sizeValue !== "") localStorage.setItem(sizeKey as string, sizeValue as string);
    },
    ["loom.prime", JSON.stringify({ token: auth.token, character: "Clippy", admin: auth.admin === true, host: auth.host === true, eventId: "default" }), "loom.aloud.size", size === undefined ? "" : String(size)],
  );
  const phone = await ctx.newPage();
  await phone.goto(`${BASE}/?role=performer`);
  await phone.waitForTimeout(2_500);
  return {
    post,
    phone,
    tv,
    said,
    lines: async () => {
      const res = await fetch(`${API}/api/history`, { headers: { "x-loom-token": token } });
      return ((await res.json()) as { messages: Array<{ channel: string; text: string }> }).messages;
    },
    hosts: async () => {
      // The stream's first frames: the history is all a host's phone is sent of the past.
      const stop = new AbortController();
      const res = await fetch(`${API}/events?role=prime&token=${encodeURIComponent(host.token)}`, { signal: stop.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        const at = text.indexOf("event: history\n");
        const end = at < 0 ? -1 : text.indexOf("\n\n", at);
        if (end > 0) {
          stop.abort();
          const rows = JSON.parse(text.slice(text.indexOf("data: ", at) + 6, end)) as Array<{ channel: string; text: string }>;
          return rows.filter((m) => m.channel === "room:hosts").map((m) => m.text);
        }
      }
      return [];
    },
    close: async () => {
      await ctx.close();
      await tvCtx.close();
    },
  };
}

async function hersOnThePhone(r: Rig): Promise<void> {
  await r.post("/api/mod/signal", { name: "clippy_on_trabolta" });
  const alert = r.phone.locator(".aloud-alert");
  await expect(alert).toBeVisible({ timeout: 8_000 });
  await alert.click();
  await expect(r.phone.locator(".aloud-text")).toBeVisible();
  await r.phone.waitForTimeout(500);
}

const count = async (r: Rig, text: string) => (await r.lines()).filter((m) => m.text.includes(text)).length;

/** Real touches, through the browser's own input, until the text stops moving. */
async function scrollToTheEnd(p: Page): Promise<{ swipes: number; top: number; max: number; reach: number; bottom: number }> {
  const cdp = await p.context().newCDPSession(p);
  const box = (await p.locator(".aloud-text").boundingBox())!;
  const x = box.x + box.width / 2;
  const read = () =>
    p.locator(".aloud-text").evaluate((e) => {
      const rows = [...e.querySelectorAll<HTMLElement>("[data-line]")];
      const end = rows[rows.length - 1]!;
      return { top: e.scrollTop, max: e.scrollHeight - e.clientHeight, reach: e.scrollHeight - e.clientHeight + Math.round(e.clientHeight * 0.3) + 1, bottom: end.offsetTop + end.offsetHeight };
    });
  let swipes = 0;
  for (; swipes < 80; swipes++) {
    const now = await read();
    if (now.top >= now.max - 1) return { swipes, ...now };
    const from = box.y + box.height * 0.8;
    const dy = box.height * 0.6;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: from }] });
    for (let i = 1; i <= 10; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: from - (dy * i) / 10 }] });
      await p.waitForTimeout(20);
    }
    await p.waitForTimeout(120); // a slow finger, so nothing flings
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await p.waitForTimeout(350);
  }
  return { swipes, ...(await read()) };
}

test.describe.configure({ mode: "serial" });
test.skip(BASE === "" || MOD === "" || PRIME === "", "set SIM_BASE, SIM_MOD_CODE and SIM_PRIME_CODE");
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

for (const size of [undefined, 64]) {
  test(`she scrolls past her last line and he starts, once (text ${size ?? "default"})`, async ({ browser }) => {
    test.setTimeout(90_000);
    const r = await rig(browser, size);
    await hersOnThePhone(r);
    expect(await count(r, ONLINE), "not while she reads").toBe(0);
    await r.phone.screenshot({ path: join(SHOTS, `scroll-${size ?? "default"}-1-reading.png`) });
    const at = await scrollToTheEnd(r.phone);
    console.log(`text ${size ?? "default"}: ${at.swipes} swipes, top ${at.top} of ${at.max}, the arrow reaches ${at.reach} past the last line's end at ${at.bottom}`);
    expect(at.reach, "the arrow can pass her last line at this size").toBeGreaterThanOrEqual(at.bottom);
    await expect.poll(() => count(r, ONLINE), { timeout: 6_000 }).toBe(1);
    await expect.poll(() => r.said.has(HIS_FIRST), { timeout: 6_000 }).toBe(true);
    await r.phone.screenshot({ path: join(SHOTS, `scroll-${size ?? "default"}-2-past-the-end.png`) });
    await r.tv.screenshot({ path: join(SHOTS, `scroll-${size ?? "default"}-3-tv.png`) });
    const before = await r.hosts();
    // 🤖 after it, as a host would, and her own ✓ Done.
    await r.phone.locator(".aloud-done.big").first().click();
    expect((await r.post("/api/mod/signal", { name: "introduce_trabolta" }))["refused"]).toBe(true);
    await r.phone.waitForTimeout(500);
    expect(await count(r, ONLINE), "once").toBe(1);
    expect((await r.hosts()).slice(before.length)).toEqual(["🤖 Trabolta is already online. Nothing happens."]);
    await r.close();
  });
}

test("her ✓ Done starts him, with the arrow anywhere", async ({ browser }) => {
  test.setTimeout(60_000);
  const r = await rig(browser);
  await hersOnThePhone(r);
  const done = r.phone.locator("footer .aloud-done");
  await done.click(); // "Skip the rest? Tap again"
  expect(await count(r, ONLINE)).toBe(0);
  await done.click();
  await expect.poll(() => count(r, ONLINE), { timeout: 6_000 }).toBe(1);
  await expect.poll(() => r.said.has(HIS_FIRST), { timeout: 6_000 }).toBe(true);
  await r.tv.screenshot({ path: join(SHOTS, "done-tv.png") });
  await r.phone.waitForTimeout(1_000);
  expect(await count(r, ONLINE), "once").toBe(1);
  await r.close();
});

test("🤖 first: her arrow and her ✓ Done do nothing, and nothing lands in # hosts", async ({ browser }) => {
  test.setTimeout(90_000);
  const r = await rig(browser);
  await hersOnThePhone(r);
  await r.post("/api/mod/signal", { name: "introduce_trabolta" });
  await expect.poll(() => count(r, ONLINE), { timeout: 4_000 }).toBe(1);
  await expect.poll(() => r.said.has(HIS_FIRST), { timeout: 6_000 }).toBe(true);
  const before = await r.hosts();
  await scrollToTheEnd(r.phone);
  await r.phone.locator(".aloud-done.big").first().click();
  await r.phone.waitForTimeout(1_500);
  expect(await count(r, ONLINE), "once").toBe(1);
  expect((await r.hosts()).slice(before.length)).toEqual([]);
  await r.close();
});

test("▶ Scroll running out of script starts him too", async ({ browser }) => {
  test.setTimeout(240_000);
  const r = await rig(browser);
  await hersOnThePhone(r);
  const faster = r.phone.getByRole("button", { name: "Faster" });
  for (let i = 0; i < 25; i++) await faster.click();
  await r.phone.locator(".aloud-play").click();
  await expect.poll(() => count(r, ONLINE), { timeout: 200_000, intervals: [1_000] }).toBe(1);
  await expect.poll(() => r.said.has(HIS_FIRST), { timeout: 6_000 }).toBe(true);
  await r.close();
});

test("the read in a room no list shows still reaches its reader's phone", async ({ browser }) => {
  test.setTimeout(60_000);
  const r = await rig(browser);
  await r.post("/api/mod/prime/release", { character: "Task Manager" });
  const auth = (await (await fetch(`${API}/api/prime/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ character: "Task Manager", passcode: PRIME }) })).json()) as { token: string };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(([key, value]) => localStorage.setItem(key as string, value as string), ["loom.prime", JSON.stringify({ token: auth.token, character: "Task Manager", admin: true, host: true, eventId: "default" })]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?role=performer`);
  await page.waitForTimeout(2_500);
  await r.post("/api/mod/beat", { name: "The Full Truth Read" });
  const alert = page.locator(".aloud-alert");
  await expect(alert).toBeVisible({ timeout: 8_000 });
  await alert.click();
  await expect(page.locator(".aloud-text")).toBeVisible();
  expect(await page.locator("[data-line]").count()).toBeGreaterThan(20);
  await ctx.close();
  await r.close();
});
