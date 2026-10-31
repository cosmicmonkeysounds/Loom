// The Desk's sub-tabs and 🖥 House (wave 59), on real pages at 390 × 780: a real
// Task Manager and a real Adobe Acrobat on a scratch server, with a stand-in sound
// router, lights module and terminals, so every panel has something to draw and
// every control goes to the real routes.
//
//   # a scratch server with the show's LOOM_AUDIO, LOOM_LIGHTS, LOOM_DESK and
//   # LOOM_HOUSE (scripts/sim/README.md), play built
//   SIM_BASE=http://127.0.0.1:7750 SIM_MOD_CODE=<mod> SIM_PRIME_CODE=<prime> SIM_SHOTS=<dir> \
//     pnpm --filter loom-app exec playwright test -c ../scripts/sim/playwright.config.ts desk
//
// Rehearsal servers only: it plays cues, tests lights and moves his voice mode.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../../editor/node_modules/@playwright/test/index.mjs";
import type { Browser, BrowserContext, Page } from "../../editor/node_modules/@playwright/test/index.mjs";
import { deskChecks, type DeskView } from "../../core/src/house-desk.ts";

const BASE = (process.env["SIM_BASE"] ?? "").replace(/\/$/u, "");
const MOD = process.env["SIM_MOD_CODE"] ?? "";
const PRIME = process.env["SIM_PRIME_CODE"] ?? "";
const SHOTS = process.env["SIM_SHOTS"] ?? "test-results/desk";
const EVENT = "default";
const API = `${BASE}/e/${EVENT}`;

const json = (body: unknown, token?: string) => ({ method: "POST", headers: { "content-type": "application/json", ...(token !== undefined ? { "x-loom-token": token } : {}) }, body: JSON.stringify(body) });

async function modToken(): Promise<string> {
  const r = await fetch(`${API}/api/mod/login`, json({ passcode: MOD }));
  return ((await r.json()) as { token: string }).token;
}

/** A booth signed in, seeded where a phone keeps it. */
async function phone(browser: Browser, part: string, viewport = { width: 390, height: 780 }): Promise<{ ctx: BrowserContext; page: Page; token: string }> {
  // A part is one phone's (wave 59): let the last test's go first.
  await fetch(`${API}/api/mod/prime/release`, json({ character: part }, mod));
  const r = await fetch(`${API}/api/prime/login`, json({ passcode: PRIME, character: part }));
  const auth = (await r.json()) as { token?: string; admin?: boolean; host?: boolean; error?: string };
  expect(auth.token, `signing in as ${part}: ${auth.error ?? ""}`).toBeTruthy();
  const ctx = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
  await ctx.addInitScript(
    ([key, value]) => {
      if (localStorage.getItem(key as string) === null) localStorage.setItem(key as string, value as string);
    },
    ["loom.prime", JSON.stringify({ token: auth.token, character: part, admin: auth.admin === true, host: auth.host === true, eventId: EVENT })],
  );
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?role=performer`);
  return { ctx, page, token: auth.token! };
}

/** Past a booth's upload (a staff part is on rails until then), then the Desk. */
async function openDesk(p: Page, mod: string, part: string): Promise<void> {
  await fetch(`${API}/api/mod/signal`, json({ name: "wave_staff_through" }, mod));
  await p.getByRole("button", { name: /^Desk\b/u }).click({ timeout: 20_000 });
  await expect(p.getByTestId("host-desk-tabs"), part).toBeVisible({ timeout: 15_000 });
}

/** A terminal's row in 🖥 House. */
const terminalRow = (p: Page, name: string) => p.getByTestId("host-desk-terminals").locator("li", { hasText: name });
/** The rows' names, top to bottom. */
const terminalOrder = (p: Page) =>
  p
    .getByTestId("host-desk-terminals")
    .locator(".host-subrow-name")
    .evaluateAll((els) => els.map((e) => (e.textContent ?? "").split(e.querySelector(".host-subrow-sub")?.textContent ?? "\u0000")[0]!.replace(/^\S+\s/u, "").trim()));

const selected = (p: Page) => p.locator('.host-desk-tab[aria-selected="true"]').getAttribute("data-testid");
const tab = (p: Page, id: string) => p.getByTestId(`host-desk-tab-${id}`).click();

/** No sideways page scroll, and every tab wholly on the phone. */
async function fitsThePhone(p: Page, where: string): Promise<void> {
  const wide = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, view: window.innerWidth }));
  expect(wide.doc, `${where}: page width`).toBeLessThanOrEqual(wide.view);
  expect(wide.body, `${where}: body width`).toBeLessThanOrEqual(wide.view);
  const boxes = await p.locator(".host-desk-tab").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, right: r.right, h: r.height, w: r.width })));
  for (const b of boxes) {
    expect(b.x, where).toBeGreaterThanOrEqual(0);
    expect(b.right, where).toBeLessThanOrEqual(wide.view);
    expect(b.h, `${where}: a tab's height`).toBeGreaterThanOrEqual(44);
    expect(b.w, `${where}: a tab's width`).toBeGreaterThanOrEqual(44);
  }
  // Nothing in the tab runs past its own edge either.
  const over = await p.locator("#host-desk-panel").evaluate((e) => e.scrollWidth - e.clientWidth);
  expect(over, `${where}: panel overflow`).toBeLessThanOrEqual(0);
}

async function shot(p: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await p.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/** Router, lights module and terminals as the real ones poll. Stops with `stop()`. */
function standIns(mod: string): { stop(): void } {
  const get = (path: string) => fetch(`${API}${path}`, { headers: { "x-loom-token": mod } }).catch(() => null);
  const post = (path: string, body: unknown) => fetch(`${API}${path}`, json(body, mod)).catch(() => null);
  const terminals = [
    ["Hall", "hall", "room", "ver=b2&audio=1&vis=v&fs=1&bat=88c"],
    ["CPU", "cpu", "room", "ver=b2&audio=0&vis=h&fs=0&bat=12"],
    ["Server Room", "server-room", "room", "ver=b2&audio=1&vis=v&fs=1&door=closed"],
    ["Casino", "graphics-card", "casino", "ver=b1&audio=1&vis=v&fs=1"],
    ["TV", "desktop-tv", "tv", "ver=b2&audio=1&vis=v&fs=1"],
  ] as const;
  const beat = async () => {
    await get(`/api/mod/audio?router=1&name=desktop&wait=0`);
    await post("/api/mod/audio/report", {
      health: {
        ok: true, device: "MOTU 828x", layout: "ok", voices: 0, xruns: 0, peakDb: -60, announce: "on", missing: [], placeholders: [], files: 20,
        music: { scene: "doors", scenes: ["off", "doors", "act_1"], hand: false, beds: [{ playlist: "doors", speakers: ["living-l", "living-r"], track: "Stand-in track", posS: 12, durS: 180, live: true }], missing: [], tidal: { online: true, playing: true, paused: false, track: "Stand-in track", problem: "", playlist: "", library: [{ id: "12345678-1234-1234-1234-123456789abc", title: "Stand-in list", items: 3 }] } },
      },
    });
    await get(`/api/mod/lights?module=1&name=desktop&wait=0`);
    for (const [name, spot, view, device] of terminals) await get(`/api/screen/state?name=${encodeURIComponent(name)}&spot=${spot}&view=${view}&${device}`);
  };
  void beat();
  const t = setInterval(() => void beat(), 3000);
  return { stop: () => clearInterval(t) };
}

test.describe.configure({ mode: "serial" });

let mod = "";
let house: { stop(): void };

test.beforeAll(async () => {
  expect(BASE !== "" && MOD !== "" && PRIME !== "", "SIM_BASE, SIM_MOD_CODE, SIM_PRIME_CODE").toBe(true);
  mod = await modToken();
  // Polls once and goes silent, so 🖥 House has a row someone would have to walk to.
  await fetch(`${API}/api/screen/state?name=Attic&spot=attic&view=room&ver=b2`, { headers: { "x-loom-token": mod } });
  house = standIns(mod);
  await fetch(`${API}/api/mod/desk/stop`, json({ all: true }, mod));
});

test.afterAll(() => house.stop());

test("as a host's token: every cue GOes, and every check's every test is answered", async () => {
  await fetch(`${API}/api/mod/prime/release`, json({ character: "Recycling Bin" }, mod));
  const r = await fetch(`${API}/api/prime/login`, json({ passcode: PRIME, character: "Recycling Bin" }));
  const { token } = (await r.json()) as { token: string };
  const read = async () => (await (await fetch(`${API}/api/mod/desk`, { headers: { "x-loom-token": token } })).json()) as DeskView;
  const send = (path: string, body: unknown) => fetch(`${API}${path}`, json(body, token));
  const view = await read();
  expect(view.problems, "desk.json").toEqual([]);
  expect(view.warnings, "desk.json").toEqual([]);
  for (const c of view.desk.cues) {
    expect((await send("/api/mod/desk/standby", { cue: c.id })).status, c.id).toBe(200);
    expect((await send("/api/mod/desk/go", { standby: c.id })).status, c.id).toBe(200);
    const run = (await read()).runs.find((x) => x.cue === c.id);
    expect(run, c.id).toBeDefined();
    for (const st of run!.steps) expect(["no-file", "nowhere", "error", "refused"], `${c.id} step ${st.i}`).not.toContain(st.result);
    expect((await send("/api/mod/desk/stop", { all: true })).status, c.id).toBe(200);
  }
  const rows = deskChecks(await read()).flatMap((s) => s.rows);
  expect(rows.length).toBeGreaterThan(80);
  for (const row of rows) {
    for (const t of [row.test, ...row.extra.map((x) => x.test)]) expect((await send(t.route, t.body)).status, `${row.key} ${JSON.stringify(t.body)}`).toBe(200);
    expect((await send("/api/mod/desk/check", { key: row.key, mark: "ok" })).status, row.key).toBe(200);
    expect((await send("/api/mod/desk/check", { key: row.key, mark: null })).status, row.key).toBe(200);
  }
  // What a host may never do, from the same token.
  for (const [path, body] of [["/api/mod/desk", { desk: view.desk }], ["/api/mod/desk/check/reset", {}], ["/api/mod/lights/pair", { on: true }], ["/api/mod/reset", {}], ["/api/mod/load", {}], ["/api/mod/resync", {}], ["/api/mod/spatial/descent", { level: 1 }]] as const) {
    expect((await send(path, body)).status, path).toBe(403);
  }
  await fetch(`${API}/api/mod/prime/release`, json({ character: "Recycling Bin" }, mod));
});

test("Task Manager opens on Music, and the top stays put on every tab", async ({ browser }) => {
  const { ctx, page } = await phone(browser, "Task Manager");
  await openDesk(page, mod, "Task Manager");
  expect(await selected(page)).toBe("host-desk-tab-music");
  await expect(page.getByTestId("host-music-body")).toBeVisible();
  for (const id of ["music", "mix", "house", "setup", "cues"]) {
    await tab(page, id);
    await fitsThePhone(page, id);
    await shot(page, `tm-${id}`);
    const before = await page.getByTestId("host-desk-top").boundingBox();
    await page.locator("#host-desk-panel").evaluate((e) => void (e.scrollTop = e.scrollHeight));
    const after = await page.getByTestId("host-desk-top").boundingBox();
    expect(after?.y, id).toBe(before?.y);
    await expect(page.locator(".host-desk-stopall")).toBeInViewport();
    await expect(page.getByTestId("host-desk-tabs")).toBeInViewport();
  }
  await ctx.close();
});

test("another host opens on Cues; Music and Mix poll only on their tab; a device keeps its tab", async ({ browser }) => {
  const { ctx, page } = await phone(browser, "Adobe Acrobat");
  const mixerCalls: string[] = [];
  const photoCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/mod/audio/mixer")) mixerCalls.push(r.url());
    if (r.url().includes("/api/mod/photos")) photoCalls.push(r.url());
  });
  await openDesk(page, mod, "Adobe Acrobat");
  expect(await selected(page)).toBe("host-desk-tab-cues");
  await expect(page.getByTestId("host-desk-standby")).toBeVisible();
  await page.waitForTimeout(2500);
  expect(mixerCalls, "Cues polls no mixer").toEqual([]);
  expect(photoCalls, "Cues polls no photos").toEqual([]);
  await tab(page, "mix");
  await expect.poll(() => mixerCalls.length).toBeGreaterThan(1);
  await tab(page, "house");
  await page.waitForTimeout(300);
  const n = mixerCalls.length;
  await page.waitForTimeout(2500);
  expect(mixerCalls.length, "House stops the mixer's poll").toBe(n);
  await expect.poll(() => photoCalls.length, { message: "House polls the photos" }).toBeGreaterThan(0);
  await tab(page, "music");
  await expect.poll(() => mixerCalls.length).toBeGreaterThan(n);
  await tab(page, "setup");
  await page.reload();
  await page.getByRole("button", { name: /^Desk\b/u }).click({ timeout: 20_000 });
  await expect(page.getByTestId("host-desk-tabs")).toBeVisible({ timeout: 15_000 });
  expect(await selected(page), "the device's last tab").toBe("host-desk-tab-setup");
  await ctx.close();
});

test("GO, the chip from every tab, ■ Stop, ■ STOP ALL", async ({ browser }) => {
  const { ctx, page } = await phone(browser, "Adobe Acrobat");
  await openDesk(page, mod, "Adobe Acrobat");
  await tab(page, "cues");
  // T1 starts on standby: move it, and back.
  await page.getByRole("button", { name: /PA test/u }).click();
  await expect(page.getByTestId("host-desk-note")).toContainText("Standing by");
  await expect(page.getByRole("button", { name: /PA test/u })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Speaker sweep/u }).click();
  await expect(page.getByTestId("host-desk-note")).toContainText("Speaker sweep");
  // GO sends the standby this phone shows: a tap ahead of the view is told to press again.
  await expect(page.getByRole("button", { name: /Speaker sweep/u })).toHaveAttribute("aria-pressed", "true");
  await page.locator(".host-desk-go").click();
  await expect(page.getByTestId("host-desk-playing")).toContainText("Speaker sweep");
  await tab(page, "setup");
  await expect(page.getByTestId("host-desk-playing")).toBeVisible();
  await tab(page, "house");
  await expect(page.getByTestId("host-desk-playing")).toBeVisible();
  await shot(page, "chip");
  await page.getByTestId("host-desk-playing").click();
  expect(await selected(page)).toBe("host-desk-tab-cues");
  await expect(page.getByRole("region", { name: "Playing" })).toBeInViewport();
  await page.getByRole("button", { name: "■ Stop", exact: true }).click();
  await expect(page.getByTestId("host-desk-note")).toContainText("Stopped");
  await expect(page.getByTestId("host-desk-playing")).toHaveCount(0);
  await page.locator(".host-desk-stopall").click();
  await expect(page.getByTestId("host-desk-note")).toContainText("Stopped every desk cue");
  await ctx.close();
});

test("🖥 House: his voice, a flavour, the TV, Identify, the terminals, and what stays a director's", async ({ browser }) => {
  const { ctx, page, token } = await phone(browser, "Task Manager");
  await openDesk(page, mod, "Task Manager");
  await tab(page, "house");
  await expect(page.getByTestId("host-desk-terminals")).toContainText("Hall");
  await expect(page.getByTestId("host-desk-terminals")).toContainText("🔇 touch it");
  await expect(page.getByTestId("host-desk-terminals")).toContainText("💤 hidden");
  await expect(page.getByTestId("host-desk-terminals")).toContainText("🚪 shut");
  await expect(page.getByTestId("host-desk-terminals")).toContainText("b1");
  await expect(page.locator("#host-desk-terminals, #host-desk-panel").first()).toContainText("on another build");
  // A terminal's heartbeat re-lists it on the server: the rows hold still through two.
  const order = await terminalOrder(page);
  expect(order).toEqual(["Attic", "Casino", "CPU", "Hall", "Server Room", "TV"]);
  await page.waitForTimeout(6_500);
  expect(await terminalOrder(page)).toEqual(order);
  await page.locator("#host-desk-panel").evaluate((e) => void (e.scrollTop = e.scrollHeight));
  await shot(page, "house-terminals");
  await page.locator("#host-desk-panel").evaluate((e) => void (e.scrollTop = 0));
  await shot(page, "house-top");

  const voice = async () => ((await (await fetch(`${API}/api/mod/screen/voice`, json({}, mod))).json()) as { muted: boolean; fx: string });
  await page.getByRole("button", { name: "Clean", exact: true }).click();
  await expect(page.getByTestId("host-desk-note")).toContainText("His voice: Clean");
  expect((await voice()).fx).toBe("clean");
  await expect(page.getByRole("button", { name: "Clean", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Auto", exact: true }).click();
  await expect.poll(async () => (await voice()).fx).toBe("auto");
  await page.getByRole("button", { name: /Break his next words/u }).click();
  await page.getByRole("button", { name: /Scratched disc/u }).click();
  await expect(page.getByTestId("host-desk-note")).toContainText("Scratched disc");
  await page.getByRole("button", { name: /Mute the TV voice/u }).click();
  await expect.poll(async () => (await voice()).muted).toBe(true);
  await page.getByRole("button", { name: /TV voice muted/u }).click();
  await expect.poll(async () => (await voice()).muted).toBe(false);
  // Doors closed: one tap, as ever.
  await terminalRow(page, "Casino").getByRole("button", { name: "Identify" }).click();
  await expect(page.getByTestId("host-desk-note")).toContainText("Casino shows its name");
  await page.getByRole("button", { name: /Stop \+ the announcement/u }).click();
  await expect(page.getByTestId("host-desk-note")).toContainText("and the announcement");

  // 📷 and 📢 live here, fit the phone, and 📢 is Run's own switch.
  await expect(page.getByTestId("host-photos")).toContainText("Terminal photos");
  const ads = page.locator("#host-desk-ads");
  await ads.scrollIntoViewIfNeeded();
  await expect(ads).toContainText("📢 Audio ads");
  await expect(page.getByTestId("host-desk-ads-line")).toContainText("played");
  await shot(page, "house-photos-ads");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no sideways scroll").toBe(true);
  const adsOn = async () => ((await (await fetch(`${API}/api/mod/screen/terminals`, { headers: { "x-loom-token": mod } })).json()) as { ads: { on: boolean } }).ads.on;
  await ads.getByRole("button", { name: "Off", exact: true }).click();
  await expect.poll(adsOn).toBe(false);
  await expect(page.getByTestId("host-desk-note")).toContainText("Audio ads off");
  await expect(page.getByTestId("host-desk-ads-line")).toContainText("off");
  await ads.getByRole("button", { name: "On", exact: true }).click();
  await expect.poll(adsOn).toBe(true);

  // The server keeps these a director's, and the page says where they are.
  await expect(page.getByTestId("host-desk-run-only")).toContainText("🎭 the costume's switch");
  for (const path of ["/api/mod/costume"]) {
    const r = await fetch(`${API}${path}?token=${encodeURIComponent(token)}`, { headers: { "x-loom-token": token } });
    expect(r.status, `a host's GET ${path}`).toBe(403);
  }
  const put = await fetch(`${API}/api/mod/costume`, json({ on: false }, token));
  expect(put.status, "a host's POST /api/mod/costume").toBe(403);
  await ctx.close();
});

test("Try it and the checks, from their tabs", async ({ browser }) => {
  const { ctx, page } = await phone(browser, "Adobe Acrobat");
  await openDesk(page, mod, "Adobe Acrobat");
  await tab(page, "house");
  await page.getByRole("textbox", { name: /Say on the speakers/u }).fill("Testing the house speakers.");
  // The words survive a hop to another tab.
  await tab(page, "cues");
  await tab(page, "house");
  await expect(page.getByRole("textbox", { name: /Say on the speakers/u })).toHaveValue("Testing the house speakers.");
  await page.getByRole("button", { name: "📢 Say it" }).click();
  await expect(page.getByTestId("host-desk-note")).toContainText("Said on the speakers");
  await expect(page.getByRole("textbox", { name: /Say on the speakers/u })).toHaveValue("");
  await page.getByRole("button", { name: /💡 Looks/u }).click();
  await page.getByRole("button", { name: /heart_idle/u }).click();
  await expect(page.getByTestId("host-desk-note")).toContainText("heart_idle");

  await tab(page, "setup");
  await page.getByRole("button", { name: /How the Desk works/u }).click();
  await expect(page.locator(".host-desk-how-list li")).toHaveCount(5);
  await expect(page.locator("#host-desk-panel")).toContainText("🔌 Setup says whether");
  await shot(page, "setup");
  await page.getByRole("button", { name: "🔊 Test tone" }).click();
  await page.getByRole("button", { name: "✓ Heard it" }).click();
  await expect(page.getByTestId("host-desk-note")).toContainText("✓");
  await expect(page.locator(".host-desk-walk-where")).toContainText("2 of");
  const where = await page.locator(".host-desk-walk-where").innerText();
  await tab(page, "cues");
  await tab(page, "setup");
  await expect(page.locator(".host-desk-walk-where"), "the walk keeps its place").toHaveText(where);
  await page.getByRole("button", { name: "next ›" }).click();
  await page.getByRole("button", { name: /Every check/u }).click();
  await expect(page.locator("#host-desk-panel")).toContainText("Story sounds");
  await ctx.close();
});

test("🎵 Music and 🎚 Mix drive the real routes", async ({ browser }) => {
  const { ctx, page } = await phone(browser, "Task Manager");
  await openDesk(page, mod, "Task Manager");
  await tab(page, "music");
  await expect(page.getByTestId("host-music-source")).toContainText("TIDAL");
  await expect(page.getByTestId("host-mix-now")).toContainText("Stand-in track");
  await shot(page, "music");
  await page.getByRole("button", { name: "⏸" }).click();
  await expect(page.locator("#host-desk-panel .host-desk-note")).not.toHaveText("");
  await page.getByRole("button", { name: "⏭" }).first().click();
  await page.locator(".host-mix-scene-pick").selectOption("act_1");
  await expect(page.locator("#host-desk-panel .host-desk-note")).not.toHaveText("");
  // A hop off Music keeps a half-pasted link.
  const paste = page.getByRole("textbox", { name: "TIDAL playlist link" });
  await paste.fill("https://tidal.com/playlist/half-pasted");
  await tab(page, "cues");
  await tab(page, "music");
  await expect(paste).toHaveValue("https://tidal.com/playlist/half-pasted");
  await paste.fill("");
  await page.getByRole("button", { name: /Your TIDAL playlists/u }).click();
  await page.getByRole("button", { name: /▶ Stand-in list/u }).click();
  await expect(page.locator("#host-desk-panel .host-desk-note")).not.toHaveText("");
  await page.getByRole("button", { name: "■ Stop music" }).click();
  await page.getByRole("button", { name: "■ Stop", exact: true }).click();
  await expect(page.locator("#host-desk-panel .host-desk-note")).not.toHaveText("");
  const mixed: Array<{ url: string; status: number }> = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/mod/audio/mix") && !r.url().includes("mixer")) mixed.push({ url: r.url(), status: r.status() });
  });
  await tab(page, "mix");
  await expect(page.getByTestId("host-mix-strips")).toBeVisible();
  await shot(page, "mix");
  await page.getByRole("button", { name: /Mute Master/u }).click();
  await expect.poll(() => mixed.length).toBeGreaterThan(0);
  expect(mixed.every((m) => m.status === 200), JSON.stringify(mixed)).toBe(true);
  await page.getByRole("button", { name: /^Reset /u }).click();
  await page.getByRole("button", { name: /Desktop \(living room\)/u }).click();
  await expect(page.locator("#host-desk-panel")).toContainText("Living L");
  await shot(page, "mix-room");
  await fitsThePhone(page, "the Mix tab in a room");
  // A hop off Mix keeps the room: the next fader must not move the whole house.
  await tab(page, "cues");
  await tab(page, "mix");
  await expect(page.getByRole("button", { name: "Desktop (living room)", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#host-desk-panel")).toContainText("Living L");
  await ctx.close();
});

test("once the doors are open: the dream's switch through the page, both ways; a test asks first", async ({ browser }) => {
  const { ctx, page } = await phone(browser, "Task Manager");
  await openDesk(page, mod, "Task Manager");
  await tab(page, "house");
  // Behind closed doors no story hears it.
  await expect(page.getByTestId("host-desk-dream")).toBeDisabled();
  await expect(page.locator("#host-desk-panel")).toContainText("It runs from 🕚 until an ending.");
  const post = (path: string, body: unknown) => fetch(`${API}${path}`, json(body, mod));
  await post("/api/mod/start", {});
  // Open doors put staff on their upload (wave 53): wave them through, back to the Desk.
  await post("/api/mod/signal", { name: "wave_staff_through" });
  await openDesk(page, mod, "Task Manager");
  await tab(page, "house");
  await expect(page.getByTestId("host-desk-dream"), "open doors, no 🕚 yet").toBeDisabled();
  await post("/api/mod/var", { path: "Night.clock", value: "23:00" });
  await expect(page.getByTestId("host-desk-dream")).toBeEnabled({ timeout: 10_000 });
  const dream = async () => ((await (await fetch(`${API}/api/state?role=mod&host=1`, { headers: { "x-loom-token": mod } })).json()) as { terminals: { dream: boolean } }).terminals.dream;
  expect(await dream()).toBe(false);
  await page.getByTestId("host-desk-dream").click();
  await page.getByTestId("host-desk-dream-yes").click();
  await expect(page.getByTestId("host-desk-note")).toContainText("back on the terminals");
  await expect.poll(dream).toBe(true);
  await expect(page.getByTestId("host-desk-dream")).toContainText("Put the terminals back", { timeout: 10_000 });
  await page.getByTestId("host-desk-dream").click();
  await page.getByTestId("host-desk-dream-yes").click();
  await expect(page.getByTestId("host-desk-note")).toContainText("usual screens");
  await expect.poll(dream).toBe(false);

  // Live: every test on the house asks first.
  await page.getByRole("textbox", { name: /Say on the speakers/u }).fill("Once more.");
  await page.getByRole("button", { name: "📢 Say it" }).click();
  await expect(page.getByRole("group", { name: /The show is live/u })).toBeVisible();
  await page.getByRole("button", { name: "Say it anyway" }).click();
  await expect(page.getByTestId("host-desk-note")).toContainText("Said on the speakers");

  // Identify covers a terminal's screen: it asks too, on a row that fits the phone.
  const identifying = async () => ((await (await fetch(`${API}/api/screen/state?name=Casino&spot=graphics-card&view=casino&ver=b1`, { headers: { "x-loom-token": mod } })).json()) as { identify: boolean }).identify;
  const identified: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/mod/screen/identify")) identified.push(r.postData() ?? "");
  });
  // An earlier test's Identify may still be up on the Casino (it lasts 10 s).
  await expect.poll(identifying, { timeout: 12_000 }).toBe(false);
  const casino = terminalRow(page, "Casino");
  await casino.getByRole("button", { name: "Identify" }).click();
  await expect(casino.getByRole("group", { name: /The show is live/u })).toBeVisible();
  await fitsThePhone(page, "Identify's ask on a row");
  await shot(page, "identify-ask");
  await casino.getByRole("button", { name: "No", exact: true }).click();
  expect(identified, "No sends nothing").toEqual([]);
  await casino.getByRole("button", { name: "Identify" }).click();
  await casino.getByRole("button", { name: "Test anyway" }).click();
  await expect(page.getByTestId("host-desk-note")).toContainText("Casino shows its name");
  expect(identified).toHaveLength(1);
  expect(identified[0]).toContain("Casino");
  await expect.poll(identifying, { message: "Test anyway reaches the terminal" }).toBe(true);
  // A silent terminal's note claims nothing.
  const attic = terminalRow(page, "Attic");
  await expect(attic).toHaveClass(/alarm/u, { timeout: 25_000 });
  await attic.getByRole("button", { name: "Identify" }).click();
  await attic.getByRole("button", { name: "Test anyway" }).click();
  await expect(page.getByTestId("host-desk-note")).toContainText("Attic isn't answering");

  await tab(page, "setup");
  await page.getByRole("button", { name: /Test tone|Play it|Flash it|Play the look/u }).first().click();
  await expect(page.getByRole("group", { name: /The show is live/u })).toBeVisible();
  await page.getByRole("button", { name: "No", exact: true }).click();
  await ctx.close();
});

test("a small phone, a keyboard's worth of height and a wide screen all fit", async ({ browser }) => {
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 430 }, { width: 844, height: 390 }, { width: 1024, height: 768 }]) {
    const { ctx, page } = await phone(browser, "Adobe Acrobat", size);
    await openDesk(page, mod, "Adobe Acrobat");
    for (const id of ["cues", "house", "setup"]) {
      await tab(page, id);
      await fitsThePhone(page, `${size.width}×${size.height} ${id}`);
    }
    await shot(page, `size-${size.width}x${size.height}`);
    // The panel keeps real room under the top, and STOP ALL stays on screen.
    const panel = await page.locator("#host-desk-panel").boundingBox();
    expect(panel!.height, `${size.width}×${size.height}: the tab's height`).toBeGreaterThan(60);
    await expect(page.locator(".host-desk-stopall")).toBeInViewport();
    await ctx.close();
  }
});
