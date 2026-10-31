// Wave 57 (docs/loom-w48-contract.md C15): 🛡 from the filter. A flagged
// line offers the censor's own capture beside ✂ and Let it go, read with the
// program bound (`while:`, the guest card's rule), never after the ending.
// The press is the booth's ordinary `/api/prime/act`. It leaves the line
// waiting, so ✂ and Let it go still stand. The second half runs the show.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { scenarioSource } from "../examples/load.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { captureFor, type PrimeView } from "../server/views.ts";
import { Sim } from "../src/runtime/sim/index.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const CODES = { event: "EVT657", prime: "PRM657", mod: "MOD657" };
const LABEL = "🛡 Send to the Internet";
const story = (by: string, extra = "") => `# Filter
start: Boot
censor: Censor

LOCATION Lobby
  label: The Lobby

LOCATION The Internet
  prison: true

ROLE Program
  fresh: false

CHARACTER Censor
  listed: true

  when send to the internet for program:
    capture program into The Internet
    reply Logged: {program.name} sent to the Internet.

  when swear_censored for program:
    reply ✂ {program.name}: {list}.

CHARACTER Clerk
  listed: true

INTERACTION send to the internet
  label: ${LABEL}
  who: performer
  by: ${by}
  arm: true
  while: Night.open_season == true and program.captured != true
${extra}
== Boot
  setting: Lobby
Nothing yet.
`;

function fakeReq(body: unknown, headers: Record<string, string> = {}) {
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
  const res = {
    statusCode: 0,
    body: "",
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    setHeader() {},
    write() {
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
  };
  return res as typeof res & ServerResponse;
}

async function call(rt: EventRuntime, method: string, path: string, body: unknown = {}, o: { moderator?: boolean; token?: string } = {}) {
  const url = new URL(`http://x${path}`);
  const res = fakeRes();
  await rt.handle(fakeReq(body, o.token ? { "x-loom-token": o.token } : {}), res, method, url.pathname, url, { moderator: o.moderator ?? false });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}

async function setup(source = story("Censor")) {
  const dir = mkdtempSync(join(tmpdir(), "loom-w57-"));
  dirs.push(dir);
  const rt = new EventRuntime({ eventId: "evt", store: new Store(join(dir, "state")), codes: CODES, scenarioName: "filter", scenarioSource: source, joinBase: () => "http://localhost", houseFile: join(dir, "nowhere", "house.json") });
  rt.openDoors();
  const g = await call(rt, "POST", "/api/guest/register", { name: "Calculator", passcode: CODES.event });
  const guest = { id: g.json["id"] as string, token: g.json["token"] as string };
  const censor = (await call(rt, "POST", "/api/prime/login", { character: "Censor", passcode: CODES.prime })).json["token"] as string;
  return { rt, guest, censor };
}

const say = (rt: EventRuntime, token: string, text: string) => call(rt, "POST", "/api/guest/say", { channel: "lobby", text }, { token });
const lines = async (rt: EventRuntime, token: string) => ((await call(rt, "GET", `/api/state?role=prime&token=${token}`)).json as unknown as PrimeView).filter!.lines;
const setVar = (rt: EventRuntime, path: string, value: string) => call(rt, "POST", "/api/mod/var", { path, value }, { moderator: true });
const press = (rt: EventRuntime, token: string, guest: string) => call(rt, "POST", "/api/prime/act", { name: "send to the internet", guest }, { token });
const SEND = { id: "send to the internet", label: LABEL };

describe("wave 57: a flagged line offers the censor's capture", () => {
  it("only while its `while:` holds for that program", async () => {
    const { rt, guest, censor } = await setup();
    await say(rt, guest.token, "what the hell");
    expect((await lines(rt, censor))[0]?.send).toBeUndefined();
    expect((await setVar(rt, "Night.open_season", "true")).status).toBe(200);
    expect((await lines(rt, censor))[0]?.send).toEqual(SEND);
    rt.dispose();
  });

  it("the press leaves ✂ and Let it go standing: the line waits, 🛡 goes, ✂ still censors it", async () => {
    const { rt, guest, censor } = await setup();
    await setVar(rt, "Night.open_season", "true");
    await say(rt, guest.token, "what the hell");
    const [line] = await lines(rt, censor);
    const sent = await press(rt, censor, guest.id);
    expect(sent.status).toBe(200);
    expect(sent.json["replies"]).toEqual(["Logged: Calculator sent to the Internet."]);
    const after = await lines(rt, censor);
    expect(after.map((l) => l.seq)).toEqual([line!.seq]);
    expect(after[0]?.send).toBeUndefined();
    expect((await call(rt, "POST", "/api/prime/censor", { seq: line!.seq }, { token: censor })).status).toBe(200);
    expect(await lines(rt, censor)).toEqual([]);
    rt.dispose();
  });

  it("goes off every line of that program at once, and no other program's", async () => {
    const { rt, guest, censor } = await setup();
    const other = await call(rt, "POST", "/api/guest/register", { name: "Notepad", passcode: CODES.event });
    await setVar(rt, "Night.open_season", "true");
    await say(rt, guest.token, "what the hell");
    await say(rt, guest.token, "damn it");
    await say(rt, other.json["token"] as string, "darn");
    await press(rt, censor, guest.id);
    expect((await lines(rt, censor)).map((l) => [l.name, l.send !== undefined])).toEqual([
      ["Calculator", false],
      ["Calculator", false],
      ["Notepad", true],
    ]);
    rt.dispose();
  });

  it("not after the ending: ✂ only counts then", async () => {
    const { rt, guest, censor } = await setup();
    await setVar(rt, "Night.open_season", "true");
    await say(rt, guest.token, "what the hell");
    expect((await lines(rt, censor))[0]?.send).toEqual(SEND);
    await setVar(rt, "Night.ended", "true");
    const after = await lines(rt, censor);
    expect(after).toHaveLength(1);
    expect(after[0]?.send).toBeUndefined();
    rt.dispose();
  });

  it("not when the capture is someone else's, or the story has none", async () => {
    const both = await setup(story("Censor, Clerk"));
    await setVar(both.rt, "Night.open_season", "true");
    await say(both.rt, both.guest.token, "what the hell");
    expect((await lines(both.rt, both.censor))[0]?.send).toEqual(SEND);
    both.rt.dispose();
    // (A hook of its own makes a part an actor too, so this one moves the hook.)
    const hook = /  when send to the internet for program:\n.*\n.*\n\n/u;
    const clerks = story("Clerk").replace(hook, "").replace("CHARACTER Clerk\n  listed: true\n", `CHARACTER Clerk\n  listed: true\n\n${hook.exec(story("Clerk"))![0]}`);
    const theirs = await setup(clerks);
    await setVar(theirs.rt, "Night.open_season", "true");
    await say(theirs.rt, theirs.guest.token, "what the hell");
    expect((await lines(theirs.rt, theirs.censor))[0]?.send).toBeUndefined();
    theirs.rt.dispose();
    const none = await setup(story("Censor").replace(LABEL, "📣 Shout at them"));
    await setVar(none.rt, "Night.open_season", "true");
    await say(none.rt, none.guest.token, "what the hell");
    expect((await lines(none.rt, none.censor))[0]?.send).toBeUndefined();
    none.rt.dispose();
  });
});

describe("wave 57: on the show", () => {
  const SLOW = 120_000;
  const PM = "Password Manager";
  const SRC = scenarioSource("trapped-in-the-internet");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = (sim: Sim, p: string): any => (sim.world.get(p) as { value?: unknown } | undefined)?.value;
  function night() {
    const sim = Sim.fromSources(SRC);
    sim.fireBeat("Power On");
    sim.createPerson("g-1", "Napster");
    return sim;
  }

  it("names 🛡 for the Password Manager, and no other button", { timeout: SLOW }, () => {
    const sim = night();
    sim.setVar("Night.bingo_done", "true");
    expect(captureFor(sim, PM)("g-1")).toEqual(SEND);
    expect(captureFor(sim, "Clippy")("g-1")).toBeNull();
    expect(captureFor(sim, PM)("g-unknown")).toBeNull();
  });

  it("before the Bingo round is over it is live only on a marked program, as on the guest card", { timeout: SLOW }, () => {
    const sim = night();
    expect(captureFor(sim, PM)("g-1")).toBeNull();
    sim.setVar("g-1.marked", "true");
    expect(captureFor(sim, PM)("g-1")).toEqual(SEND);
  });

  it("the press is her ordinary capture: their phone locks, her ⭐, then it is off offer", { timeout: SLOW }, () => {
    const sim = night();
    sim.setVar("Night.bingo_done", "true");
    const score = v(sim, `${PM}.score`) as number;
    sim.signal("send to the internet", "g-1", null, PM);
    expect(v(sim, "g-1.corrupted")).toBe(true);
    expect(v(sim, `${PM}.score`)).toBe(score + 20);
    expect(v(sim, "g-1.escort_by")).toBe(PM);
    expect(captureFor(sim, PM)("g-1")).toBeNull();
  });
});
