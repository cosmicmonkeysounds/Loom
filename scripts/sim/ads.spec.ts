// The audio ads (wave 59a), on real pages: guest phones, walls, every sacred terminal
// and a host's phone against a scratch server with the real MP3s behind `/media/`.
// Headless Chromium isn't an iPhone and lets anything play, so the phones carry a
// stand-in for iOS's rule (`IOS_RULE`): an element that has never played inside a tap
// is refused. Nothing here proves a real iPhone.
//
//   # a scratch server (scripts/sim/README.md) with LOOM_MEDIA_DIR=~/loom-media and
//   # LOOM_ADS_GAP_S=20-30, or each pop takes 3 to 10 minutes
//   SIM_BASE=http://127.0.0.1:7600 SIM_MOD_CODE=<mod> SIM_GUEST_CODE=<guest> SIM_PRIME_CODE=<prime> SIM_SHOTS=<dir> \
//     pnpm --filter loom-app exec playwright test -c ../scripts/sim/playwright.config.ts 'ads\.spec'
//
// About five minutes. It resets the event at the end, so run it on a scratch server
// you can throw away.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../../editor/node_modules/@playwright/test/index.mjs";
import type { Browser, Page } from "../../editor/node_modules/@playwright/test/index.mjs";

const BASE = (process.env["SIM_BASE"] ?? "").replace(/\/$/u, "");
const MOD = process.env["SIM_MOD_CODE"] ?? "";
const GUEST = process.env["SIM_GUEST_CODE"] ?? "";
const PRIME = process.env["SIM_PRIME_CODE"] ?? "";
const SHOTS = process.env["SIM_SHOTS"] ?? "test-results/ads";
const EVENT = "default";
const API = `${BASE}/e/${EVENT}`;
const json = { "content-type": "application/json" };

/** Keep every audio element the page makes, so the test reads the real clock on it. */
const SPY = () => {
  const made: HTMLAudioElement[] = [];
  const real = window.Audio;
  (window as unknown as { __ads: HTMLAudioElement[] }).__ads = made;
  window.Audio = function (src?: string) {
    const a = new real(src);
    made.push(a);
    return a;
  } as unknown as typeof Audio;
};

/** The stand-in: an element may play by itself only once a tap has played it. It
 *  watches for trusted taps itself: Playwright's own `evaluate` counts as a gesture to
 *  `navigator.userActivation`, so every look at a page would unlock it. */
const IOS_RULE = () => {
  const real = HTMLMediaElement.prototype.play;
  const unlocked = new WeakSet<HTMLMediaElement>();
  let tapped = 0;
  for (const kind of ["touchend", "click"]) {
    window.addEventListener(kind, (e) => void (e.isTrusted && (tapped = Date.now())), { capture: true, passive: true });
  }
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    if (Date.now() - tapped < 1000) unlocked.add(this);
    if (!unlocked.has(this)) return Promise.reject(new DOMException("no gesture", "NotAllowedError"));
    return real.call(this);
  };
};

const sound = (p: Page) =>
  p.evaluate(() => {
    const made = (window as unknown as { __ads?: HTMLAudioElement[] }).__ads ?? [];
    return { elements: made.length, playing: made.filter((a) => !a.paused && a.currentTime > 0 && !a.ended).map((a) => ({ src: a.currentSrc, t: a.currentTime })) };
  });

async function modLogin() {
  const r = await fetch(`${API}/api/mod/login`, { method: "POST", headers: json, body: JSON.stringify({ passcode: MOD }) });
  const { token } = (await r.json()) as { token: string };
  return {
    token,
    post: async (path: string, body: unknown) => (await (await fetch(`${API}${path}`, { method: "POST", headers: { ...json, "x-loom-token": token }, body: JSON.stringify(body) })).json().catch(() => ({}))) as Record<string, unknown>,
    ads: async () => ((await (await fetch(`${API}/api/mod/screen/terminals?token=${encodeURIComponent(token)}`)).json()) as { ads: { on: boolean; aired: number; playing: string | null; running: boolean; hold: string | null } }).ads,
  };
}

/** A program through the arrival, as the evening's bots do it, then its phone. */
async function guest(browser: Browser, name: string, modToken: string): Promise<Page> {
  const post = async (path: string, body: unknown, token: string) => (await (await fetch(`${API}${path}`, { method: "POST", headers: { ...json, "x-loom-token": token }, body: JSON.stringify(body) })).json().catch(() => ({}))) as Record<string, unknown>;
  const g = (await post("/api/guest/register", { name, passcode: GUEST }, "")) as { id: string; token: string };
  expect(g.token, `registering ${name}`).toBeTruthy();
  const get = async <T,>(path: string) => (await (await fetch(`${API}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(g.token)}`, { headers: { "x-loom-token": g.token } })).json()) as T;
  type View = { answered?: number[]; choices?: Array<{ id: string; options: string[] }> };
  const view = () => get<View>("/api/state?role=guest");
  const card = async (kind: string) => {
    const [h, v] = await Promise.all([get<{ messages: Array<{ seq: number; kind: string; widget?: { kind: string } }> }>("/api/history"), view()]);
    return h.messages.filter((m) => m.kind === "widget" && m.widget?.kind === kind && !(v.answered ?? []).includes(m.seq)).at(-1);
  };
  for (const passed of [true, false]) {
    const w = await card("captcha");
    if (w !== undefined) await post("/api/guest/widget", { seq: w.seq, result: { passed } }, g.token);
  }
  for (let i = 0; i < 3; i++) {
    const m = (await view()).choices?.[0];
    if (m === undefined) break;
    await post("/api/guest/choose", { choice: m.id, index: 0, text: m.options[0] }, g.token);
    const a = await card("answer");
    if (a !== undefined) await post("/api/guest/widget", { seq: a.seq, result: { text: "a hint" } }, g.token);
  }
  await post("/api/scan", { target: g.id, as: "Norton Anti-Virus" }, modToken);
  const t = await card("tutorial");
  if (t !== undefined) await post("/api/guest/widget", { seq: t.seq, result: { completed: true, steps: 5 } }, g.token);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(SPY);
  await ctx.addInitScript(IOS_RULE);
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k as string, v as string), ["loom.guest", JSON.stringify({ id: g.id, name, token: g.token, eventId: EVENT })]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await expect(page.locator(".taskbar")).toBeVisible({ timeout: 15_000 });
  return page;
}

async function screen(browser: Browser, query: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
  await ctx.addInitScript(SPY);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/terminal/?code=${encodeURIComponent(MOD)}&${query}`);
  return page;
}

/** A real tap on nothing: the phone's first gesture. */
const tap = (p: Page) => p.touchscreen.tap(195, 6);

test("on real pages: random walls and phones, the sacred terminals never, the sound, the ×, the ▶, a busy phone, Off and On, the end of a track, the doors", async ({ browser }) => {
  test.skip(BASE === "" || MOD === "" || GUEST === "" || PRIME === "", "set SIM_BASE, SIM_MOD_CODE, SIM_GUEST_CODE and SIM_PRIME_CODE");
  test.setTimeout(600_000);
  mkdirSync(SHOTS, { recursive: true });
  const mod = await modLogin();
  await mod.post("/api/mod/start", {});
  await mod.post("/api/mod/signal", { name: "wave_staff_through" });

  // The MP3 is served the way a phone asks for it.
  const whole = await fetch(`${BASE}/media/ads/ad-01-mommy-intro.mp3`, { method: "GET", headers: { range: "bytes=0-1023" } });
  expect(whole.status).toBe(206);
  expect(whole.headers.get("content-type")).toBe("audio/mpeg");
  expect((await whole.arrayBuffer()).byteLength).toBe(1024);

  // Seven phones: two a pop. Ada stays in the scanner, so she never pops.
  const phones: Page[] = [];
  for (const n of ["Ada", "Bea", "Cy", "Dot", "Eve", "Fay", "Gus"]) phones.push(await guest(browser, n, mod.token));
  const [scanning, ...free] = phones as [Page, ...Page[]];
  const booth = await fetch(`${API}/api/prime/login`, { method: "POST", headers: json, body: JSON.stringify({ passcode: PRIME, character: "Task Manager" }) }).then((r) => r.json() as Promise<{ token: string; admin?: boolean; host?: boolean }>);
  const hostCtx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  await hostCtx.addInitScript(([k, v]) => localStorage.setItem(k as string, v as string), ["loom.prime", JSON.stringify({ token: booth.token, character: "Task Manager", admin: booth.admin === true, host: booth.host === true, eventId: EVENT })]);
  const host = await hostCtx.newPage();
  await host.goto(`${BASE}/?role=performer`);

  const walls = [await screen(browser, "spot=start-bar&name=WallA"), await screen(browser, "spot=cpu&name=WallB"), await screen(browser, "spot=hall&name=WallC"), await screen(browser, "spot=ram&name=WallD"), await screen(browser, "spot=backyard&name=WallE")];
  // Every sacred terminal, each with the keys that once let an ad through.
  const sacred = [
    await screen(browser, "view=tv&spot=desktop-tv&name=TV&character=Trabolta&room=The%20Desktop&engine=silent&bleeps=1"),
    await screen(browser, "spot=server-room&name=ServerRoom&room=The%20Server%20Room&engine=silent&bleeps=1"),
    await screen(browser, "spot=server-room-door&name=ServerDoor&bleeps=1"),
    await screen(browser, "spot=tent&name=Tent&announce=1&bleeps=1"),
    await screen(browser, "view=reinstall&spot=hall&name=Kiosk&bleeps=1"),
    await screen(browser, "name=Anon&bleeps=1"),
  ];
  const bad: string[] = [];
  for (const p of [...phones, ...walls]) {
    p.on("console", (m) => {
      if (/Content.Security|Refused to/iu.test(m.text())) bad.push(m.text());
    });
    p.on("pageerror", (e) => bad.push(String(e)));
  }
  for (const p of walls) await p.mouse.click(300, 300);

  const up = async (list: Page[]): Promise<Page[]> => (await Promise.all(list.map(async (p) => ((await p.locator(".ad-spot").count()) > 0 ? p : null)))).filter((p): p is Page => p !== null);
  const noSacred = async () => {
    expect((await up(sacred)).length).toBe(0);
    for (const p of sacred) expect((await sound(p)).playing).toEqual([]);
    await expect(host.locator(".ad-spot")).toHaveCount(0);
    await expect(scanning.locator(".ad-spot")).toHaveCount(0);
  };
  /** The next pop to reach a wall or a phone: who has it. */
  const nextPop = async (timeout: number) => {
    await expect.poll(async () => (await up([...walls, ...free])).length, { timeout, intervals: [250] }).toBeGreaterThan(0);
    await walls[0]!.waitForTimeout(4000); // every picked wall has polled
    return { w: await up(walls), p: await up(free) };
  };

  // The window opens on the story's step. The real chain would land minutes of his
  // lines at once, and the ads wait for those (core's test walks the real show).
  await mod.post("/api/mod/var", { path: "Night.step", value: "8" });
  await scanning.locator('.taskbar [data-tour="scan"]').click();
  await expect(scanning.locator(".scan-layer")).toBeVisible();

  // Pop 1. Nobody has tapped yet, so a phone's ▶ is up, with no sound and no error.
  const one = await nextPop(120_000);
  const first = (await mod.ads()).playing!;
  expect(first).not.toBeNull();
  expect(one.w.length).toBeGreaterThanOrEqual(1);
  expect(one.w.length).toBeLessThanOrEqual(3);
  expect(one.p.length).toBe(2);
  await noSacred();
  await expect(one.w[0]!.locator(".ad-spot")).toContainText(first);
  await expect.poll(async () => (await sound(one.w[0]!)).playing.length).toBe(1);
  await one.w[0]!.screenshot({ path: join(SHOTS, "wall.png") });

  const [untapped, tapped] = one.p as [Page, Page];
  await expect(untapped.locator(".ad-spot-play")).toBeVisible();
  expect((await sound(untapped)).playing).toEqual([]);
  await untapped.screenshot({ path: join(SHOTS, "phone-play.png") });

  // The tap plays it, from where the ad has got to, on one element.
  await untapped.locator(".ad-spot-play").tap();
  await expect.poll(async () => (await sound(untapped)).playing.length).toBe(1);
  expect((await sound(untapped)).playing[0]!.t).toBeGreaterThan(2);
  expect((await sound(untapped)).elements).toBe(1);
  await untapped.screenshot({ path: join(SHOTS, "phone.png") });

  // × is this phone's alone.
  await tapped.locator('.ad-spot [aria-label="Close"]').tap();
  await expect(tapped.locator(".ad-spot")).toHaveCount(0);
  expect((await sound(tapped)).playing).toEqual([]);
  expect((await sound(one.w[0]!)).playing.length).toBe(1);

  // Off stops everything, everywhere, inside a wall's poll.
  await mod.post("/api/mod/screen/ads", { on: false });
  await expect(one.w[0]!.locator(".ad-spot")).toHaveCount(0, { timeout: 3000 });
  await expect(untapped.locator(".ad-spot")).toHaveCount(0, { timeout: 1500 });
  expect((await sound(one.w[0]!)).playing).toEqual([]);
  expect((await sound(untapped)).playing).toEqual([]);
  expect(await mod.ads()).toMatchObject({ on: false, aired: 1, playing: null });

  // Nothing more while it is off, past the longest gap the scratch server draws.
  for (const p of free) await tap(p).catch(() => {});
  await walls[0]!.waitForTimeout(35_000);
  expect(await mod.ads()).toMatchObject({ on: false, aired: 1 });

  // On lets the next go: another ad, to walls and phones drawn afresh, and it really plays.
  await mod.post("/api/mod/screen/ads", { on: true });
  const two = await nextPop(40_000);
  const second = (await mod.ads()).playing!;
  expect(second).not.toBe(first);
  expect(two.p.length).toBe(2);
  await noSacred();
  await expect.poll(async () => (await sound(two.p[0]!)).playing.length).toBe(1);

  // It runs to its end and closes itself, here and on the wall, and the next is its own.
  await expect(two.w[0]!.locator(".ad-spot")).toHaveCount(0, { timeout: 125_000 });
  await expect(two.p[0]!.locator(".ad-spot")).toHaveCount(0, { timeout: 5000 });
  expect((await sound(two.w[0]!)).playing).toEqual([]);

  // Pop 3: paused doors stop one at once, Run says so, and the event's Restart starts a new night.
  await expect.poll(async () => (await mod.ads()).aired, { timeout: 120_000, intervals: [500] }).toBeGreaterThan(2);
  await noSacred();
  await mod.post("/api/mod/stop", {});
  expect(await mod.ads()).toMatchObject({ playing: null, hold: "doors" });
  await mod.post("/api/mod/start", {});
  await mod.post("/api/mod/reset", {});
  await expect.poll(async () => (await mod.ads()).aired).toBe(0);

  expect(bad).toEqual([]);
});
