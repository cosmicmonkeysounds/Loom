//! Trapped in the Internet — wave 13 integration: the show's story text
//! against the merged server, through the event runtime's own routes (the
//! same calls the Play app makes).
//!
//! - D11, one home per broadcast: one "ALL PROGRAMS" press reaches a guest's
//!   phone as exactly one message and one Web Push (no `# system-log` copy),
//!   and a host booth's stream once.
//! - The host drawer's 🚻 End Bathroom Mode: the header's ROLE `watch:` line
//!   on `program.afk` puts a Bathroom Mode flag on the host view's person
//!   row (what `play/src/host/model.ts` `inBathroom` reads), and the drawer's
//!   call (the story's own `back from the bathroom` on the guest, from a host
//!   part's token) ends it.
//! - The show's copy names the wave 13 chrome (⊞ Start, the Choose your side
//!   card), never the pass page's old buttons, ☰ or a profile sheet, and
//!   the tour's `bathroom:` blurb reaches the phone whole.
//! - SIGNOFF-w13 §8 stays the app's own words: every tour step's title and
//!   text in `play/src/tutorial.tsx`, the pass hint and the Leave question.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { PushSender } from "../server/push.ts";
import type { HostView } from "../src/host-board.ts";
import { scenarioFiles, scenarioSource } from "../examples/load.ts";
import { guestView } from "../server/views.ts";
import { Sim } from "../src/runtime/sim/index.ts";

const SRC = scenarioSource("trapped-in-the-internet");
const SLOW = 120_000;
const CODES = { event: "EVT913", prime: "PRM913", mod: "MOD913" };

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeReq(body: unknown, headers: Record<string, string> = {}): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers,
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
  } as unknown as IncomingMessage;
}

function fakeRes() {
  let buf = "";
  const res = {
    statusCode: 0,
    body: "",
    headers: {} as Record<string, string>,
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    setHeader(k: string, v: string) {
      res.headers[k] = v;
    },
    write(c: unknown) {
      buf += String(c);
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
    /** Every SSE frame so far, parsed. */
    frames(): Array<[string, unknown]> {
      return buf
        .split("\n\n")
        .map((bl) => {
          const ev = /^event: (.*)$/mu.exec(bl)?.[1];
          const d = /^data: (.*)$/mu.exec(bl)?.[1];
          return ev !== undefined && d !== undefined ? ([ev, JSON.parse(d)] as [string, unknown]) : null;
        })
        .filter((f): f is [string, unknown] => f !== null);
    },
  };
  return res;
}

type Res = ReturnType<typeof fakeRes>;

async function call(rt: EventRuntime, method: string, p: string, body: unknown = {}, o: { moderator?: boolean; token?: string } = {}) {
  const url = new URL(`http://x${p}`);
  const res = fakeRes();
  await rt.handle(fakeReq(body, o.token ? { "x-loom-token": o.token } : {}), res as unknown as ServerResponse, method, url.pathname, url, { moderator: o.moderator ?? false });
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.body || "{}") as Record<string, unknown>;
  } catch {
    /* a stream */
  }
  return { status: res.statusCode, json, res };
}

/** A stream that stays open (the handler resolves once the hello is out). */
function stream(rt: EventRuntime, query: string): { open: Promise<void>; res: Res } {
  const res = fakeRes();
  const url = new URL(`http://x/events?${query}`);
  const open = rt.handle(fakeReq(null), res as unknown as ServerResponse, "GET", "/events", url, {});
  return { open: Promise.resolve(open).then(() => undefined), res };
}

function runtime(push?: PushSender, hostViewMs?: number): EventRuntime {
  const dir = mkdtempSync(join(tmpdir(), "loom-trapped-w13i-"));
  dirs.push(dir);
  return new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: "trapped-in-the-internet", scenarioSource: SRC, joinBase: () => "http://localhost", ...(push ? { push } : {}), ...(hostViewMs !== undefined ? { hostViewMs } : {}) });
}

const mod = (rt: EventRuntime, name: string, extra: Record<string, unknown> = {}) => call(rt, "POST", "/api/mod/signal", { name, ...extra }, { moderator: true });

/** Register a pool program and walk it through the door: the CAPTCHA, the
 *  problem, the deposit box, an Antivirus scan. */
async function arrive(rt: EventRuntime, name: string): Promise<{ id: string; token: string }> {
  const g = await call(rt, "POST", "/api/guest/register", { name, passcode: CODES.event });
  expect(g.status, name).toBe(200);
  const id = g.json["id"] as string;
  const token = g.json["token"] as string;
  await mod(rt, "captcha answered", { subject: id, args: { passed: false } });
  expect((await call(rt, "POST", "/api/guest/choose", { index: 0 }, { token })).status).toBe(200);
  expect((await call(rt, "POST", "/api/guest/choose", { index: 0 }, { token })).status).toBe(200);
  expect((await call(rt, "POST", "/api/mod/scan", { as: "Norton Anti-Virus", target: id }, { moderator: true })).status).toBe(200);
  expect(rt.liveSim!.world.peek(`${id}.cleared`)).toMatchObject({ value: true });
  return { id, token };
}

/** The `message` frames on a stream whose text names the summons. */
const summons = (res: Res) =>
  res
    .frames()
    .filter(([e, d]) => e === "message" && /ALL PROGRAMS: report to the Desktop/u.test((d as { text?: string }).text ?? ""))
    .map(([, d]) => d as { channel: string; alert?: boolean; text: string });

/** What `play/src/host/model.ts` `isBathroomFlag` matches (kept in step by hand). */
const isBathroomFlag = (f: { label: string; path: string }) => /(^|\.)afk$/iu.test(f.path.trim()) || /bathroom/iu.test(f.label);

describe("Trapped in the Internet — wave 13 integration: one broadcast, one post, one push (D11)", () => {
  it("📣 call_to_the_desktop reaches a cleared guest's phone as one lobby message and one push; a host booth sees it once", { timeout: SLOW }, async () => {
    const sent: Array<{ endpoint: string; kind: string; body: string }> = [];
    const sender: PushSender = {
      publicKey: "BPUBLIC",
      async send(s, payload) {
        const p = JSON.parse(payload) as { kind: string; body: string };
        sent.push({ endpoint: s.endpoint, kind: p.kind, body: p.body });
        return 201;
      },
    };
    const rt = runtime(sender);
    rt.openDoors();
    const g = await arrive(rt, "Calculator");
    const phone = stream(rt, `role=guest&token=${encodeURIComponent(g.token)}`);
    await phone.open;
    const host = (await call(rt, "POST", "/api/prime/login", { character: "Task Manager", passcode: CODES.prime })).json["token"] as string;
    const booth = stream(rt, `role=prime&token=${encodeURIComponent(host)}`);
    await booth.open;
    const endpoint = "https://fcm.googleapis.com/fcm/send/w13-guest";
    expect((await call(rt, "POST", "/api/push/subscribe", { subscription: { endpoint, keys: { p256dh: "p", auth: "a" } } }, { token: g.token })).status).toBe(200);
    await call(rt, "POST", "/api/push/visible", { endpoint, hidden: true }, { token: g.token });
    await rt.push.settle();
    sent.length = 0;

    expect((await mod(rt, "call_to_the_desktop")).status).toBe(200);
    await rt.push.settle();

    const onPhone = summons(phone.res);
    expect(onPhone, JSON.stringify(onPhone)).toHaveLength(1);
    expect(onPhone[0]!.channel).toBe("lobby");
    expect(onPhone[0]!.alert).toBe(true);
    // No channel anywhere is a system log, and the phone was sent nothing else that names the summons.
    expect(phone.res.frames().some(([e, d]) => e === "message" && /system/iu.test((d as { channel: string }).channel))).toBe(false);
    const pushed = sent.filter((s) => s.endpoint === endpoint && /ALL PROGRAMS/u.test(s.body));
    expect(pushed, JSON.stringify(sent)).toHaveLength(1);
    expect(pushed[0]!.kind).toBe("alert");
    expect(sent.filter((s) => s.endpoint === endpoint && s.kind === "alert")).toHaveLength(1);
    // Nothing else of the press reached the phone's push either (no second kind, no objective push).
    expect(sent.filter((s) => s.endpoint === endpoint), JSON.stringify(sent)).toHaveLength(1);
    expect(summons(booth.res)).toHaveLength(1);

    // A second press is refused by the story (once only): still one post, one push.
    await mod(rt, "call_to_the_desktop");
    await rt.push.settle();
    expect(summons(phone.res)).toHaveLength(1);
    expect(sent.filter((s) => s.endpoint === endpoint && /ALL PROGRAMS/u.test(s.body))).toHaveLength(1);
  });
});

describe("Trapped in the Internet — wave 13 integration: the host drawer's 🚻 End Bathroom Mode", () => {
  it("a guest in Bathroom Mode carries an on Bathroom flag on the host view; the drawer's call from a host part ends it", { timeout: SLOW }, async () => {
    // Every read sees the step before it (the host view is otherwise rebuilt
    // at most every 2 s while only the log moves — `HOST_VIEW_MS`).
    const rt = runtime(undefined, 0);
    rt.openDoors();
    const g = await arrive(rt, "Winamp");
    const host = (await call(rt, "POST", "/api/prime/login", { character: "Recycling Bin", passcode: CODES.prime })).json;
    expect(host["host"]).toBe(true);
    const token = host["token"] as string;
    const person = async () => {
      const r = await call(rt, "GET", "/api/state?role=mod&host=1", {}, { token });
      expect(r.status).toBe(200);
      return (r.json as unknown as HostView).people.find((p) => p.id === g.id)!;
    };
    const bathroom = (p: Awaited<ReturnType<typeof person>>) => (p.flags ?? []).filter(isBathroomFlag);

    // Before: the flag is off, so the host view (a snapshot's lean flags,
    // contract C3: on, or a failed gate) leaves it out.
    const before = bathroom(await person());
    expect(before).toEqual([]);

    // The guest's own 🚻 (a `who: guest` button, from ⊞ Start).
    expect((await call(rt, "POST", "/api/guest/act", { name: "go to the bathroom" }, { token: g.token })).status).toBe(200);
    expect(rt.liveSim!.world.peek(`${g.id}.afk`)).toMatchObject({ value: true });
    expect(bathroom(await person()).map((f) => f.on)).toEqual([true]);

    // The drawer's 🚻 End Bathroom Mode: `backFromBathroom` in play/src/host/api.ts.
    expect((await call(rt, "POST", "/api/mod/signal", { name: "back from the bathroom", subject: g.id }, { token })).status).toBe(200);
    expect(rt.liveSim!.world.peek(`${g.id}.afk`)).toMatchObject({ value: false });
    expect(bathroom(await person())).toEqual([]);
  });

  it("the flag is a plain ROLE watch item: never a secret slot, never a `for guests` line", () => {
    const files = scenarioFiles("trapped-in-the-internet");
    const header = files.find((f) => f.path === "main.loom")!.source.split("\n").slice(0, 40);
    const line = header.find((l) => l.startsWith("watch:") && /program\.afk as Bathroom Mode/u.test(l));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/for guests/u);
    const secret = files.flatMap((f) => f.source.split("\n")).filter((l) => /^\s+secret:/u.test(l) && !/^\s+secret: (true|false)\s*$/u.test(l));
    for (const l of secret) expect(l.split(/[:,]/u).map((s) => s.trim()), l).not.toContain("afk");
  });
});

/** The cue sheet from the doors to the Y2K clock (as `trapped-w13-objectives` walks it). */
const TO_Y2K = [
  "call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth",
  "close_the_filing", "read_the_results", "read_the_results", "read_the_results", "second_hunt_preview", "start_the_second_hunt",
  "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "trabolta_overshares", "y2k_clock",
];

/** Two programs through the door, in a bare Sim. */
function boot(): Sim {
  const sim = Sim.fromSources(SRC);
  sim.fireBeat("Power On");
  for (const [id, name] of [["g1", "Calculator"], ["g2", "Winamp"]] as const) {
    sim.createPerson(id, name);
    sim.signal("captcha answered", id, { passed: true } as never);
    sim.signal("captcha answered", id, { passed: false } as never);
    const p = sim.pendingChoiceFor(id);
    if (p && p.length === 4) sim.choose(id, 0);
    sim.choose(id, 0);
    sim.scan("Norton Anti-Virus", id);
  }
  return sim;
}

describe("Trapped in the Internet — wave 13 integration: the copy names the new chrome", () => {
  /** Every line of show text (comments out) across the story's files. */
  const showText = () =>
    scenarioFiles("trapped-in-the-internet").flatMap((f) =>
      f.source
        .split("\n")
        .map((l, i) => ({ at: `${f.path}:${i + 1}`, l }))
        .filter(({ l }) => !/^\s*\/\//u.test(l)),
    );

  it("no line sends a guest to the pass for a button, to ☰, a header or a profile sheet", () => {
    const stale = showText().filter(({ l }) => /☰|on (your|their|the) pass (first|before)|tap 🚻 on|from (your|their) profile|in the header|top bar/iu.test(l));
    expect(stale.map((s) => `${s.at}: ${s.l.trim()}`)).toEqual([]);
  });

  it("Bathroom Mode is a guest button (⊞ Start lists it), and Back follows it, as Clippy, the tour and the quest say", () => {
    const text = showText().map((s) => s.l).join("\n");
    expect(text).toMatch(/tap START and turn on BATHROOM MODE/u);
    expect(text).toMatch(/Open Start and tap 🚻 Bathroom Mode first/u);
    expect(text).toMatch(/Bathroom Mode: open Start and tap 🚻 Bathroom Mode/u);
    const sim = boot();
    expect(guestView(sim, "g1").interactions.map((i) => i.label)).toContain("🚻 Bathroom Mode");
    sim.signal("go to the bathroom", "g1");
    expect(guestView(sim, "g1").interactions.map((i) => i.label)).toContain("Back from the bathroom");
  }, SLOW);

  it("the tour's Bathroom Mode step arrives whole: the `bathroom:` blurb is never cut at a comma (the `with k: v` splitter)", () => {
    const sim = Sim.fromSources(SRC);
    const events = [...sim.fireBeat("Power On"), ...sim.createPerson("g1", "Calculator")];
    events.push(...sim.signal("captcha answered", "g1", { passed: true } as never), ...sim.signal("captcha answered", "g1", { passed: false } as never));
    const p = sim.pendingChoiceFor("g1");
    if (p && p.length === 4) events.push(...sim.choose("g1", 0));
    events.push(...sim.choose("g1", 0), ...sim.scan("Norton Anti-Virus", "g1"));
    const tours = events.filter((e): e is Extract<typeof e, { type: "widget" }> => e.type === "widget" && e.widget === "tutorial");
    expect(tours).toHaveLength(1);
    expect(tours[0]!.audience).toEqual(["g1"]);
    expect(tours[0]!.params).toEqual({
      guide: "Clippy",
      bathroom: "Need the bathroom or have to step out? Open Start and tap 🚻 Bathroom Mode first so the Antivirus know you are not hacking the Internet. When you return tap Back from the bathroom in Start.",
    });
  }, SLOW);

  it("at the Y2K hour a factionless program is offered both sides (the Choose your side card the copy names)", () => {
    const sim = boot();
    for (const c of TO_Y2K) sim.signal(c);
    expect((sim.world.get("Night.phase") as { value: unknown }).value).toBe("y2k");
    const g = guestView(sim, "g1");
    expect(g.faction ?? null).toBeNull();
    expect([...(g.factions ?? [])].sort()).toEqual(["The Way Out", "Unlimited Power"]);
  }, SLOW);
});

describe("Trapped in the Internet — wave 13 integration: SIGNOFF §8 is the app's own words", () => {
  const PLAY = join(__dirname, "../../play/src");
  const sheet = () => readFileSync(join(__dirname, "../examples/trapped-in-the-internet/SIGNOFF-w13.md"), "utf8").split("## 8.")[1] ?? "";
  /** The string literals on `key: "…"` lines (a template with `${…}` is checked by its static parts). */
  const literals = (src: string, key: string) => [...src.matchAll(new RegExp(`\\b${key}: (?:"([^"]*)"|\`([^\`]*)\`)`, "gu"))].map((m) => m[1] ?? m[2]!);

  it.skipIf(!existsSync(join(PLAY, "tutorial.tsx")))("every tour step's title and text in play/src/tutorial.tsx is copied into §8, word for word", () => {
    const tour = readFileSync(join(PLAY, "tutorial.tsx"), "utf8").split("export function tutorialSteps")[1]!;
    const s8 = sheet();
    const strings = [...literals(tour, "title"), ...literals(tour, "text")];
    expect(strings.length).toBeGreaterThanOrEqual(20);
    for (const str of strings) for (const part of str.split(/\$\{[^}]*\}/u).map((x) => x.trim()).filter((x) => x.length > 3)) expect(s8, part).toContain(part);
  });

  it.skipIf(!existsSync(join(PLAY, "chrome/pass.tsx")))("the pass hint and the Leave question in §8 are the app's", () => {
    const s8 = sheet();
    const hint = /PASS_HINT = "([^"]*)"/u.exec(readFileSync(join(PLAY, "chrome/pass.tsx"), "utf8"))?.[1];
    expect(hint).toBeDefined();
    expect(s8).toContain(hint!);
    const leave = /return `(Leave the event\?[^`]*)`/u.exec(readFileSync(join(PLAY, "guest/frame.tsx"), "utf8"))?.[1];
    expect(leave).toBeDefined();
    for (const part of leave!.split(/\$\{[^}]*\}/u).map((x) => x.trim()).filter(Boolean)) expect(s8).toContain(part);
  });
});
