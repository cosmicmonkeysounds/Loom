// Wave 53 (docs/loom-w53-contract.md C1, C2, C5, C6): a booth's upload over
// the real runtime and the real show, and the phones' `announce` frame.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { scenarioSource } from "../examples/load.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { spokenAnnounce } from "../server/routes/screen.ts";
import { videoConsentCsv, type VideoConsentView } from "../server/routes/video.ts";
import { Store } from "../server/store.ts";
import type { PrimeView } from "../server/views.ts";

const CODES = { event: "GUEST1", prime: "PRIME1", mod: "MOD111" };
const SRC = scenarioSource("trapped-in-the-internet");
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeReq(body: unknown): IncomingMessage {
  const chunks = [Buffer.from(JSON.stringify(body))];
  return { headers: {}, socket: { remoteAddress: "127.0.0.1" }, on() {}, [Symbol.asyncIterator]: async function* () { yield* chunks; } } as unknown as IncomingMessage;
}
type Frame = { event: string; data: unknown };
function res() {
  let pending: string | null = null;
  const r = {
    statusCode: 200,
    body: "",
    frames: [] as Frame[],
    setHeader() {},
    once() {},
    on() {},
    flushHeaders() {},
    writeHead(s: number) {
      r.statusCode = s;
      return r;
    },
    write(chunk: string) {
      const ev = /^event: (\S+)\n$/u.exec(chunk);
      if (ev) pending = ev[1]!;
      const data = /^data: (.*)\n\n$/su.exec(chunk);
      if (data && pending !== null) r.frames.push({ event: pending, data: JSON.parse(data[1]!) });
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") r.body = b;
      return r;
    },
  };
  return r as unknown as ServerResponse & typeof r;
}
async function post(rt: EventRuntime, path: string, body: unknown, moderator = false) {
  const r = res();
  await rt.handle(fakeReq(body), r, "POST", path, new URL(`http://x${path}`), { moderator });
  return { status: r.statusCode, json: JSON.parse(r.body || "{}") as Record<string, unknown> };
}
async function get(rt: EventRuntime, pathAndQuery: string, moderator = false) {
  const r = res();
  const url = new URL(`http://x${pathAndQuery}`);
  await rt.handle(fakeReq({}), r, "GET", url.pathname, url, { moderator });
  return r;
}
function show(open = true): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-w53-"));
  dirs.push(d);
  const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "titi", scenarioSource: SRC, joinBase: () => "http://localhost" });
  if (open) rt.openDoors();
  return rt;
}
const booth = async (rt: EventRuntime, character: string) => (await post(rt, "/api/prime/login", { character, passcode: CODES.prime })).json.token as string;
const view = async (rt: EventRuntime, token: string) => JSON.parse((await get(rt, `/api/state?role=prime&token=${encodeURIComponent(token)}`)).body) as PrimeView;
type Row = { seq: number; channel: string; kind: string; audience: unknown; text: string; widget?: { kind: string } };
const lines = (r: { frames: Frame[] }) => r.frames.filter((f) => f.event === "message").map((f) => f.data as Row);
const said = (r: { frames: Frame[] }) => r.frames.filter((f) => f.event === "announce").map((f) => f.data as { text?: string; at?: number; stop?: boolean });
const stream = (rt: EventRuntime, role: string, token: string) => get(rt, `/events?role=${role}&token=${encodeURIComponent(token)}`);
const nextCard = (r: { frames: Frame[] }, kind: string) => lines(r).filter((m) => m.widget?.kind === kind).at(-1)!;

describe("wave 53: a booth arrives (C1)", () => {
  it("is due until it reports in, and then stands on rails with its first card", async () => {
    const rt = show();
    const t = await booth(rt, "Norton Anti-Virus");
    const s = await stream(rt, "prime", t);
    expect((await view(rt, t)).arrive).toBe(true);
    expect((await view(rt, t)).cutscene).toBeUndefined();
    expect((await post(rt, "/api/prime/arrive", { token: t })).status).toBe(200);
    const v = await view(rt, t);
    expect(v.arrive).toBeUndefined();
    expect(v.cutscene).toBe(true);
    expect(v.location).toBe("The Optical Drive");
    const card = nextCard(s, "captcha");
    expect(card.audience).toEqual(["@Norton Anti-Virus"]);
    expect(lines(s).find((m) => m.text.includes("Welcome to the computer"))?.audience).toEqual(["@Norton Anti-Virus"]);
    expect(rt.guestCount).toBe(0);
  });

  it("refuses a sign-in with no part and journals one arrival however often it is reported", async () => {
    const rt = show();
    expect((await post(rt, "/api/prime/arrive", { token: "nobody" })).status).toBe(403);
    const t = await booth(rt, "Clippy");
    await post(rt, "/api/prime/arrive", { token: t });
    const len = rt.liveSim!.log.len();
    await post(rt, "/api/prime/arrive", { token: t });
    expect(rt.liveSim!.log.len()).toBe(len);
  });

  it("leaves a booth that never reports exactly as it was", async () => {
    const rt = show();
    const t = await booth(rt, "Clippy");
    await post(rt, "/api/prime/arrive", {});
    expect(rt.liveSim!.cutsceneFor("Clippy")).toBe(false);
    expect((await view(rt, t)).cutscene).toBeUndefined();
  });

  it("works before the doors open: the crew arrives first", async () => {
    const rt = show();
    await post(rt, "/api/mod/stop", {}, true);
    const t = await booth(rt, "Clippy");
    const s = await stream(rt, "prime", t);
    expect((await post(rt, "/api/prime/arrive", { token: t })).status).toBe(200);
    const seq = nextCard(s, "captcha").seq;
    expect((await post(rt, "/api/prime/widget", { token: t, seq, result: { passed: false } })).status).toBe(200);
    const menu = (await view(rt, t)).choices![0]!;
    expect(menu.options[0]).toBe("My debt.");
    expect((await post(rt, "/api/prime/choose", { token: t, index: 0, choice: menu.id, text: menu.options[0] })).status).toBe(200);
    expect((await view(rt, t)).choices![0]!.options[0]).toBe("Deposited.");
  });
});

describe("wave 53: on rails (C2)", () => {
  it("runs a whole upload through the booth's routes and steps off at the inbox card", async () => {
    const rt = show();
    const t = await booth(rt, "Task Manager");
    const s = await stream(rt, "prime", t);
    await post(rt, "/api/prime/arrive", { token: t });
    await post(rt, "/api/prime/widget", { token: t, seq: nextCard(s, "captcha").seq, result: { passed: false } });
    for (const pick of [0, 1]) {
      const menu = (await view(rt, t)).choices![0]!;
      expect((await post(rt, "/api/prime/choose", { token: t, index: pick, choice: menu.id, text: menu.options[pick] })).status).toBe(200);
    }
    // A pick is the part's own line, addressed to its booth.
    expect(lines(s).find((m) => m.text === "I have nothing to leave." || m.text.includes("nothing to leave"))?.audience).toEqual(["@Task Manager"]);
    const polls = lines(s).filter((m) => m.widget?.kind === "poll");
    expect((await post(rt, "/api/prime/widget", { token: t, seq: polls[0]!.seq, result: { choice: "No, leave me out", index: 1 } })).status).toBe(200);
    expect((await post(rt, "/api/prime/widget", { token: t, seq: polls[1]!.seq, result: { choice: "Yes, say them out loud", index: 0 } })).status).toBe(200);
    const email = nextCard(s, "email");
    expect((await post(rt, "/api/prime/widget", { token: t, seq: email.seq, result: { email: "tm@example.com" } })).status).toBe(200);
    const v = await view(rt, t);
    expect(v.cutscene).toBeUndefined();
    expect(v.arrive).toBeUndefined();
    expect(v.letter).toMatchObject({ email: "tm@example.com", asked: true });
    expect(v.answered).toEqual(expect.arrayContaining([polls[0]!.seq, polls[1]!.seq, email.seq]));
    expect(lines(s).some((m) => m.text.includes("Staff door, Task Manager."))).toBe(true);
  });

  it("marks a skipped inbox as asked, with no address on file", async () => {
    const rt = show();
    const t = await booth(rt, "Recycling Bin");
    const s = await stream(rt, "prime", t);
    await post(rt, "/api/prime/arrive", { token: t });
    await post(rt, "/api/prime/widget", { token: t, seq: nextCard(s, "captcha").seq, result: { passed: false } });
    for (const pick of [0, 1]) {
      const menu = (await view(rt, t)).choices![0]!;
      await post(rt, "/api/prime/choose", { token: t, index: pick, choice: menu.id, text: menu.options[pick] });
    }
    await post(rt, "/api/prime/widget", { token: t, seq: nextCard(s, "email").seq, result: { skipped: true } });
    expect((await view(rt, t)).letter).toMatchObject({ email: null, asked: true });
  });

  it("refuses a menu to a part off rails", async () => {
    const rt = show();
    const t = await booth(rt, "Clippy");
    expect((await post(rt, "/api/prime/choose", { token: t, index: 0 })).status).toBe(409);
  });

  it("keeps a part's upload out of the other booths, Task Manager's own thread included", async () => {
    const rt = show();
    const clippy = await booth(rt, "Clippy");
    const tm = await booth(rt, "Task Manager");
    const tmStream = await stream(rt, "prime", tm);
    const s = await stream(rt, "prime", clippy);
    await post(rt, "/api/prime/arrive", { token: clippy });
    await post(rt, "/api/prime/widget", { token: clippy, seq: nextCard(s, "captcha").seq, result: { passed: false } });
    expect(lines(s).some((m) => m.channel === "dm:Task Manager")).toBe(true);
    expect(lines(tmStream).filter((m) => Array.isArray(m.audience) && (m.audience as string[]).includes("@Clippy"))).toEqual([]);
  });

  it("survives a restart: the journal replays a part's rails", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-w53-"));
    dirs.push(d);
    const make = () => new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "titi", scenarioSource: SRC, joinBase: () => "http://localhost" });
    const rt = make();
    rt.openDoors();
    const t = await booth(rt, "Clippy");
    await post(rt, "/api/prime/arrive", { token: t });
    expect(rt.liveSim!.cutsceneFor("Clippy")).toBe(true);
    const again = make();
    await again.restore();
    expect(again.liveSim!.cutsceneFor("Clippy")).toBe(true);
  });

  it("deals a story restart's upload fresh: last run's answers are not this run's", async () => {
    const rt = show();
    const t = await booth(rt, "Clippy");
    const first = await stream(rt, "prime", t);
    await post(rt, "/api/prime/arrive", { token: t });
    const seq = nextCard(first, "captcha").seq;
    await post(rt, "/api/prime/widget", { token: t, seq, result: { passed: false } });
    expect((await view(rt, t)).answered).toContain(seq);
    rt.restart();
    // The sign-in is kept and the part is due again.
    expect((await view(rt, t)).arrive).toBe(true);
    const second = await stream(rt, "prime", t);
    await post(rt, "/api/prime/arrive", { token: t });
    const again = nextCard(second, "captcha").seq;
    expect(again).toBe(seq); // the seqs start over, which is the whole trap
    expect((await view(rt, t)).answered ?? []).not.toContain(again);
    expect((await post(rt, "/api/prime/widget", { token: t, seq: again, result: { passed: false } })).status).toBe(200);
    expect((await view(rt, t)).choices![0]!.options[0]).toBe("My debt.");
  });

  it("frees every part with the director's ⏭", async () => {
    const rt = show();
    const t = await booth(rt, "Clippy");
    await post(rt, "/api/prime/arrive", { token: t });
    expect((await post(rt, "/api/mod/signal", { name: "wave_staff_through" }, true)).status).toBe(200);
    const v = await view(rt, t);
    expect(v.cutscene).toBeUndefined();
    expect(v.arrive).toBeUndefined();
    const late = await booth(rt, "Password Manager");
    expect((await view(rt, late)).arrive).toBeUndefined();
  });
});

describe("wave 53: the 🎥 list (C6)", () => {
  it("lists every part beside the guests, marked staff, in the CSV too", async () => {
    const rt = show();
    const t = await booth(rt, "CRA Agent Software");
    const s = await stream(rt, "prime", t);
    await post(rt, "/api/prime/arrive", { token: t });
    await post(rt, "/api/prime/widget", { token: t, seq: nextCard(s, "captcha").seq, result: { passed: false } });
    for (const pick of [0, 1]) {
      const menu = (await view(rt, t)).choices![0]!;
      await post(rt, "/api/prime/choose", { token: t, index: pick, choice: menu.id, text: menu.options[pick] });
    }
    await post(rt, "/api/prime/widget", { token: t, seq: lines(s).filter((m) => m.widget?.kind === "poll")[0]!.seq, result: { choice: "No, leave me out", index: 1 } });
    const list = JSON.parse((await get(rt, "/api/mod/video", true)).body) as VideoConsentView;
    expect(list.rows.filter((r) => r.staff === true)).toHaveLength(8);
    expect(list.rows.find((r) => r.name === "CRA Agent Software")).toMatchObject({ video: "out", staff: true });
    expect(list.rows.find((r) => r.name === "Clippy")).toMatchObject({ video: "unasked" });
    expect(list.counts).toEqual({ ok: 0, out: 1, unasked: 7 });
    expect(videoConsentCsv(list)).toContain("CRA Agent Software,out,");
  });
});

describe("wave 53: the phones' announce frame (C5)", () => {
  it("carries the story's `do announce` to every guest and booth, live, and never to a mod", async () => {
    const rt = show();
    const g = (await post(rt, "/api/guest/register", { name: "Calculator", passcode: CODES.event })).json.token as string;
    const t = await booth(rt, "Clippy");
    const guest = await stream(rt, "guest", g);
    const prime = await stream(rt, "prime", t);
    const mod = await get(rt, "/events?role=mod", true);
    const before = Date.now();
    await post(rt, "/api/mod/signal", { name: "call_to_the_desktop" }, true);
    for (const s of [guest, prime]) {
      const [a] = said(s);
      expect(a!.text).toBe("All programs, report to the Desktop. A game is about to begin.");
      expect(a!.at).toBeGreaterThanOrEqual(before);
    }
    expect(said(mod)).toEqual([]);
  });

  it("carries a 📣 to everyone, without its alert mark or emoji, and nothing narrower", async () => {
    const rt = show();
    const g = (await post(rt, "/api/guest/register", { name: "Calculator", passcode: CODES.event })).json.token as string;
    const s = await stream(rt, "guest", g);
    await post(rt, "/api/mod/broadcast", { scope: "all", cue: "!📣 Pizza in the Start Bar." }, true);
    await post(rt, "/api/mod/broadcast", { scope: "location(The Desktop)", cue: "Just you lot." }, true);
    await post(rt, "/api/mod/broadcast", { scope: "all", cue: "🔔" }, true);
    expect(said(s).map((a) => a.text)).toEqual(["Pizza in the Start Bar."]);
  });

  it("cuts the phones on 🔇 + the announcement, and only then", async () => {
    const rt = show();
    const g = (await post(rt, "/api/guest/register", { name: "Calculator", passcode: CODES.event })).json.token as string;
    const s = await stream(rt, "guest", g);
    await post(rt, "/api/mod/audio/stop", { announce: false }, true);
    expect(said(s)).toEqual([]);
    await post(rt, "/api/mod/audio/stop", { announce: true }, true);
    expect(said(s)).toEqual([{ stop: true }]);
  });

  it("says what a person would read", () => {
    expect(spokenAnnounce("!!🔔 Go   home.")).toBe("Go home.");
    expect(spokenAnnounce("~Fine 👍🏽 work")).toBe("Fine work");
    expect(spokenAnnounce("🇨🇦")).toBe("");
    expect(spokenAnnounce("x".repeat(400))).toHaveLength(300);
  });
});
