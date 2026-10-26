//! Wave 26 (C6): the game moment route's chat side. `momentLines` returns
//! what one commit said to a program (its `dialogue` events, in order), and
//! the game-only beats (`GAME_ONLY_BEATS`: Escape Attempt, Heart In The
//! Simulation) never become a ChatMessage — no phone thread, booth readout,
//! Run pane or replay holds them. Trabolta chastises an escape even before
//! his reveal, so a `dm:Trabolta` line there would spoil him.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { GAME_ONLY_BEATS, composeGuestMessages, isGameOnlyBeat, momentLines } from "../server/chat.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { foldName } from "../src/parser/names.ts";
import { Sim } from "../src/runtime/sim/index.ts";

const STORY = `# Moments
directory: everyone

ROLE Program
  escapes: 0 to 99 = 0

CHARACTER Trabolta
  hidden: true

CHARACTER Truther Download

CHARACTER Clippy
  when scanned by guest:
    set guest.seen = true

CODEX ILOVEYOU
  text: A love letter.

INTERACTION simulation escape attempt
  who: admin
  act: Anytime
  sequence: false

INTERACTION simulation heart reached
  who: admin
  act: Anytime
  sequence: false

INTERACTION simulation pickup taken
  who: admin
  act: Anytime
  sequence: false

when simulation escape attempt for program:
  set program.escapes += 1
  -> Escape Attempt

when simulation heart reached for program:
  -> Heart In The Simulation

when simulation pickup taken for program:
  unlock ILOVEYOU for program

when program learns ILOVEYOU:
  -> Download

== Escape Attempt
Trabolta: There is no outside, {program.name}.
Trabolta: Back you go.

== Heart In The Simulation
Trabolta: A copy of you, in my heart.
The core beats slowly.

== Download
Truther Download: Something rides along with you now.
`;

describe("GAME_ONLY_BEATS and momentLines (pure)", () => {
  it("names the two game-only beats, folded; owned keys and spelling fold too", () => {
    expect(GAME_ONLY_BEATS).toEqual(["Escape Attempt", "Heart In The Simulation"].map(foldName));
    expect(isGameOnlyBeat("Escape Attempt")).toBe(true);
    expect(isGameOnlyBeat("escape_attempt")).toBe(true);
    expect(isGameOnlyBeat("Trabolta.Heart In The Simulation")).toBe(true);
    expect(isGameOnlyBeat("The Heart")).toBe(false);
    expect(isGameOnlyBeat(null)).toBe(false);
  });

  it("an escape's lines come back from momentLines and never become a message", () => {
    const sim = Sim.fromSources(STORY);
    sim.createPerson("g-1", "Bugdom", "Program");
    sim.createPerson("g-2", "Clippit", "Program");
    const events = sim.signal("simulation escape attempt", "g-1");
    expect(momentLines(events, "g-1")).toEqual([
      { from: "Trabolta", text: "There is no outside, Bugdom." },
      { from: "Trabolta", text: "Back you go." },
    ]);
    expect(momentLines(events, "g-2")).toEqual([]);
    const drafts = composeGuestMessages(sim, events);
    expect(drafts.filter((m) => m.from === "Trabolta" || m.beat === "Escape Attempt")).toEqual([]);
  });

  it("the heart's narration stays out of chat too; a pickup's codex line reaches the phone as usual", () => {
    const sim = Sim.fromSources(STORY);
    sim.createPerson("g-1", "Bugdom", "Program");
    const heart = sim.signal("simulation heart reached", "g-1", { prop: "trabolta-heart" });
    expect(momentLines(heart, "g-1")).toEqual([{ from: "Trabolta", text: "A copy of you, in my heart." }]);
    expect(composeGuestMessages(sim, heart).filter((m) => m.kind === "line" || m.kind === "narration")).toEqual([]);
    const pickup = sim.signal("simulation pickup taken", "g-1", { item: "virus", prop: "virus-disk" });
    expect(momentLines(pickup, "g-1")).toEqual([{ from: "Truther Download", text: "Something rides along with you now." }]);
    expect(composeGuestMessages(sim, pickup).some((m) => m.from === "Truther Download" && m.channel === "dm:Truther Download")).toBe(true);
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

describe("an escape before his reveal leaves no Trabolta line anywhere (the server)", () => {
  it("no GuestView, PrimeView, mod view or chat history holds it, and a restart replays the same", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-w26-moment-"));
    dirs.push(d);
    const make = () => new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "moments", scenarioSource: STORY, joinBase: () => "http://localhost" });
    const rt = make();
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Bugdom", passcode: CODES.event });
    const id = g.json.id as string;
    const booth = await call(rt, "POST", "/api/prime/login", { character: "Clippy", passcode: CODES.prime });
    expect([g.status, booth.status]).toEqual([200, 200]);
    expect((await call(rt, "POST", "/api/mod/signal", { name: "simulation escape attempt", subject: id }, undefined, true)).status).toBe(200);
    expect((await call(rt, "POST", "/api/mod/signal", { name: "simulation heart reached", subject: id }, undefined, true)).status).toBe(200);
    const says = (blob: unknown) => /no outside|Back you go|in my heart|core beats/u.test(JSON.stringify(blob));
    expect(says(rt.chatHistoryFor(id))).toBe(false);
    expect(says((await call(rt, "GET", `/api/state?role=guest&token=${encodeURIComponent(g.json.token as string)}`, {})).json)).toBe(false);
    expect(says((await call(rt, "GET", `/api/state?role=prime&token=${encodeURIComponent(booth.json.token as string)}`, {})).json)).toBe(false);
    expect(says((await call(rt, "GET", "/api/state", {}, undefined, true)).json)).toBe(false);
    // The story still heard it (the journal replays the trust hit).
    expect(rt.liveSim!.world.get(`${id}.escapes`)).toMatchObject({ value: 1 });
    // A restart re-derives chat from the journal: still nothing.
    const again = make();
    expect(again.restore()).not.toBeNull();
    expect(says(again.chatHistoryFor(id))).toBe(false);
    expect(again.liveSim?.world.get(`${id}.escapes`)).toMatchObject({ value: 1 });
  });
});
