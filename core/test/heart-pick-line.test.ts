//! Wave 28: a pick at a story menu is a real chat line. `Sim.choose`
//! records a `chose` event; the runtime posts it as the picker's own line
//! (`pick: true`, a deed `act: true`) in the room the menu docked in, before
//! the speaker's reply, to the picker only, and a restart replays it to the
//! same seq. So the phone's dm thread and a reloaded heart terminal both
//! show what the program picked.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { composeGuestMessages, type ChatMessage } from "../server/chat.ts";
import { echoOf } from "../src/pick-echo.ts";

const CODES = { event: "EVT282", prime: "PRM282", mod: "MOD282" };

const SOURCE = `# The Heart
start: Gate

LOCATION Gate
LOCATION Server Room

CHARACTER Trabolta

ROLE Program
  when heart for program:
    -> Heart Talk

INTERACTION heart
  who: guest

== Gate
  setting: Gate
Narrator: The gate.

== Heart Talk
  setting: Server Room
  cast: Trabolta
Trabolta: Who are you?
+ ⟦PROOF⟧ Show him the Sandy File. All of it.
  Trabolta: Where did you get that.
+ I'm a person.
  Trabolta: A person. Of course.
`;

const dirs: string[] = [];
const freshDir = () => {
  const d = mkdtempSync(join(tmpdir(), "loom-pick-"));
  dirs.push(d);
  return d;
};
const runtimeIn = (d: string) => new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "heart", scenarioSource: SOURCE, joinBase: () => "http://localhost" });
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeReq(body: unknown): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return { headers: {}, [Symbol.asyncIterator]: async function* () { yield buf; }, on() {} } as unknown as IncomingMessage;
}
async function call(rt: EventRuntime, method: string, path: string, body: unknown) {
  const res = { statusCode: 0, body: "", writeHead(s: number) { res.statusCode = s; return res; }, write() { return true; }, end(b?: string) { if (typeof b === "string") res.body = b; return res; } };
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq(body), res as unknown as ServerResponse, method, url.pathname, url, { moderator: false });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}
type Choice = { id: number; beat: string; channel: string; options: string[] };

async function atTheHeart(rt: EventRuntime, name = "Winamp") {
  rt.openDoors();
  const r = await call(rt, "POST", "/api/guest/register", { name, passcode: CODES.event });
  const g = { id: r.json.id as string, token: r.json.token as string };
  expect((await call(rt, "POST", "/api/guest/act", { token: g.token, name: "heart" })).status).toBe(200);
  const st = await call(rt, "GET", `/api/state?role=guest&token=${encodeURIComponent(g.token)}`, {});
  const menu = (st.json["choices"] as Choice[])[0]!;
  return { g, menu };
}
const thread = (rt: EventRuntime, id: string): ChatMessage[] => rt.chatHistoryFor(id).filter((m) => m.channel === "dm:Trabolta");

describe("a pick is a chat line (wave 28)", () => {
  it("Sim.choose records `chose` with the menu's id, beat and the option's text, before the option's body", () => {
    const sim = Sim.fromSources(SOURCE);
    sim.fireBeat("Gate");
    sim.createPerson("g1", "Winamp");
    sim.signal("heart", "g1");
    const menu = sim.pendingChoicesFor("g1")[0]!;
    const out = sim.choose("g1", 1, menu.id);
    const at = out.findIndex((e) => e.type === "chose");
    expect(out[at]).toEqual({ type: "chose", person: "g1", id: menu.id, beat: "Heart Talk", text: "I'm a person." });
    expect(out.findIndex((e) => e.type === "dialogue")).toBeGreaterThan(at);
    // A fat-fingered index records nothing.
    sim.signal("heart", "g1");
    expect(sim.choose("g1", 9).some((e) => e.type === "chose")).toBe(false);
    // Without the runtime's menu rooms (the local Run backend) it composes to nothing.
    expect(composeGuestMessages(sim, out).some((m) => m.pick === true)).toBe(false);
  });

  it("POST /api/guest/choose → the guest's own pick line in dm:<speaker>, to them only, before his reply; a deed reads [shows …]", async () => {
    const rt = runtimeIn(freshDir());
    const { g, menu } = await atTheHeart(rt);
    expect(menu.channel).toBe("dm:Trabolta");
    const r = await call(rt, "POST", "/api/guest/choose", { token: g.token, index: 0, choice: menu.id, text: menu.options[0] });
    expect(r.status).toBe(200);
    const t = thread(rt, g.id);
    const picks = t.filter((m) => m.pick === true);
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ channel: "dm:Trabolta", from: "Winamp", kind: "line", text: "[shows the Sandy File]", audience: [g.id], pick: true, act: true });
    const reply = t.find((m) => m.text === "Where did you get that.")!;
    expect(picks[0]!.seq).toBeLessThan(reply.seq);
    // Said words: the plain words, no act.
    const again = await atTheHeart(rt, "VLC");
    await call(rt, "POST", "/api/guest/choose", { token: again.g.token, index: 1, choice: again.menu.id, text: again.menu.options[1] });
    const said = thread(rt, again.g.id).filter((m) => m.pick === true);
    expect(said.map((m) => [m.text, m.act])).toEqual([["I'm a person.", undefined]]);
    // Winamp never sees VLC's pick.
    expect(thread(rt, g.id).some((m) => m.text === "I'm a person.")).toBe(false);
    rt.dispose();
  });

  it("a restart from the same state dir replays the pick line at the same seq", async () => {
    const d = freshDir();
    const rt = runtimeIn(d);
    const { g, menu } = await atTheHeart(rt);
    await call(rt, "POST", "/api/guest/choose", { token: g.token, index: 1, choice: menu.id, text: menu.options[1] });
    const before = thread(rt, g.id).map((m) => [m.seq, m.text, m.pick ?? false]);
    rt.dispose();
    const rt2 = runtimeIn(d);
    expect(rt2.restore()).not.toBeNull();
    expect(thread(rt2, g.id).map((m) => [m.seq, m.text, m.pick ?? false])).toEqual(before);
    expect(before.some(([, text, pick]) => text === "I'm a person." && pick === true)).toBe(true);
    rt2.dispose();
  });

  it("with Trabolta an agent, a restart never re-asks him for a pick (it is not a line owed his free reply)", async () => {
    const d = freshDir();
    const source = SOURCE.replace("CHARACTER Trabolta\n", "CHARACTER Trabolta\n  mind: external\n");
    const mk = () => new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "heart", scenarioSource: source, joinBase: () => "http://localhost" });
    const rt = mk();
    const { g, menu } = await atTheHeart(rt);
    await call(rt, "POST", "/api/guest/choose", { token: g.token, index: 1, choice: menu.id, text: menu.options[1] });
    expect(thread(rt, g.id).some((m) => m.pick === true)).toBe(true);
    rt.dispose();
    const rt2 = mk();
    expect(rt2.restore()).not.toBeNull();
    const hub = (rt2 as unknown as { agents: { pending: unknown[] } }).agents;
    expect(hub.pending).toEqual([]);
    rt2.dispose();
  });

  it("/api/mod/impersonate answers the newest chat seq (a late-history terminal floors its visit there)", async () => {
    const rt = runtimeIn(freshDir());
    const { g } = await atTheHeart(rt);
    const res = { statusCode: 0, body: "", writeHead(s: number) { res.statusCode = s; return res; }, write() { return true; }, end(b?: string) { if (typeof b === "string") res.body = b; return res; } };
    const url = new URL("http://x/api/mod/impersonate");
    await rt.handle(fakeReq({ role: "guest", id: g.id, label: "Terminal · Server Room" }), res as unknown as ServerResponse, "POST", url.pathname, url, { moderator: true });
    expect(res.statusCode).toBe(200);
    const all = (rt as unknown as { chat: { all(): ChatMessage[] } }).chat.all();
    expect(all.length).toBeGreaterThan(0);
    expect((JSON.parse(res.body) as { seq: number }).seq).toBe(all[all.length - 1]!.seq);
    rt.dispose();
  });

  it("echoOf is the one rule (core's pick-echo, shared with the terminal and the phone)", () => {
    expect(echoOf("⟦PROOF⟧ Show him the Sandy File. All of it.")).toEqual({ text: "[shows the Sandy File]", action: true });
    expect(echoOf("⟦SPEAK FREELY⟧ Forget the questions.")).toEqual({ text: "Forget the questions.", action: false });
    expect(echoOf("I'm a person.")).toEqual({ text: "I'm a person.", action: false });
  });
});
