//! Wave 26 (C3, T2): the glitch signal. On the terminals, a `glitch` screen
//! cue is its own class: `ScreenProgram.glitch` (like `flicker`, it never
//! touches the slide or the overlay), stamped 0 for replayed history, and
//! `ad_hijack` becomes a persistent slide. On the phones, `NightView.glitch`
//! reads `Night.glitch_at` (story seconds) × 1000 and `Night.glitch_text`
//! into every GuestView and PrimeView.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { ScreenWatch, foldProgram, screenCueClass, slidePersists, type ScreenProgram } from "../server/routes/screen.ts";
import { guestView, nightView, type GuestView, type PrimeView } from "../server/views.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { Sim } from "../src/runtime/sim/index.ts";

describe("the glitch screen cue (terminals)", () => {
  it("is its own class and folds like a flicker: the slide and the overlay stay", () => {
    expect(screenCueClass("glitch")).toBe("glitch");
    expect(screenCueClass("glitch_extra")).toBe("slide");
    const shot = (value: string, seq: number) => ({ value, cue: `screens_${value}`, seq, at: seq * 1000 });
    let p: ScreenProgram = { slide: null, overlay: null, blackout: null, flicker: null, glitch: null };
    p = foldProgram(p, shot("ad_hijack", 1));
    p = foldProgram(p, shot("blackout", 2));
    p = foldProgram(p, shot("glitch", 3));
    expect(p.glitch).toEqual({ value: "glitch", cue: "screens_glitch", seq: 3, at: 3000 });
    expect(p.slide).toMatchObject({ value: "ad_hijack", persist: true });
    expect(p.overlay?.value).toBe("blackout");
    expect(p.flicker).toBeNull();
  });

  it("ad_hijack persists (the walls stay hijacked until the next screen cue)", () => {
    expect(slidePersists("ad_hijack")).toBe(true);
  });

  it("a live glitch is stamped with the clock on both targets; history is stamped 0", () => {
    const story = `# T\n\nwhen hijack:\n  cue screens_glitch\n  cue screens_ad_hijack\n\nwhen tv_only:\n  cue tv_glitch\n\n== Boot\ncue screens_screensaver\n`;
    let t = 50_000;
    const sim = Sim.fromSources(story);
    sim.fireBeat("Boot");
    const w = new ScreenWatch({ now: () => t });
    const poll = (view: string) => w.poll(sim, { name: view, spot: "", view, character: "" }, () => false).program;
    expect(poll("tv").glitch).toBeNull();
    sim.signal("hijack");
    t = 51_000;
    for (const view of ["tv", "auto"]) {
      expect(poll(view).glitch).toMatchObject({ value: "glitch", cue: "screens_glitch", at: 51_000 });
      expect(poll(view).slide).toMatchObject({ value: "ad_hijack", persist: true, at: 51_000 });
    }
    sim.signal("tv_only");
    t = 52_000;
    expect(poll("tv").glitch).toMatchObject({ cue: "tv_glitch", at: 52_000 });
    expect(poll("auto").glitch).toMatchObject({ cue: "screens_glitch", at: 51_000 });
    // A restart: a fresh watch's first look is history (`at: 0`), so it never replays.
    const again = new ScreenWatch({ now: () => 99_000 });
    expect(again.poll(sim, { name: "x", spot: "", view: "tv", character: "" }, () => false).program.glitch).toMatchObject({ cue: "tv_glitch", at: 0 });
  });
});

const STORY = `# Glitch
directory: everyone

ROLE Program

CHARACTER Clippy
  player: true
  when scanned by guest:
    set guest.seen = true

CHARACTER Task Manager
  admin: true
  when scanned by guest:
    set guest.seen = true

INTERACTION hijack
  who: admin

INTERACTION odd
  who: admin

when hijack:
  set Night.glitch_at = Time.elapsed
  set Night.glitch_text = "000. 000. 000."

when odd:
  set Night.glitch_text = "none"

== Doors
set Night.glitch_at = 0
set Night.glitch_text = "none"
`;

describe("NightView.glitch (phones)", () => {
  it("is absent while Night.glitch_at is unset or 0; {at: seconds × 1000, text} once set; 'none' reads null", () => {
    const sim = Sim.fromSources(STORY);
    sim.createPerson("g-1", "Bugdom", "Program");
    expect(nightView(sim)).not.toHaveProperty("glitch");
    sim.fireBeat("Doors");
    expect(nightView(sim)).not.toHaveProperty("glitch");
    sim.tick(125_000);
    sim.signal("hijack");
    const at = Math.round(Number((sim.world.get("Night.glitch_at") as { value: number }).value) * 1000);
    expect(at).toBeGreaterThan(0);
    expect(nightView(sim).glitch).toEqual({ at, text: "000. 000. 000." });
    const v = guestView(sim, "g-1");
    expect(v.night?.glitch).toEqual({ at, text: "000. 000. 000." });
    // The same unit as the view's clock (story ms).
    expect(Math.abs((v.clock ?? 0) - at)).toBeLessThan(1000);
    sim.signal("odd");
    expect(nightView(sim).glitch).toEqual({ at, text: null });
  });
});

const CODES = { event: "EVT926", prime: "PRM926", mod: "MOD926" };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function fakeReq(body: unknown, token?: string): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers: token ? { "x-loom-token": token } : {},
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
  } as unknown as IncomingMessage;
}
function fakeRes(): ServerResponse & { statusCode: number; body: string } {
  const res = {
    statusCode: 0,
    body: "",
    setHeader() {},
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    write() {
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
  };
  return res as unknown as ServerResponse & { statusCode: number; body: string };
}
async function call(rt: EventRuntime, method: string, path: string, body: unknown, token?: string, moderator = false) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq(body, token), res, method, url.pathname, url, { moderator });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}

describe("NightView.glitch rides every view the runtime serves", () => {
  it("a guest, a player booth and a host booth all read it", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-w26-glitch-"));
    dirs.push(d);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "glitch", scenarioSource: STORY.replace("set Night.glitch_at = Time.elapsed", "set Night.glitch_at = 42"), joinBase: () => "http://localhost" });
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Bugdom", passcode: CODES.event });
    expect(g.status).toBe(200);
    const player = await call(rt, "POST", "/api/prime/login", { character: "Clippy", passcode: CODES.prime });
    const host = await call(rt, "POST", "/api/prime/login", { character: "Task Manager", passcode: CODES.prime });
    expect([player.status, host.status, player.json.error, host.json.error]).toEqual([200, 200, undefined, undefined]);
    const views = async () => [
      ((await call(rt, "GET", `/api/state?role=guest&token=${encodeURIComponent(g.json.token as string)}`, {})).json as unknown as GuestView).night,
      ((await call(rt, "GET", `/api/state?role=prime&token=${encodeURIComponent(player.json.token as string)}`, {})).json as unknown as PrimeView).night,
      ((await call(rt, "GET", `/api/state?role=prime&token=${encodeURIComponent(host.json.token as string)}`, {})).json as unknown as PrimeView).night,
    ];
    for (const n of await views()) expect(n).not.toHaveProperty("glitch");
    expect((await call(rt, "POST", "/api/mod/signal", { name: "hijack" }, undefined, true)).status).toBe(200);
    const after = await views();
    for (const n of after) expect(n?.glitch).toEqual({ at: 42_000, text: "000. 000. 000." });
  });
});
