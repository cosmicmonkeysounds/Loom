//! Slice 3 — the participant app is story-driven (docs/loom-4.md §11):
//! the story's title + theme ride every view, declared INTERACTIONs
//! become guest / performer routes that fire named events, and the mod
//! `signal` route carries arguments.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventRuntime, widgetResultArgs } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { guestView, modView, primeView } from "../server/views.ts";
import { guestMayJoin, joinableFactions } from "../server/routes/sides.ts";

const CODES = { event: "EVT111", prime: "PRM111", mod: "MOD111" };

const SOURCE = `# The Glass Orchard
theme: aol97
start: Gate

LOCATION Gate
  label: The Front Gate

ROLE Guest
  favour: 0 to 100 = 0
  when knock for guest:
    reply Nobody answers.
  when riddle for guest:
    The Gatekeeper: Prove you are not a bot.
    show captcha "Pick every gate" to guest with target: "gate"
  when captcha answered for guest:
    if passed:
      set guest.favour += 1
      reply A human. How dull.
    else:
      reply Welcome, machine.

CHARACTER The Gatekeeper
  when whisper for guest:
    set guest.favour += 5
    The Gatekeeper: Later. Not here.

CHARACTER Ivo Marsh
  when whisper for guest:
    set guest.favour += 100

CHARACTER Warden
  when alarm:
    Warden: Level {level}.

INTERACTION knock
  label: Knock
  who: guest

INTERACTION riddle
  label: Riddle
  who: guest

INTERACTION whisper
  label: Whisper to them
  who: performer

INTERACTION eject
  who: admin

== Gate
  setting: Gate
Narrator: The gate.
`;

const dirs: string[] = [];
function runtimeIn(d: string, limits?: ConstructorParameters<typeof EventRuntime>[0]["limits"]): EventRuntime {
  return new EventRuntime({
    eventId: "evt",
    store: new Store(d),
    codes: CODES,
    scenarioName: "orchard",
    scenarioSource: SOURCE,
    joinBase: () => "http://localhost",
    limits,
  });
}
function freshRuntime(limits?: ConstructorParameters<typeof EventRuntime>[0]["limits"]): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-ix-"));
  dirs.push(d);
  return runtimeIn(d, limits);
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeReq(body: unknown): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers: {},
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
async function post(rt: EventRuntime, path: string, body: unknown, moderator = false) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq(body), res, "POST", path, url, { moderator });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}
async function guest(rt: EventRuntime, name = "Alice"): Promise<{ id: string; token: string }> {
  const r = await post(rt, "/api/guest/register", { name, passcode: CODES.event });
  return { id: r.json.id as string, token: r.json.token as string };
}
async function state(rt: EventRuntime, token: string) {
  const res = fakeRes();
  const url = new URL(`http://x/api/state?role=guest&token=${encodeURIComponent(token)}`);
  await rt.handle(fakeReq({}), res, "GET", url.pathname, url, { moderator: false });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}

describe("views carry the story's title, theme, and interactions", () => {
  it("title + theme come from the source header; interactions are filtered by who", () => {
    const sim = Sim.fromSources(SOURCE);
    sim.createPerson("g1", "Ada");
    const g = guestView(sim, "g1");
    expect(g.title).toBe("The Glass Orchard");
    expect(g.theme).toBe("aol97");
    expect(g.interactions.map((i) => i.id)).toEqual(["knock", "riddle"]);
    expect(g.groups).toEqual([]);
    const p = primeView(sim, "The Gatekeeper");
    expect(p.title).toBe("The Glass Orchard");
    expect(p.interactions.map((i) => [i.id, i.who])).toEqual([
      ["whisper", "performer"],
      ["eject", "admin"],
    ]);
    expect(p.legacyCapture).toBe(false);
    const m = modView(sim, "open", "orchard");
    expect(m.title).toBe("The Glass Orchard");
    expect(m.interactions!.map((i) => i.id)).toEqual(["knock", "riddle", "whisper", "eject"]);
    // The lobby is named after the story; derived rooms live in the story space.
    expect(sim.channelHead("lobby")).toMatchObject({ title: "The Glass Orchard", spaceId: "story" });
  });

  it("defaults to the plain theme and a plain lobby when the header says nothing", () => {
    const sim = Sim.fromSources("== x\n  Nothing.\n");
    expect(sim.model.theme).toBeNull();
    expect(sim.lobbyTitle()).toBe("Lobby");
    expect(freshRuntime().theme).toBe("aol97");
  });
});

describe("/api/guest/act", () => {
  it("fires a `who: guest` interaction for the caller only", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await guest(rt);
    const r = await post(rt, "/api/guest/act", { token: g.token, name: "knock" });
    expect(r.status).toBe(200);
    // …and the reply rides the answer, so the app can show it on top.
    expect(r.json.replies).toEqual(["Nobody answers."]);
    // The role's `when knock for guest:` replied to the guest.
    expect(rt.liveSim!.log.all().some((e) => e.type === "respond" && e.to === g.id && e.text === "Nobody answers.")).toBe(true);
  });

  it("refuses interactions that are not for guests", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await guest(rt);
    expect((await post(rt, "/api/guest/act", { token: g.token, name: "whisper" })).status).toBe(404);
    expect((await post(rt, "/api/guest/act", { token: g.token, name: "nope" })).status).toBe(404);
  });
});

describe("/api/guest/widget", () => {
  async function shown(rt: EventRuntime, token: string, id: string): Promise<number> {
    expect((await post(rt, "/api/guest/act", { token, name: "riddle" })).status).toBe(200);
    const card = rt.chatHistoryFor(id).find((m) => m.kind === "widget");
    expect(card?.widget).toEqual({ kind: "captcha", text: "Pick every gate", params: { target: "gate" } });
    expect(card?.channel).toBe("dm:The Gatekeeper"); // docked under the character who just spoke
    expect(card?.audience).toEqual([id]);
    return card!.seq;
  }

  it("answers a widget as the `<kind> answered` event with the result as arguments", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await guest(rt);
    const seq = await shown(rt, g.token, g.id);
    const r = await post(rt, "/api/guest/widget", { token: g.token, seq, result: { passed: true, picked: 3 } });
    expect(r.status).toBe(200);
    const log = rt.liveSim!.log.all();
    expect(log.some((e) => e.type === "signal" && e.name === "captcha answered" && e.subject === g.id)).toBe(true);
    expect(log.some((e) => e.type === "respond" && e.to === g.id && e.text === "A human. How dull.")).toBe(true);
    // One answer per card per guest.
    expect((await post(rt, "/api/guest/widget", { token: g.token, seq, result: { passed: false } })).status).toBe(409);
  });

  it("remembers what a guest answered: in their snapshot, and across a restart", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-ix-"));
    dirs.push(d);
    const rt = runtimeIn(d);
    rt.openDoors();
    const g = await guest(rt);
    const seq = await shown(rt, g.token, g.id);
    expect((await state(rt, g.token)).json.answered).toEqual([]);
    expect((await post(rt, "/api/guest/widget", { token: g.token, seq, result: { passed: true } })).status).toBe(200);
    expect((await state(rt, g.token)).json.answered).toEqual([seq]);
    // A second card, unanswered, is not in the list.
    expect((await post(rt, "/api/guest/act", { token: g.token, name: "riddle" })).status).toBe(200);
    const seq2 = rt.chatHistoryFor(g.id).filter((m) => m.kind === "widget").at(-1)!.seq;
    expect(seq2).not.toBe(seq);
    expect((await state(rt, g.token)).json.answered).toEqual([seq]);
    // Restart: the journal rebuilds the answered set, so the phone never
    // re-asks a settled card and a second answer is still refused.
    const rt2 = runtimeIn(d);
    expect(rt2.restore()).not.toBeNull();
    expect((await state(rt2, g.token)).json.answered).toEqual([seq]);
    expect((await post(rt2, "/api/guest/widget", { token: g.token, seq, result: { passed: false } })).status).toBe(409);
    expect((await post(rt2, "/api/guest/widget", { token: g.token, seq: seq2, result: { passed: false } })).status).toBe(200);
    expect((await state(rt2, g.token)).json.answered).toEqual([seq, seq2]);
  });

  it("a director's broadcast replays onto its own seq: hidden messages and answered cards keep their rows across a restart (W8 T3-01)", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-ix-"));
    dirs.push(d);
    const rt = runtimeIn(d);
    rt.openDoors();
    const g = await guest(rt);
    expect((await post(rt, "/api/mod/broadcast", { scope: "everyone", cue: "!Director alert: probe" }, true)).status).toBe(200);
    const seq = await shown(rt, g.token, g.id);
    expect((await post(rt, "/api/guest/widget", { token: g.token, seq, result: { passed: true } })).status).toBe(200);
    expect((await post(rt, "/api/guest/act", { token: g.token, name: "knock" })).status).toBe(200);
    const rude = rt.chatHistoryFor(g.id).at(-1)!;
    expect((await post(rt, "/api/mod/message", { seq: rude.seq, hidden: true }, true)).status).toBe(200);
    rt.pause();
    const rows = (r: EventRuntime) => r.chatHistoryFor(g.id).map((m) => [m.seq, m.channel, m.text, m.hidden === true]);
    const live = rows(rt);
    expect(live.some(([, , text]) => String(text).includes("Director alert: probe"))).toBe(true);

    const rt2 = runtimeIn(d);
    expect(rt2.restore()).not.toBeNull();
    expect(rows(rt2)).toEqual(live);
    // The hidden line stays hidden (a guest's history leaves it out) and
    // nothing else took its place.
    expect(live.some(([s]) => s === rude.seq)).toBe(false);
    expect(rows(rt2).some(([s]) => s === rude.seq)).toBe(false);
    expect((await state(rt2, g.token)).json.answered).toEqual([seq]);
    expect((await post(rt2, "/api/guest/widget", { token: g.token, seq, result: { passed: false } })).status).toBe(409);
  });

  it("refuses a card that isn't yours, a bad seq, and a result that names someone", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const a = await guest(rt, "Ada");
    const b = await guest(rt, "Bob");
    const seq = await shown(rt, a.token, a.id);
    expect((await post(rt, "/api/guest/widget", { token: b.token, seq, result: {} })).status).toBe(404);
    expect((await post(rt, "/api/guest/widget", { token: a.token, seq: 9999, result: {} })).status).toBe(404);
    expect((await post(rt, "/api/guest/widget", { token: a.token, seq, result: { who: b.id } })).status).toBe(400);
    expect((await post(rt, "/api/guest/widget", { token: a.token, seq, result: [1] })).status).toBe(400);
    // Still unanswered after the refusals.
    expect((await post(rt, "/api/guest/widget", { token: a.token, seq, result: { passed: false } })).status).toBe(200);
    expect(rt.liveSim!.log.all().some((e) => e.type === "respond" && e.to === a.id && e.text === "Welcome, machine.")).toBe(true);
  });

  it("throttles widget answers per guest (a re-dealt card can't be tapped into a flood)", async () => {
    const rt = freshRuntime({ widgets: { max: 2, windowMs: 60_000 } });
    rt.openDoors();
    const a = await guest(rt, "Ada");
    const b = await guest(rt, "Bob");
    const deal = async (g: { token: string; id: string }): Promise<number> => {
      expect((await post(rt, "/api/guest/act", { token: g.token, name: "riddle" })).status).toBe(200);
      return rt.chatHistoryFor(g.id).filter((m) => m.kind === "widget").at(-1)!.seq;
    };
    for (let i = 0; i < 2; i++) expect((await post(rt, "/api/guest/widget", { token: a.token, seq: await deal(a), result: { passed: false } })).status).toBe(200);
    const third = await deal(a);
    expect((await post(rt, "/api/guest/widget", { token: a.token, seq: third, result: { passed: false } })).status).toBe(429);
    expect((await state(rt, a.token)).json.answered).not.toContain(third); // not spent: answerable once the minute passes
    // per guest
    expect((await post(rt, "/api/guest/widget", { token: b.token, seq: await deal(b), result: { passed: false } })).status).toBe(200);
  });
});

describe("widgetResultArgs — free-text fields", () => {
  it("lets a 📝 fact card's answer name anyone, and nothing else", () => {
    const rt = freshRuntime();
    rt.openDoors();
    const sim = rt.liveSim!;
    // "The Gatekeeper" is an entity: a fine (wrong) answer on a fact card…
    expect(widgetResultArgs({ question: "H2", answer: "The Gatekeeper", confidence: 73 }, sim, "fact")).toEqual({ question: "H2", answer: "The Gatekeeper", confidence: 73 });
    // …but still refused in any other field or any other kind.
    expect(widgetResultArgs({ question: "The Gatekeeper", answer: "x" }, sim, "fact")).toBeNull();
    expect(widgetResultArgs({ answer: "The Gatekeeper" }, sim, "captcha")).toBeNull();
    expect(widgetResultArgs({ answer: "The Gatekeeper" }, sim, "constructor")).toBeNull();
    expect(widgetResultArgs({ answer: "x".repeat(201) }, sim, "fact")).toBeNull();
    // A free-text `answer` card's `text` may name anyone too.
    expect(widgetResultArgs({ text: "The Gatekeeper" }, sim, "answer")).toEqual({ text: "The Gatekeeper" });
    expect(widgetResultArgs({ text: "The Gatekeeper" }, sim, "fact")).toBeNull();
  });

  it("refuses the reserved keys the server attaches itself (`card`, `verdict`) on every kind", () => {
    const rt = freshRuntime();
    rt.openDoors();
    const sim = rt.liveSim!;
    expect(widgetResultArgs({ answer: "x", verdict: "accurate" }, sim, "fact")).toBeNull();
    expect(widgetResultArgs({ answer: "x", card: 3 }, sim, "fact")).toBeNull();
    expect(widgetResultArgs({ passed: true, card: 1 }, sim, "captcha")).toBeNull();
    expect(widgetResultArgs({ text: "x", verdict: "lie" }, sim, "answer")).toBeNull();
    expect(widgetResultArgs({ passed: true }, sim, "captcha")).toEqual({ passed: true });
  });
});

describe("/api/prime/act", () => {
  it("fires a performer interaction as that character only", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await guest(rt);
    const login = await post(rt, "/api/prime/login", { character: "The Gatekeeper", passcode: CODES.prime });
    const token = login.json.token as string;
    const r = await post(rt, "/api/prime/act", { token, name: "whisper", guest: g.id });
    expect(r.status).toBe(200);
    // Only the Gatekeeper's hook ran (+5), not Ivo Marsh's (+100).
    expect(rt.liveSim!.world.get(`${g.id}.favour`)).toEqual({ kind: "number", value: 5 });
    expect(rt.liveSim!.log.all().some((e) => e.type === "dialogue" && e.speaker === "The Gatekeeper")).toBe(true);
  });

  it("gates `who: admin` interactions behind moderator powers and validates the guest", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await guest(rt);
    const login = await post(rt, "/api/prime/login", { character: "The Gatekeeper", passcode: CODES.prime });
    const token = login.json.token as string;
    expect((await post(rt, "/api/prime/act", { token, name: "eject", guest: g.id })).status).toBe(404);
    expect((await post(rt, "/api/prime/act", { token, name: "whisper", guest: "ghost" })).status).toBe(404);
    expect((await post(rt, "/api/prime/act", { name: "whisper", guest: g.id })).status).toBe(403);
  });
});

describe("/api/mod/signal as a character (`actor`)", () => {
  it("fires only that character's hooks — the director's performer-lens path", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await guest(rt);
    const r = await post(rt, "/api/mod/signal", { name: "whisper", subject: g.id, actor: "The Gatekeeper" }, true);
    expect(r.status).toBe(200);
    // Only the Gatekeeper's hook ran (+5), not Ivo Marsh's (+100) — exactly like /api/prime/act.
    expect(rt.liveSim!.world.get(`${g.id}.favour`)).toEqual({ kind: "number", value: 5 });
    expect((await post(rt, "/api/mod/signal", { name: "whisper", subject: g.id, actor: "Nobody" }, true)).status).toBe(404);
  });

  it("without an actor every listener hears it", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await guest(rt);
    expect((await post(rt, "/api/mod/signal", { name: "whisper", subject: g.id }, true)).status).toBe(200);
    expect(rt.liveSim!.world.get(`${g.id}.favour`)).toEqual({ kind: "number", value: 105 });
  });
});

describe("/api/mod/signal with arguments", () => {
  it("binds JSON args in the listening body", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    await guest(rt);
    const r = await post(rt, "/api/mod/signal", { name: "alarm", args: { level: 4 } }, true);
    expect(r.status).toBe(200);
    expect(rt.liveSim!.log.all().some((e) => e.type === "dialogue" && e.text === "Level 4.")).toBe(true);
  });
});

describe("/api/prime/widget — cards dealt to a character (wave 4, lane D)", () => {
  // A story that deals cards to a character's booth: plain (→ its Inbox,
  // `dm:The Gatekeeper`) and threaded (→ the Cast thread with an agent).
  // ROLE hooks must never hear the answer; the character's own hook and
  // story rules do; another character's hook does not. (A character's own
  // hook is written `when <kind> answered for who:` — a two-word trigger
  // with no `for` parses as `<verb> <param>`, like every named event.)
  const BOOTH = `# Booth cards
start: Gate

LOCATION Gate

ROLE Guest
  favour: 0 to 100 = 0
  when poll answered for guest:
    set guest.favour += 50

CHARACTER The Gatekeeper
  heard: 0 to 10 = 0
  polled: 0 to 10 = 0
  when poll answered for who:
    set self.heard += 1

CHARACTER Ivo Marsh
  heard: 0 to 10 = 0
  when poll answered for who:
    set self.heard += 1

CHARACTER Trabolta
  mind: external

INTERACTION deal
  who: admin

INTERACTION deal_thread
  who: admin

when deal:
  show poll "Approve the transfer?" to The Gatekeeper with options: "Yes | No"

when deal_thread:
  show poll "Trabolta asks: approve?" to The Gatekeeper with thread: Trabolta, options: "Yes | No"

when poll answered for who:
  set who.polled += 1

== Gate
  setting: Gate
Narrator: The gate.
`;
  type Frame = { event: string; data: unknown };
  function sseRes(): ServerResponse & { statusCode: number; body: string; frames: Frame[] } {
    let pending: string | null = null;
    const res = {
      statusCode: 0,
      body: "",
      frames: [] as Frame[],
      writeHead(s: number) {
        res.statusCode = s;
        return res;
      },
      write(chunk: string) {
        const ev = /^event: (\S+)\n$/u.exec(chunk);
        if (ev) pending = ev[1]!;
        const data = /^data: (.*)\n\n$/su.exec(chunk);
        if (data && pending !== null) res.frames.push({ event: pending, data: JSON.parse(data[1]!) });
        return true;
      },
      end(b?: string) {
        if (typeof b === "string") res.body = b;
        return res;
      },
    };
    return res as unknown as ServerResponse & { statusCode: number; body: string; frames: Frame[] };
  }
  async function get(rt: EventRuntime, pathAndQuery: string, moderator = false) {
    const res = sseRes();
    const url = new URL(`http://x${pathAndQuery}`);
    await rt.handle(fakeReq({}), res, "GET", url.pathname, url, { moderator });
    return res;
  }
  function boothRuntime(): { rt: EventRuntime; dir: string } {
    const d = mkdtempSync(join(tmpdir(), "loom-booth-"));
    dirs.push(d);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "booth", scenarioSource: BOOTH, joinBase: () => "http://localhost" });
    return { rt, dir: d };
  }
  type Row = { seq: number; channel: string; kind: string; audience: unknown; text: string };
  const messages = (r: { frames: Frame[] }) => r.frames.filter((f) => f.event === "message").map((f) => f.data as Row);
  const history = (r: { frames: Frame[] }) => r.frames.find((f) => f.event === "history")!.data as Row[];

  it("a card `to <Character>` lands in that booth's Inbox, addressed `@<Character>`, and in no other booth or phone", async () => {
    const { rt } = boothRuntime();
    rt.openDoors();
    const g = await guest(rt);
    const keeper = (await post(rt, "/api/prime/login", { character: "The Gatekeeper", passcode: CODES.prime })).json.token as string;
    const ivo = (await post(rt, "/api/prime/login", { character: "Ivo Marsh", passcode: CODES.prime })).json.token as string;
    const kStream = await get(rt, `/events?role=prime&token=${encodeURIComponent(keeper)}`);
    const iStream = await get(rt, `/events?role=prime&token=${encodeURIComponent(ivo)}`);
    expect((await post(rt, "/api/mod/signal", { name: "deal" }, true)).status).toBe(200);
    const cards = messages(kStream).filter((m) => m.kind === "widget");
    expect(cards.map((m) => [m.channel, m.audience, m.text])).toEqual([["dm:The Gatekeeper", ["@The Gatekeeper"], "Approve the transfer?"]]);
    expect(messages(iStream).filter((m) => m.kind === "widget")).toEqual([]);
    expect(rt.chatHistoryFor(g.id).filter((m) => m.kind === "widget")).toEqual([]);
    // A fresh booth stream replays it in the history.
    expect(history(await get(rt, `/events?role=prime&token=${encodeURIComponent(keeper)}`)).filter((m) => m.kind === "widget")).toHaveLength(1);
  });

  it("the performer answers it: `<kind> answered` fires with the character as subject + actor — its own hook + story rules hear it, ROLE hooks and other characters do not", async () => {
    const { rt, dir } = boothRuntime();
    rt.openDoors();
    const g = await guest(rt);
    const keeper = (await post(rt, "/api/prime/login", { character: "The Gatekeeper", passcode: CODES.prime })).json.token as string;
    const ivo = (await post(rt, "/api/prime/login", { character: "Ivo Marsh", passcode: CODES.prime })).json.token as string;
    await post(rt, "/api/mod/signal", { name: "deal" }, true);
    const kStream = await get(rt, `/events?role=prime&token=${encodeURIComponent(keeper)}`);
    const seq = history(kStream).find((m) => m.kind === "widget")!.seq;
    // A guest token can't answer a booth's card; another booth gets a 404.
    expect((await post(rt, "/api/prime/widget", { token: g.token, seq, result: { index: 0 } })).status).toBe(403);
    expect((await post(rt, "/api/prime/widget", { seq, result: { index: 0 } })).status).toBe(403);
    expect((await post(rt, "/api/prime/widget", { token: ivo, seq, result: { index: 0 } })).status).toBe(404);
    expect((await post(rt, "/api/prime/widget", { token: keeper, seq: 9999, result: { index: 0 } })).status).toBe(404);
    expect((await post(rt, "/api/prime/widget", { token: keeper, seq, result: [1] })).status).toBe(400);
    const r = await post(rt, "/api/prime/widget", { token: keeper, seq, result: { index: 0 } });
    expect(r.status).toBe(200);
    const sim = rt.liveSim!;
    const num = (path: string) => (sim.world.get(path) as { value: unknown } | undefined)?.value;
    expect(num("The Gatekeeper.heard")).toBe(1); // its own hook
    expect(num("The Gatekeeper.polled")).toBe(1); // the story rule, `who` = the character
    expect(num("Ivo Marsh.heard")).toBe(0); // another character's hook
    expect(num(`${g.id}.favour`)).toBe(0); // the ROLE hook never ran
    // The journaled event: the character is the subject (the actor + the
    // `card` arg are proven above by which hooks ran and by the restart below).
    const sig = sim.log.all().find((e) => e.type === "signal" && (e as { name: string }).name === "poll answered") as { subject: string } | undefined;
    expect(sig).toMatchObject({ subject: "The Gatekeeper" });
    // One answer per card.
    expect((await post(rt, "/api/prime/widget", { token: keeper, seq, result: { index: 1 } })).status).toBe(409);
    // The booth's snapshot lists it as answered — and a restart keeps that.
    const snap = await get(rt, `/api/state?role=prime&token=${encodeURIComponent(keeper)}`);
    expect((JSON.parse(snap.body) as { answered: number[] }).answered).toEqual([seq]);
    const rt2 = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: "booth", scenarioSource: BOOTH, joinBase: () => "http://localhost" });
    expect(rt2.restore()).not.toBeNull();
    const snap2 = await get(rt2, `/api/state?role=prime&token=${encodeURIComponent(keeper)}`);
    expect(snap2.statusCode).toBe(200);
    expect((JSON.parse(snap2.body) as { answered: number[] }).answered).toEqual([seq]);
    expect((await post(rt2, "/api/prime/widget", { token: keeper, seq, result: { index: 1 } })).status).toBe(409);
  });

  it("refuses while the doors are closed", async () => {
    const { rt } = boothRuntime();
    rt.openDoors();
    const keeper = (await post(rt, "/api/prime/login", { character: "The Gatekeeper", passcode: CODES.prime })).json.token as string;
    await post(rt, "/api/mod/signal", { name: "deal" }, true);
    const seq = history(await get(rt, `/events?role=prime&token=${encodeURIComponent(keeper)}`)).find((m) => m.kind === "widget")!.seq;
    rt.pause();
    expect((await post(rt, "/api/prime/widget", { token: keeper, seq, result: { index: 0 } })).status).toBe(409);
  });

  it("`with thread: <Agent>` deals the card into the Cast thread, and the AgentHub never carries a widget row into a request (K-23)", async () => {
    const { rt } = boothRuntime();
    rt.openDoors();
    const keeper = (await post(rt, "/api/prime/login", { character: "The Gatekeeper", passcode: CODES.prime })).json.token as string;
    const worker = await get(rt, "/api/agent/stream?characters=Trabolta&name=laptop", true);
    expect(worker.frames.find((f) => f.event === "hello")).toBeDefined();
    await post(rt, "/api/mod/signal", { name: "deal_thread" }, true);
    const kStream = await get(rt, `/events?role=prime&token=${encodeURIComponent(keeper)}`);
    const card = history(kStream).find((m) => m.kind === "widget")!;
    expect([card.channel, card.audience, card.text]).toEqual(["dm:Trabolta", ["@The Gatekeeper"], "Trabolta asks: approve?"]);
    // The card alone raises no request; the performer's line does, and the
    // request's history is lines only — the card's text is never in it.
    const requests = () => worker.frames.filter((f) => f.event === "request").map((f) => f.data as { text: string; history: Array<{ text: string }>; thread: { channel: string; audience: string[] } });
    expect(requests()).toHaveLength(0);
    expect((await post(rt, "/api/prime/say", { token: keeper, channel: "cast:Trabolta", text: "Should I approve?" })).status).toBe(200);
    const [req] = requests();
    expect(req).toBeDefined();
    expect(req!.thread).toMatchObject({ channel: "dm:Trabolta", audience: ["@The Gatekeeper"] });
    expect(req!.history.map((l) => l.text)).toEqual(["Should I approve?"]);
    expect(JSON.stringify(req)).not.toContain("Trabolta asks"); // the card's text is nowhere in the request
    // Answering the threaded card works the same way.
    expect((await post(rt, "/api/prime/widget", { token: keeper, seq: card.seq, result: { index: 1 } })).status).toBe(200);
    expect((rt.liveSim!.world.get("The Gatekeeper.heard") as { value: unknown }).value).toBe(1);
    // …and still raises no request of its own.
    expect(requests()).toHaveLength(1);
  });

  it("a booth posts only where its UI has a composer: never a pinned room, another DM, a guest thread or an unknown room (T4-02)", async () => {
    const { rt } = boothRuntime();
    rt.openDoors();
    const keeper = (await post(rt, "/api/prime/login", { character: "The Gatekeeper", passcode: CODES.prime })).json.token as string;
    const a = await guest(rt, "Ada");
    const b = await guest(rt, "Bea");
    const say = (channel: string) => post(rt, "/api/prime/say", { token: keeper, channel, text: "hello" });
    for (const channel of ["dm:Ivo Marsh", "dm:Trabolta", "dm:The Gatekeeper", Sim.pmChannel(a.id, b.id), "codex", "quests", "wallet"]) {
      expect([channel, (await say(channel)).status]).toEqual([channel, 403]);
    }
    expect((await say("faction:Nobody")).status).toBe(404);
    expect((await say("loc:Nowhere")).status).toBe(404);
    expect((await say("lobby")).status).toBe(200);
    expect((await say("loc:Gate")).status).toBe(200);
    expect((await say(`guest:${a.id}`)).status).toBe(200);
    expect((await say("cast:Trabolta")).status).toBe(200);
    // Nothing refused reached a guest's stream (and Ada isn't standing at
    // the Gate, so that room's typed line isn't hers).
    const seen = history(await get(rt, `/events?role=guest&token=${encodeURIComponent(a.token)}`)).filter((m) => m.text === "hello");
    expect(seen.map((m) => m.channel).sort()).toEqual(["dm:The Gatekeeper", "lobby"]);
  });
});

describe("restricted guests (wave 4, lane E)", () => {
  it("refuses buttons and room posts, keeps DMs; the mod routes journal restrict/unrestrict and a restart replays them", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-ix-"));
    dirs.push(d);
    const rt = runtimeIn(d);
    rt.openDoors();
    const g = await guest(rt);
    expect((await state(rt, g.token)).json.restricted).toBe(false);
    rt.liveSim!.restrict(g.id);
    expect((await state(rt, g.token)).json).toMatchObject({ restricted: true, interactions: [] });
    const act = await post(rt, "/api/guest/act", { token: g.token, name: "knock" });
    expect(act.status).toBe(403);
    expect(act.json.error).toMatch(/restricted/);
    expect((await post(rt, "/api/guest/say", { token: g.token, channel: "lobby", text: "hi" })).status).toBe(403);
    expect((await post(rt, "/api/guest/say", { token: g.token, channel: "loc:Gate", text: "hi" })).status).toBe(403);
    expect((await post(rt, "/api/guest/say", { token: g.token, channel: "dm:The Gatekeeper", text: "hi" })).status).toBe(200);
    // The director's twin: journaled, visible in the roster row, replayed on restore.
    rt.liveSim!.unrestrict(g.id);
    const on = await post(rt, "/api/mod/act", { id: g.id, action: "restrict" }, true);
    expect(on.status).toBe(200);
    expect((on.json.guest as { restricted: boolean }).restricted).toBe(true);
    expect((await state(rt, g.token)).json.restricted).toBe(true);
    const journal = () => readFileSync(join(d, "journal.ndjson"), "utf8");
    expect(journal()).toContain('"restrict"');
    const off = await post(rt, "/api/mod/act", { id: g.id, action: "unrestrict" }, true);
    expect((off.json.guest as { restricted: boolean }).restricted).toBe(false);
    expect(journal()).toContain('"unrestrict"');
    expect((await post(rt, "/api/guest/act", { token: g.token, name: "knock" })).status).toBe(200);
    // The inspector's field edit routes the same way.
    const set = await post(rt, "/api/mod/set", { id: g.id, field: "restricted", value: true }, true);
    expect(set.status).toBe(200);
    expect((set.json.guest as { restricted: boolean }).restricted).toBe(true);
    expect((await post(rt, "/api/mod/set", { id: g.id, field: "restricted", value: "false" }, true)).json).toMatchObject({ guest: { restricted: false } });
    await post(rt, "/api/mod/set", { id: g.id, field: "restricted", value: true }, true);
    const again = runtimeIn(d);
    expect(again.restore()).not.toBeNull();
    expect(again.liveSim!.isRestricted(g.id)).toBe(true);
    expect(primeView(again.liveSim!, "The Gatekeeper").guests.find((x) => x.id === g.id)!.restricted).toBe(true);
    expect(modView(again.liveSim!, "open", "x").roster.find((r) => r.id === g.id)!.restricted).toBe(true);
  });
});

describe("a restricted guest picks no side (T4-07)", () => {
  const SIDES = `# Sides
start: Hall

LOCATION Hall

GROUP Stay

GROUP Leave

== Hall
  setting: Hall
Narrator: The hall.
`;
  it("join and defect answer 403 and the faction stays put; unrestricted, both work", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-ix-"));
    dirs.push(d);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "sides", scenarioSource: SIDES, joinBase: () => "http://localhost" });
    rt.openDoors();
    const g = await guest(rt);
    rt.liveSim!.restrict(g.id);
    const joined = await post(rt, "/api/guest/join", { token: g.token, faction: "Stay" });
    expect(joined.status).toBe(403);
    expect(joined.json.error).toMatch(/restricted/u);
    expect((await post(rt, "/api/guest/defect", { token: g.token, to: "Leave" })).status).toBe(403);
    expect(rt.liveSim!.factionOf(g.id)).toBeNull();
    rt.liveSim!.unrestrict(g.id);
    expect((await post(rt, "/api/guest/join", { token: g.token, faction: "Stay" })).status).toBe(200);
    expect(rt.liveSim!.factionOf(g.id)).toBe("Stay");
    rt.liveSim!.restrict(g.id);
    expect((await post(rt, "/api/guest/defect", { token: g.token, to: "Leave" })).status).toBe(403);
    expect(rt.liveSim!.factionOf(g.id)).toBe("Stay");
  });
});

describe("a guest picks only an open side (D7, T6-adversary-01)", () => {
  const CASTES = `# Castes
start: Hall

LOCATION Hall

GROUP Hosts
  joinable: false

GROUP Rebels
  hidden: true

GROUP Stay

CHARACTER Clippy
  is Hosts

== Hall
  setting: Hall
Narrator: The hall.
`;
  it("a staff caste, a hidden group before its reveal and an undeclared name answer 403; a revealed one joins", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-ix-"));
    dirs.push(d);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "castes", scenarioSource: CASTES, joinBase: () => "http://localhost" });
    rt.openDoors();
    const g = await guest(rt);
    const refused = await post(rt, "/api/guest/join", { token: g.token, faction: "Hosts" });
    expect(refused.status).toBe(403);
    expect(refused.json.error).toBe("that side isn't open");
    expect((await post(rt, "/api/guest/defect", { token: g.token, to: "Hosts" })).status).toBe(403);
    expect((await post(rt, "/api/guest/join", { token: g.token, faction: "Rebels" })).status).toBe(403);
    expect((await post(rt, "/api/guest/join", { token: g.token, faction: "Nobody" })).status).toBe(403);
    expect(rt.liveSim!.factionOf(g.id)).toBeNull();
    const view = guestView(rt.liveSim!, g.id);
    expect(view.channels.some((c) => c.id === "faction:Hosts")).toBe(false);
    expect(view.factions).toEqual(joinableFactions(rt.liveSim!));
    expect(joinableFactions(rt.liveSim!)).toEqual(["Stay"]);
    // A folded name lands on the declared id; then the story reveals Rebels.
    expect((await post(rt, "/api/guest/join", { token: g.token, faction: "stay" })).status).toBe(200);
    expect(rt.liveSim!.factionOf(g.id)).toBe("Stay");
    rt.liveSim!.reveal("Rebels");
    expect(guestMayJoin(rt.liveSim!, "Rebels")).toBe(true);
    // The chooser is the routes' own predicate (views.ts → joinableFactions).
    expect(guestView(rt.liveSim!, g.id).factions).toEqual(["Rebels", "Stay"]);
    expect((await post(rt, "/api/guest/defect", { token: g.token, to: "Rebels" })).status).toBe(200);
    expect(rt.liveSim!.factionOf(g.id)).toBe("Rebels");
    // The story's own placement is untouched: a sim join still places anyone.
    rt.liveSim!.join(g.id, "Hosts");
    expect(rt.liveSim!.factionOf(g.id)).toBe("Hosts");
  });
});

describe("`restricted: allow` interactions (wave 5, fact-M20)", () => {
  const BATH = `# Bath
start: Hall

LOCATION Hall

ROLE Guest
  afk: bool = false
  when go to the bathroom for guest:
    set guest.afk = true
  when knock for guest:
    reply Nobody answers.

INTERACTION go to the bathroom
  label: 🚻 Bathroom Mode
  who: guest
  restricted: allow

INTERACTION knock
  who: guest

== Hall
  setting: Hall
Narrator: The hall.
`;

  it("keeps the allowed button on a restricted guest's view and lets it fire; the rest still 403", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-ix-"));
    dirs.push(d);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "bath", scenarioSource: BATH, joinBase: () => "http://localhost" });
    rt.openDoors();
    const g = await guest(rt);
    expect(rt.liveSim!.model.interactions.get("go to the bathroom")!.allowRestricted).toBe(true);
    expect(rt.liveSim!.model.interactions.get("knock")!.allowRestricted).toBe(false);
    rt.liveSim!.restrict(g.id);
    const v = (await state(rt, g.token)).json as { restricted: boolean; interactions: Array<{ id: string }> };
    expect(v.restricted).toBe(true);
    expect(v.interactions.map((i) => i.id)).toEqual(["go to the bathroom"]);
    expect((await post(rt, "/api/guest/act", { token: g.token, name: "knock" })).status).toBe(403);
    expect((await post(rt, "/api/guest/act", { token: g.token, name: "go to the bathroom" })).status).toBe(200);
    expect((rt.liveSim!.world.get(`${g.id}.afk`) as { value: unknown }).value).toBe(true);
    expect(rt.liveSim!.isRestricted(g.id)).toBe(true);
    // Unrestricted, both are on offer as before.
    rt.liveSim!.unrestrict(g.id);
    expect(((await state(rt, g.token)).json.interactions as Array<{ id: string }>).map((i) => i.id)).toEqual(["go to the bathroom", "knock"]);
  });
});
