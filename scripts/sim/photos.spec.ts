// The terminals' photos (wave 59p, docs/loom-w59-photos-contract.md), on real pages
// with Chromium's fake camera, against a scratch server this spec starts and stops
// itself, because a restart is part of the test. It arms from a host's token, sees
// the stills land about 15 s apart, disarms, restarts, opens the Desk on a phone, and
// refuses a guest from every route. About two minutes. Build `play` and `terminal` first.
//
//   SIM_PHOTOS_PORT=7701 SIM_PHOTOS_STATE=<a scratch dir> SIM_SHOTS=<dir> \
//     pnpm --filter loom-app exec playwright test -c ../scripts/sim/playwright.config.ts photos.spec
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../../editor/node_modules/@playwright/test/index.mjs";
import type { Browser, Page } from "../../editor/node_modules/@playwright/test/index.mjs";

const PORT = Number(process.env["SIM_PHOTOS_PORT"] ?? 7701);
const STATE = process.env["SIM_PHOTOS_STATE"] ?? "";
const SHOTS = process.env["SIM_SHOTS"] ?? "test-results/photos";
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/e/default`;
const MOD = "MODPH7";
const PRIME = "PRMPH7";
const EVENT = "EVTPH7";
/** Each test its own state: a booth is one phone's, so a second boot of the same state can't sign in again. */
let state = STATE;
const photosDir = (): string => join(state, "photos", "default");

let server: ChildProcess | null = null;

async function boot(): Promise<void> {
  // Playwright runs from editor/ (the command above).
  const core = join(process.cwd(), "..", "core");
  server = spawn(join(core, "node_modules", ".bin", "tsx"), ["server/server.ts"], {
    cwd: core,
    stdio: "ignore",
    env: { ...process.env, LOOM_PORT: String(PORT), LOOM_HOST: "127.0.0.1", LOOM_STATE_DIR: state, LOOM_MOD_PASS: MOD, LOOM_EVENT_PASS: EVENT, LOOM_PRIME_PASS: PRIME, LOOM_WIKI: "off", LOOM_DB_WAIT: "off", DATABASE_URL: "postgres://nobody@127.0.0.1:1/none", LOOM_FACTS: join(core, "examples/trapped-in-the-internet/facts.json") },
  });
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("the scratch server didn't come up");
}

function halt(): Promise<void> {
  const s = server;
  server = null;
  if (s === null || s.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    s.once("exit", () => resolve());
    s.kill("SIGTERM");
  });
}

async function post(path: string, body: unknown, token?: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token !== undefined ? { "x-loom-token": token } : {}) }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function get(path: string, token: string): Promise<{ status: number; json: Record<string, unknown>; body: Buffer }> {
  const res = await fetch(`${API}${path}`, { headers: { "x-loom-token": token } });
  const body = Buffer.from(await res.arrayBuffer());
  const json = (res.headers.get("content-type") ?? "").includes("json") ? (JSON.parse(body.toString("utf8")) as Record<string, unknown>) : {};
  return { status: res.status, json, body };
}

const shots = (spot: string): string[] => (existsSync(join(photosDir(), spot)) ? readdirSync(join(photosDir(), spot)).filter((f) => f.endsWith(".jpg")).sort() : []);
const timeOf = (f: string): number => Date.parse(f.replace(/^(.*T\d\d)-(\d\d)-(\d\d\.\d{3}Z)\.jpg$/u, "$1:$2:$3"));

/** A JPEG's size, off its SOF marker. */
function jpegSize(b: Buffer): { w: number; h: number } {
  let i = 2;
  while (i < b.length) {
    const marker = b[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xc2) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return { w: 0, h: 0 };
}

/** Each terminal its own context, like its own tablet: one browser's six connections to a
 *  host would go to the first pages' streams, and every page's polls would stall behind them. */
async function terminal(browser: Browser, query: string): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ["camera"], viewport: { width: 800, height: 600 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/terminal/?code=${MOD}&${query}`);
  return page;
}

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

test("the terminals' photos, armed, disarmed and restarted", async ({ browser }) => {
  test.setTimeout(300_000);
  expect(STATE, "SIM_PHOTOS_STATE: an empty scratch dir").not.toBe("");
  state = join(STATE, "night");
  mkdirSync(state, { recursive: true });
  mkdirSync(SHOTS, { recursive: true });
  await boot();
  try {
    const mod = (await post("/api/mod/login", { passcode: MOD })).json["token"] as string;
    await post("/api/mod/start", {}, mod);
    const host = (await post("/api/prime/login", { character: "Task Manager", passcode: PRIME })).json as { token: string };
    const guest = (await post("/api/guest/register", { name: "Winamp", passcode: EVENT })).json["token"] as string;

    const hall = await terminal(browser, "spot=hall");
    await terminal(browser, "spot=cpu&cam=0");
    await terminal(browser, "spot=server-room&crt=1");
    await terminal(browser, "spot=tent");
    await terminal(browser, "spot=desktop-tv");

    // Every terminal reporting, the hall's camera sending, nothing shot.
    await expect.poll(async () => ((await get("/api/mod/screen/terminals", mod)).json["terminals"] as unknown[]).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(5);
    await expect.poll(async () => hall.evaluate(() => document.querySelectorAll("video").length), { timeout: 15_000 }).toBeGreaterThan(0);
    await hall.waitForTimeout(3000);
    const before = await hall.evaluate(() => ({ videos: document.querySelectorAll("video").length, canvases: document.querySelectorAll("canvas").length, images: document.querySelectorAll("img").length }));
    expect(existsSync(photosDir()) ? readdirSync(photosDir()) : []).toEqual([]);

    // Arm it from a host's token: about 15 s apart, 640 × 480, the sacred three silent.
    expect((await post("/api/mod/photos/arm", { armed: true }, host.token)).status).toBe(200);
    await expect.poll(() => shots("hall").length, { timeout: 55_000, intervals: [1000] }).toBeGreaterThanOrEqual(4);
    const files = shots("hall");
    const gaps = files.slice(1).map((f, i) => timeOf(f) - timeOf(files[i]!));
    console.log(`hall: ${files.length} stills, ${gaps.map((g) => (g / 1000).toFixed(1)).join(" / ")} s apart`);
    for (const g of gaps) {
      expect(g).toBeGreaterThan(13_000);
      expect(g).toBeLessThan(17_500);
    }
    const first = readFileSync(join(photosDir(), "hall", files[0]!));
    expect(first[0]).toBe(0xff);
    expect(first[1]).toBe(0xd8);
    console.log(`hall: a still is ${(first.length / 1024).toFixed(0)} KB`, jpegSize(first));
    expect(jpegSize(first).w).toBeGreaterThan(320);
    expect(jpegSize(first).w).toBeLessThanOrEqual(640);
    expect(shots("cpu")).toEqual([]);
    expect(shots("tent")).toEqual([]);
    expect(shots("desktop-tv")).toEqual([]);
    expect(shots("server-room").length).toBeGreaterThanOrEqual(3);
    const polls = (await get("/api/mod/screen/terminals", mod)).json["terminals"] as Array<{ spot: string; photo?: string }>;
    for (const spot of ["tent", "desktop-tv"]) expect(polls.find((p) => p.spot === spot)?.photo, spot).toBeUndefined();

    // Nothing changed on the page.
    expect(await hall.evaluate(() => ({ videos: document.querySelectorAll("video").length, canvases: document.querySelectorAll("canvas").length, images: document.querySelectorAll("img").length }))).toEqual(before);

    const view = (await get("/api/mod/photos", host.token)).json as { armed: boolean; count: number; terminals: Array<{ spot: string; count: number; note: string | null; lastAt: number | null }> };
    const row = (spot: string) => view.terminals.find((t) => t.spot === spot);
    expect(view.armed).toBe(true);
    expect(row("hall")).toMatchObject({ note: null });
    expect(row("hall")!.count).toBeGreaterThanOrEqual(4);
    expect(row("cpu")!.note).toContain("No camera");
    expect(row("tent")).toBeUndefined();
    expect(row("desktop-tv")).toBeUndefined();
    const thumb = await get("/api/mod/photos/thumb?spot=hall", host.token);
    expect(thumb.status).toBe(200);
    expect(thumb.body[0]).toBe(0xff);

    // Disarm: it stops within a poll.
    await post("/api/mod/photos/arm", { armed: false }, host.token);
    await hall.waitForTimeout(3000);
    const stopped = shots("hall").length;
    await hall.waitForTimeout(18_000);
    expect(shots("hall").length).toBe(stopped);

    // Armed again, the arm survives a restart, and the same page carries on.
    await post("/api/mod/photos/arm", { armed: true }, mod);
    await expect.poll(() => shots("hall").length, { timeout: 20_000, intervals: [1000] }).toBeGreaterThan(stopped);
    await halt();
    const restarted = shots("hall").length;
    await boot();
    const mod2 = (await post("/api/mod/login", { passcode: MOD })).json["token"] as string;
    expect((await get("/api/mod/photos", mod2)).json).toMatchObject({ armed: true });
    await expect.poll(() => shots("hall").length, { timeout: 40_000, intervals: [1000] }).toBeGreaterThan(restarted);
    console.log(`after the restart: ${shots("hall").length} stills, still armed`);

    // Every photo route refuses a guest, and nobody else's token reads a thing.
    const guest2 = (await post("/api/guest/register", { name: "Clippit", passcode: EVENT })).json["token"] as string;
    for (const token of [guest, guest2].filter((t): t is string => typeof t === "string")) {
      for (const path of ["/api/mod/photos", "/api/mod/photos/thumb?spot=hall", "/api/mod/photos/download"]) expect((await get(path, token)).status, path).toBe(403);
      for (const [path, body] of [["/api/mod/photos/arm", { armed: false }], ["/api/mod/photos/delete", { confirm: "delete" }], ["/api/mod/photos/shot", { spot: "hall" }]] as const) expect((await post(path, body, token)).status, path).toBe(403);
    }

    // The download is a tar, a director's alone.
    const tarred = await get("/api/mod/photos/download", mod2);
    expect(tarred.status).toBe(200);
    const tarFile = join(SHOTS, "photos.tar");
    writeFileSync(tarFile, tarred.body);
    expect(execFileSync("tar", ["tf", tarFile], { encoding: "utf8" })).toContain("hall/");
    rmSync(tarFile);
  } finally {
    await halt();
  }
});

test("the Desk on a phone: ARMED in red, a thumbnail, and a press makes it safe", async ({ browser }) => {
  test.setTimeout(90_000);
  state = join(STATE, "desk");
  mkdirSync(state, { recursive: true });
  mkdirSync(SHOTS, { recursive: true });
  await boot();
  try {
    const mod = (await post("/api/mod/login", { passcode: MOD })).json["token"] as string;
    await post("/api/mod/start", {}, mod);
    await post("/api/mod/signal", { name: "wave_staff_through" }, mod);
    const host = (await post("/api/prime/login", { character: "Task Manager", passcode: PRIME })).json as { token: string; admin?: boolean; host?: boolean };
    await post("/api/mod/photos/arm", { armed: true }, host.token);
    await terminal(browser, "spot=ram");
    await expect.poll(() => shots("ram").length, { timeout: 25_000, intervals: [500] }).toBeGreaterThanOrEqual(1);

    const auth = { token: host.token, character: "Task Manager", admin: host.admin === true, host: host.host === true, eventId: "default" };
    const pctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
    await pctx.addInitScript(([key, value]) => localStorage.setItem(key as string, value as string), ["loom.prime", JSON.stringify(auth)]);
    const phone = await pctx.newPage();
    await phone.goto(`${BASE}/?role=performer`);
    await phone.getByRole("button", { name: /Desk/u }).first().click({ timeout: 20_000 });
    const panel = phone.getByTestId("host-photos");
    await panel.scrollIntoViewIfNeeded({ timeout: 15_000 });
    await expect(panel.getByRole("button", { name: /ARMED/u })).toBeVisible();
    await expect(panel.locator("img").first()).toBeVisible({ timeout: 15_000 });
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await panel.screenshot({ path: join(SHOTS, "desk-armed.png") });
    await panel.getByRole("button", { name: /ARMED/u }).click({ timeout: 5000 });
    await expect(panel.getByRole("button", { name: /SAFE/u })).toBeVisible();
    await expect.poll(async () => (await get("/api/mod/photos", mod)).json["armed"]).toBe(false);
    await panel.screenshot({ path: join(SHOTS, "desk-safe.png") });
  } finally {
    await halt();
  }
});
