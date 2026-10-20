//! Wave 13 fix round (fperf), on the runtime: the host view's coalescing
//! (`HOST_VIEW_MS`), its lean flags and award gate, and the waiting time of
//! a guest owed an agent's answer across a restart.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { EventRuntime, type EventRuntimeInit } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { HostView } from "../src/host-board.ts";

const CODES = { event: "EVT132", prime: "PRM132", mod: "MOD132" };

const STORY = `# Host Night
start: Opening
watch: program.cleared as Cleared, program.marked as Marked

ROLE Program
  cleared: bool = false
  marked: bool = false
  featured: text = "none"
  when award_painting for program:
    if program.featured != "mspaint":
      broadcast "{program.name} is not MS Paint." to channel(hosts)
    else:
      set Night.award = "painting"

GROUP Hosts
  joinable: false

CHANNEL hosts
  kind: faction
  faction: Hosts

LOCATION Hall

CHARACTER Task Manager
  faction: Hosts
  admin: true

CHARACTER Trabolta
  mind: external
  hold: One moment.

INTERACTION open the doors
  who: admin

INTERACTION award_painting
  who: admin

INTERACTION wave
  who: guest

when wave for program:
  set program.marked = true

== Opening
  setting: Hall
Hello.
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function runtime(extra: Partial<EventRuntimeInit> = {}, dir?: string): EventRuntime {
  const d = dir ?? mkdtempSync(join(tmpdir(), "loom-w13p-"));
  if (dir === undefined) dirs.push(d);
  return new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "host", scenarioSource: STORY, joinBase: () => "http://localhost", ...extra });
}
function fakeReq(body: unknown): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return { headers: {}, [Symbol.asyncIterator]: async function* () { yield buf; }, on() {} } as unknown as IncomingMessage;
}
async function call(rt: EventRuntime, method: "GET" | "POST", path: string, body: Record<string, unknown> = {}, moderator = false): Promise<{ status: number; json: Record<string, unknown> }> {
  let out = "";
  let status = 0;
  const res = { writeHead: (s: number) => ((status = s), res), setHeader() {}, write: () => true, end: (b?: string) => ((out = b ?? ""), res) };
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq(body), res as unknown as ServerResponse, method, url.pathname, url, { moderator });
  return { status, json: JSON.parse(out || "{}") };
}
async function register(rt: EventRuntime, name: string): Promise<{ id: string; token: string }> {
  const r = await call(rt, "POST", "/api/guest/register", { name, passcode: CODES.event });
  expect(r.status).toBe(200);
  return { id: r.json.id as string, token: r.json.token as string };
}
const hostRead = async (rt: EventRuntime): Promise<HostView> => (await call(rt, "GET", "/api/state?role=mod&host=1", {}, true)).json as unknown as HostView;

describe("the host view's coalescing", () => {
  it("only the log moved: the last build stands for 2 s; a cue press or a phase change rebuilds at once", async () => {
    let now = 1_000_000;
    const realNow = Date.now;
    Date.now = () => now;
    try {
      const rt = runtime();
      rt.openDoors();
      const g = await register(rt, "Winamp");
      const flags = async () => (await hostRead(rt)).people.find((p) => p.id === g.id)?.flags?.map((f) => f.label) ?? [];
      expect(await flags()).toEqual(["Cleared"]); // a failed gate; Marked (off) is left out
      expect((await call(rt, "POST", "/api/guest/act", { token: g.token, name: "wave" })).status).toBe(200);
      expect(await flags()).toEqual(["Cleared"]); // within 2 s of the last build
      now += 2_000;
      expect(await flags()).toEqual(["Cleared", "Marked"]);
      // A press is seen at once.
      expect((await hostRead(rt)).cues.last).toBeNull();
      expect((await call(rt, "POST", "/api/mod/signal", { name: "open the doors" }, true)).status).toBe(200);
      expect((await hostRead(rt)).cues.last).toBe("open the doors");
      // A pause too.
      expect((await call(rt, "POST", "/api/mod/stop", {}, true)).status).toBe(200);
      expect((await hostRead(rt)).runtime).toBe("paused");
    } finally {
      Date.now = realNow;
    }
  });

  it("awardOnly names the one program a cue's gate lets take it", async () => {
    const rt = runtime({ hostViewMs: 0 });
    rt.openDoors();
    await register(rt, "Calculator");
    const paint = await register(rt, "MS Paint");
    expect((await hostRead(rt)).awardOnly).toBeUndefined();
    expect((await call(rt, "POST", "/api/mod/var", { path: `${paint.id}.featured`, value: "mspaint" }, true)).status).toBe(200);
    expect((await hostRead(rt)).awardOnly).toEqual({ award_painting: { id: paint.id, name: "MS Paint" } });
  });
});

describe("a guest owed an answer across a restart", () => {
  it("keeps waiting since their first unanswered line, and the queue's oldest wait agrees", async () => {
    let wall = 5_000_000;
    const d = mkdtempSync(join(tmpdir(), "loom-w13p-"));
    dirs.push(d);
    const rt = runtime({ now: () => wall, hostViewMs: 0 }, d);
    rt.openDoors();
    const g = await register(rt, "Winamp");
    expect((await call(rt, "POST", "/api/guest/say", { token: g.token, channel: "dm:Trabolta", text: "are you there?" })).status).toBe(200);
    const first = (await hostRead(rt)).agents[0]!.waiting[0]!.since;
    expect(first).toBe(wall);
    // Ten story seconds on, a second line: still waiting since the first.
    for (let k = 0; k < 10; k++) rt.tickOnce(1000);
    wall += 10_000;
    expect((await call(rt, "POST", "/api/guest/say", { token: g.token, channel: "dm:Trabolta", text: "hello??" })).status).toBe(200);
    expect((await hostRead(rt)).agents[0]!.waiting[0]!.since).toBe(first);
    rt.dispose();
    // The restart, a minute later on the wall.
    wall += 60_000;
    const rt2 = runtime({ now: () => wall, hostViewMs: 0 }, d);
    rt2.restore();
    const v = await hostRead(rt2);
    const since = v.agents[0]!.waiting[0]!.since;
    // The story clock carries the ten seconds: since maps the first line's
    // story time onto the new wall clock (`wall − 10 s`), never "now".
    expect(since).toBeLessThan(wall);
    expect(wall - since).toBeGreaterThanOrEqual(10_000);
    const mod = (await call(rt2, "GET", "/api/state?role=mod", {}, true)).json as { cast: Array<{ id: string; agentQueue?: { oldestMs: number | null } }> };
    expect(mod.cast.find((c) => c.id === "Trabolta")!.agentQueue!.oldestMs).toBe(wall - since);
    rt2.dispose();
  });
});
