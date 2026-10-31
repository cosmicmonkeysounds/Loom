// The audio ads (wave 59a), on real pages: guest phones, a wall terminal, the TV,
// the server-room kiosk and a host's phone against a scratch server with the real
// MP3s behind `/media/`. Headless Chromium isn't an iPhone and lets anything play,
// so the phones carry a stand-in for iOS's rule (`IOS_RULE`): an element that has
// never played inside a tap is refused. Nothing here proves a real iPhone.
//
//   # a scratch server (scripts/sim/README.md) with LOOM_MEDIA_DIR=~/loom-media
//   SIM_BASE=http://127.0.0.1:7600 SIM_MOD_CODE=<mod> SIM_GUEST_CODE=<guest> SIM_PRIME_CODE=<prime> SIM_SHOTS=<dir> \
//     pnpm --filter loom-app exec playwright test -c ../scripts/sim/playwright.config.ts ads
//
// About six minutes: the ads keep their real pace. It resets the event at the
// end, so run it on a scratch server you can throw away.
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

/** The stand-in: an element may play by itself only once a tap has played it. */
const IOS_RULE = () => {
  const real = HTMLMediaElement.prototype.play;
  const unlocked = new WeakSet<HTMLMediaElement>();
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    if ((navigator as unknown as { userActivation?: { isActive: boolean } }).userActivation?.isActive === true) unlocked.add(this);
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

const TO_HUNT2 = ["call_to_the_desktop", "start_the_bingo", "bingo_time", "clippy_on_trabolta", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth", "close_the_filing", "read_the_results", "read_the_results", "read_the_results", "second_hunt_preview", "start_the_second_hunt"];

test("the list on real pages: the sound, the ×, the ▶, a busy phone, Off and On, the end of a track, the doors", async ({ browser }) => {
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

  const phones: Page[] = [];
  for (const n of ["Ada", "Bea", "Cy", "Dot", "Eve", "Fay", "Gus"]) phones.push(await guest(browser, n, mod.token));
  const [scanning, untapped, ...rest] = phones as [Page, Page, ...Page[]];
  const booth = await fetch(`${API}/api/prime/login`, { method: "POST", headers: json, body: JSON.stringify({ passcode: PRIME, character: "Task Manager" }) }).then((r) => r.json() as Promise<{ token: string; admin?: boolean; host?: boolean }>);
  const hostCtx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  await hostCtx.addInitScript(([k, v]) => localStorage.setItem(k as string, v as string), ["loom.prime", JSON.stringify({ token: booth.token, character: "Task Manager", admin: booth.admin === true, host: booth.host === true, eventId: EVENT })]);
  const host = await hostCtx.newPage();
  await host.goto(`${BASE}/?role=performer`);

  const wall = await screen(browser, "spot=start-bar&name=Wall");
  const quiet = await screen(browser, "spot=cpu&name=QuietWall&bleeps=0");
  const tv = await screen(browser, "view=tv&spot=desktop-tv&name=TV&character=Trabolta&room=The%20Desktop&engine=silent");
  const room = await screen(browser, "spot=server-room&name=ServerRoom&room=The%20Server%20Room&engine=silent");
  const bad: string[] = [];
  for (const p of [...phones, wall]) {
    p.on("console", (m) => {
      if (/Content.Security|Refused to/iu.test(m.text())) bad.push(m.text());
    });
    p.on("pageerror", (e) => bad.push(String(e)));
  }
  for (const p of [wall, quiet]) await p.mouse.click(300, 300);

  for (const name of TO_HUNT2) await mod.post("/api/mod/signal", { name });
  // Past the Truther Download, for a shorter wait: the rule itself is in core's test.
  await mod.post("/api/mod/var", { path: "Night.truther_sent", value: "true" });
  await mod.post("/api/mod/var", { path: "Night.truther_at", value: "0" });

  for (const p of rest) await tap(p);
  await scanning.locator('.taskbar [data-tour="scan"]').click();
  await expect(scanning.locator(".scan-layer")).toBeVisible();

  // The first ad: a minute in.
  await expect(wall.locator(".ad-spot")).toBeVisible({ timeout: 90_000 });
  await expect(wall.locator(".ad-spot")).toContainText("Mommy Intro");
  await wall.waitForTimeout(2000);
  const onWall = await sound(wall);
  expect(onWall.playing.map((s) => s.src)).toEqual([`${BASE}/media/ads/ad-01-mommy-intro.mp3`]);
  await wall.screenshot({ path: join(SHOTS, "wall.png") });

  // Four phones were asked, Ada first: she is scanning, so the next in line took it.
  await expect(scanning.locator(".ad-spot")).toHaveCount(0);
  const up = async (): Promise<Page[]> => (await Promise.all(phones.map(async (p) => ((await p.locator(".ad-spot").count()) > 0 ? p : null)))).filter((p): p is Page => p !== null);
  await expect.poll(async () => (await up()).length).toBe(3);
  const heard = await up();
  expect(heard).toContain(untapped);

  // No tap yet: the pop-up stays, with ▶, and no error. The tap plays it.
  await expect(untapped.locator(".ad-spot-play")).toBeVisible();
  expect((await sound(untapped)).playing).toEqual([]);
  await untapped.screenshot({ path: join(SHOTS, "phone-play.png") });
  await untapped.locator(".ad-spot-play").tap();
  await expect.poll(async () => (await sound(untapped)).playing.length).toBe(1);

  // A tapped phone really plays, on one element.
  const tapped = heard.filter((p) => p !== untapped);
  await expect.poll(async () => (await sound(tapped[0]!)).playing.length).toBe(1);
  expect((await sound(tapped[0]!)).elements).toBe(1);
  await tapped[0]!.screenshot({ path: join(SHOTS, "phone.png") });

  // The TV, the server room, a wall ⚙ turned quiet and a host hear nothing.
  for (const p of [tv, room, quiet]) {
    await expect(p.locator(".ad-spot")).toHaveCount(0);
    expect((await sound(p)).playing).toEqual([]);
  }
  await expect(host.locator(".ad-spot")).toHaveCount(0);

  // × is this phone's alone.
  await tapped[0]!.locator('.ad-spot [aria-label="Close"]').tap();
  await expect(tapped[0]!.locator(".ad-spot")).toHaveCount(0);
  expect((await sound(tapped[0]!)).playing).toEqual([]);
  expect((await sound(wall)).playing.length).toBe(1);

  // Off stops everything, everywhere, inside a wall's poll.
  await mod.post("/api/mod/screen/ads", { on: false });
  await expect(wall.locator(".ad-spot")).toHaveCount(0, { timeout: 3000 });
  await expect(untapped.locator(".ad-spot")).toHaveCount(0, { timeout: 1500 });
  expect((await sound(wall)).playing).toEqual([]);
  expect((await sound(untapped)).playing).toEqual([]);
  expect(await mod.ads()).toMatchObject({ on: false, aired: 1, playing: null });

  // Nothing more while it is off, past the next one's time.
  await scanning.locator('[aria-label="Close the scanner"]').click();
  for (const p of phones) await tap(p).catch(() => {});
  await wall.waitForTimeout(215_000);
  expect(await mod.ads()).toMatchObject({ on: false, aired: 1 });

  // On resumes at the next in the list, and the phones have moved on.
  await mod.post("/api/mod/screen/ads", { on: true });
  await expect(wall.locator(".ad-spot")).toContainText("Adobe", { timeout: 8000 });
  await expect.poll(async () => (await up()).length, { timeout: 8000 }).toBe(3);
  const second = await up();
  expect(second).toContain(scanning); // she kept her place in the line
  expect(second.filter((p) => heard.includes(p))).toEqual([]);
  await expect.poll(async () => (await sound(second[0]!)).playing.some((s) => s.src.endsWith("ad-02-adobe.mp3"))).toBe(true);

  // It runs to its end and closes itself, here and on the wall.
  await expect(wall.locator(".ad-spot")).toHaveCount(0, { timeout: 80_000 });
  await expect(second[0]!.locator(".ad-spot")).toHaveCount(0, { timeout: 5000 });
  expect((await sound(wall)).playing).toEqual([]);

  // Paused doors stop one at once; the event's Restart clears the list.
  await mod.post("/api/mod/stop", {});
  expect((await mod.ads()).playing).toBeNull();
  await mod.post("/api/mod/start", {});
  await mod.post("/api/mod/reset", {});
  await expect.poll(async () => (await mod.ads()).aired).toBe(0);

  expect(bad).toEqual([]);
});
