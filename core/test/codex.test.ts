//! Codex — knowledge as a currency (Loom 4 §10.1), guest-to-guest private
//! threads (`pm:`), the participants directory, `!` alert broadcasts, and
//! the performer-side privacy scoping that keeps a guest's DMs to one
//! character out of every other booth.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { parse } from "../src/parser/index.ts";
import { statementToDirective } from "../src/parser/statements.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { parseTrigger } from "../src/runtime/sim/model.ts";
import { composeGuestMessages, splitAlert } from "../server/chat.ts";
import { guestView, modView, primeView } from "../server/views.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";

const SOURCE = `# Trapped
directory: everyone
start: Login

GROUP Antivirus
  joinable: false

GROUP The Awakened
  hidden: true

LOCATION The Desktop
  label: The Desktop

ROLE Program
  humanity: 0 to 100 = 0
  when guest learns The Sandy File:
    set guest.humanity += 10
    reply You know about Sandy now.
  when wrong code for guest:
    reply Nothing happens.
  when share for guest:
    reply {from.name} told you something.

CHARACTER Trabolta
  listed: true
  when guest learns Trabolta Wants Omnipotence:
    Trabolta: Who told you that?

CHARACTER Norton
  faction: Antivirus
  listed: true

CHARACTER Cookie Banner
  when scanned by guest:
    unlock The Billboard for guest

CODEX The Sandy File
  about: Trabolta
  code: SANDY-1997
  text:
    Trabolta wants omnipotence to impress Sandy.
    He would rather earn it.

CODEX Trabolta Wants Omnipotence
  about: Trabolta
  known to: Norton
  text: The Unified Field Theory is nearly solved.

CODEX The Billboard
  about: World
  text: A neglected billboard on Barrington Street.

== Login
  setting: The Desktop
Narrator: Welcome.
broadcast "!Come to the Desktop." to everyone
`;

function fresh(): Sim {
  return Sim.fromSources(SOURCE);
}
const replies = (evs: SimEvent[]): string[] => evs.filter((e) => e.type === "respond").map((e) => (e as { text: string }).text);

describe("CODEX declaration", () => {
  it("parses title / about / code / known to / a text block", () => {
    const [file, diags] = parse(SOURCE);
    expect(diags.filter((d) => d.severity === "error")).toEqual([]);
    const decls = file.items.filter((i) => i.kind === "declaration").map((i) => i.value);
    const sandy = decls.find((d) => d.name === "The Sandy File")!;
    expect(sandy.kind).toBe("codex");
    expect(sandy.codex!.about).toBe("Trabolta");
    expect(sandy.codex!.code).toBe("SANDY-1997");
    expect(sandy.codex!.text).toBe("Trabolta wants omnipotence to impress Sandy.\nHe would rather earn it.");
    const omni = decls.find((d) => d.name === "Trabolta Wants Omnipotence")!;
    expect(omni.codex!.knownTo).toEqual(["Norton"]);
    expect(omni.codex!.text).toBe("The Unified Field Theory is nearly solved.");
  });

  it("compiles into the model with folded codes and a subject that holds its own entries", () => {
    const sim = fresh();
    expect([...sim.model.codex.keys()]).toEqual(["The Sandy File", "Trabolta Wants Omnipotence", "The Billboard"]);
    expect(sim.model.codexCodes.get("sandy1997")).toBe("The Sandy File");
    expect(sim.model.codex.get("Trabolta Wants Omnipotence")!.knownTo).toEqual(["Trabolta", "Norton"]);
    expect(sim.holdsCodex("Trabolta", "the sandy file")).toBe(true);
    expect(sim.holdsCodex("Norton", "Trabolta Wants Omnipotence")).toBe(true);
    expect(sim.holdsCodex("Norton", "The Sandy File")).toBe(false);
    expect(sim.model.directory).toBe("everyone");
    expect(sim.model.factions.get("Antivirus")!.joinable).toBe(false);
    expect(sim.model.characters.get("Trabolta")!.listed).toBe(true);
    expect(sim.model.characters.get("Cookie Banner")!.listed).toBe(false);
  });

  it("`unlock X for guest` is a keyword statement; `when guest learns X:` is its hook", () => {
    expect(statementToDirective("unlock The Sandy File for guest")).toBe("unlock: The Sandy File for guest");
    expect(statementToDirective("unlock the door")).toBeNull(); // prose
    expect(parseTrigger("guest learns The Sandy File")).toEqual({ verb: "learn", param: "guest", filter: "The Sandy File" });
    expect(parseTrigger("share for guest")).toEqual({ verb: "share", param: "guest", filter: null });
  });
});

describe("Sim — unlock / redeem / share", () => {
  it("redeeming a code unlocks the entry once, mirrors it into the world, and fires the learn hook", () => {
    const sim = fresh();
    sim.createPerson("g1", "Minesweeper");
    const evs = sim.redeem("g1", " sandy 1997 ");
    expect(evs.filter((e) => e.type === "codexUnlocked")).toEqual([
      { type: "codexUnlocked", person: "g1", entry: "The Sandy File", via: "code", from: null },
    ]);
    expect(replies(evs)).toContain("You know about Sandy now.");
    expect(sim.world.get("g1.humanity")).toEqual({ kind: "number", value: 10 });
    expect(sim.world.get("g1.codex")).toEqual({ kind: "number", value: 1 });
    expect(sim.world.get("g1.codex.the_sandy_file")).toEqual({ kind: "bool", value: true });
    // Idempotent: the same code again does nothing at all.
    const again = sim.redeem("g1", "SANDY-1997");
    expect(again.filter((e) => e.type === "codexUnlocked")).toEqual([]);
    expect(sim.world.get("g1.humanity")).toEqual({ kind: "number", value: 10 });
  });

  it("a wrong code records a miss and fires the `wrong code` named event", () => {
    const sim = fresh();
    sim.createPerson("g1", "Minesweeper");
    const evs = sim.redeem("g1", "GOOSE");
    expect(evs.filter((e) => e.type === "codexMissed")).toEqual([{ type: "codexMissed", person: "g1", code: "GOOSE" }]);
    expect(replies(evs)).toContain("Nothing happens.");
    expect(sim.codexFor("g1")).toEqual([]);
  });

  it("the story unlocks an entry from a hook body", () => {
    const sim = fresh();
    sim.createPerson("g1", "Minesweeper");
    const evs = sim.scan("Cookie Banner", "g1");
    expect(evs.some((e) => e.type === "codexUnlocked" && e.entry === "The Billboard" && e.via === "story")).toBe(true);
    expect(sim.codexFor("g1").map((e) => e.id)).toEqual(["The Billboard"]);
  });

  it("an operator unlock resolves a loosely-spelled entry; unknown entries and holders are no-ops", () => {
    const sim = fresh();
    sim.createPerson("g1", "Minesweeper");
    expect(sim.unlock("g1", "the billboard").some((e) => e.type === "codexUnlocked")).toBe(true);
    expect(sim.unlock("g1", "Nonsense").filter((e) => e.type === "codexUnlocked")).toEqual([]);
    expect(sim.unlock("nobody", "The Billboard").filter((e) => e.type === "codexUnlocked")).toEqual([]);
    expect(sim.codexHolders("The Billboard")).toEqual(["g1"]);
  });

  it("sharing hands the entry over, fires learn + share with `from` bound, and needs the sharer to hold it", () => {
    const sim = fresh();
    sim.createPerson("g1", "Minesweeper");
    sim.createPerson("g2", "Pinball");
    // g2 can't share what they don't have.
    expect(sim.share("g2", "g1", "The Sandy File").filter((e) => e.type === "codexUnlocked")).toEqual([]);
    sim.redeem("g1", "SANDY-1997");
    const evs = sim.share("g1", "g2", "The Sandy File");
    expect(evs.filter((e) => e.type === "codexUnlocked")).toEqual([
      { type: "codexUnlocked", person: "g2", entry: "The Sandy File", via: "share", from: "g1" },
    ]);
    expect(replies(evs)).toContain("You know about Sandy now.");
    expect(replies(evs)).toContain("Minesweeper told you something.");
    expect(sim.holdsCodex("g2", "The Sandy File")).toBe(true);
    // A character can share its own backstory, and hear about it.
    const told = sim.share("Norton", "g1", "Trabolta Wants Omnipotence");
    expect(told.some((e) => e.type === "dialogue" && (e as { speaker: string }).speaker === "Trabolta")).toBe(true);
    expect(sim.codexHolders("Trabolta Wants Omnipotence").sort()).toEqual(["Norton", "Trabolta", "g1"]);
  });

  it("holders can be characters; a self-share or a share to nobody does nothing", () => {
    const sim = fresh();
    sim.createPerson("g1", "Minesweeper");
    sim.redeem("g1", "SANDY-1997");
    expect(sim.share("g1", "g1", "The Sandy File").filter((e) => e.type === "codexUnlocked")).toEqual([]);
    expect(sim.share("g1", "ghost", "The Sandy File").filter((e) => e.type === "codexUnlocked")).toEqual([]);
    expect(sim.share("g1", "Norton", "The Sandy File").filter((e) => e.type === "codexUnlocked")).toHaveLength(1);
  });
});

describe("Sim — private threads between participants (pm:)", () => {
  it("one channel id regardless of who opens it; only its two parties may see or post", () => {
    const sim = fresh();
    sim.createPerson("g1", "Minesweeper");
    sim.createPerson("g2", "Pinball");
    sim.createPerson("g3", "Solitaire");
    const ch = Sim.pmChannel("g2", "g1");
    expect(ch).toBe("pm:g1:g2");
    expect(Sim.pmChannel("g1", "g2")).toBe(ch);
    expect(Sim.pmParties(ch)).toEqual(["g1", "g2"]);
    expect(sim.canPost("g1", ch)).toBe(true);
    expect(sim.canPost("g3", ch)).toBe(false);
    expect(sim.canSeeChannel("g2", ch)).toBe(true);
    expect(sim.canSeeChannel("g3", ch)).toBe(false);
    expect(sim.canPost("g1", "pm:g1:nobody")).toBe(false);
    expect(sim.channelHead(ch)).toMatchObject({ channelKind: "dm", title: "Minesweeper & Pinball" });
    const evs = sim.say("g1", ch, "meet me in the cache");
    const chat = evs.find((e) => e.type === "chat") as Extract<SimEvent, { type: "chat" }>;
    expect(chat.audience).toEqual(["g1", "g2"]);
    expect(chat.from).toBe("Minesweeper");
    const [m] = composeGuestMessages(sim, evs);
    expect(m).toMatchObject({ channel: ch, channelKind: "dm", title: "Minesweeper & Pinball", audience: ["g1", "g2"] });
  });
});

describe("views — codex, people, joinable groups", () => {
  it("the guest view carries the codex, the total, and a directory with what is known of each person", () => {
    const sim = fresh();
    sim.createPerson("g1", "Minesweeper");
    sim.createPerson("g2", "Pinball");
    sim.redeem("g1", "SANDY-1997");
    const v = guestView(sim, "g1");
    expect(v.codex.map((e) => e.id)).toEqual(["The Sandy File"]);
    expect(v.codex[0]).not.toHaveProperty("code");
    expect(v.codexTotal).toBe(3);
    // `directory: everyone` lists the other guest; listed characters appear too, props don't.
    expect(v.people.map((p) => [p.id, p.kind])).toEqual([
      ["g2", "guest"],
      ["Trabolta", "character"],
      ["Norton", "character"],
    ]);
    const trabolta = v.people.find((p) => p.id === "Trabolta")!;
    expect(trabolta.known.map((e) => e.id)).toEqual(["The Sandy File"]);
    expect(trabolta.faction).toBeNull();
    expect(v.people.find((p) => p.id === "Norton")!.faction).toBe("Antivirus");
    expect(v.people.find((p) => p.id === "g2")!.known).toEqual([]);
    // Antivirus is public but not joinable → no side chooser; hidden groups never show.
    expect(v.factions).toEqual([]);
  });

  it("without `directory: everyone` the guest list stays the acquaintance roster", () => {
    const sim = Sim.fromSources(SOURCE.replace("directory: everyone\n", ""));
    sim.createPerson("g1", "A");
    sim.createPerson("g2", "B");
    expect(guestView(sim, "g1").people.map((p) => p.id)).toEqual(["Trabolta", "Norton"]);
  });

  it("the performer view carries the character's own entries; the mod view sees codes + holders", () => {
    const sim = fresh();
    sim.createPerson("g1", "Minesweeper");
    expect(primeView(sim, "Norton").codex.map((e) => e.id)).toEqual(["Trabolta Wants Omnipotence"]);
    expect(primeView(sim, "Trabolta").codex.map((e) => e.id)).toEqual(["The Sandy File", "Trabolta Wants Omnipotence"]);
    const m = modView(sim, "open", "x");
    expect(m.codex!.find((e) => e.id === "The Sandy File")).toMatchObject({ code: "sandy1997", holders: ["Trabolta"] });
    expect(m.codex!.find((e) => e.id === "The Billboard")).toMatchObject({ code: null, holders: [] });
  });
});

describe("chat — alerts + codex notices", () => {
  it("a broadcast whose cue starts with `!` is an alert (marker stripped)", () => {
    expect(splitAlert('"!Come to the Desktop."')).toEqual({ cue: '"Come to the Desktop."', alert: true });
    expect(splitAlert("!lockdown")).toEqual({ cue: "lockdown", alert: true });
    expect(splitAlert('"Plain."')).toEqual({ cue: '"Plain."', alert: false });
    const sim = fresh();
    sim.createPerson("g1", "Minesweeper");
    const evs = sim.fireBeat("Login");
    const alert = composeGuestMessages(sim, evs).find((m) => m.kind === "signal")!;
    expect(alert.text).toBe("Come to the Desktop.");
    expect(alert.alert).toBe(true);
    expect(alert.audience).toBe("all");
  });

  it("an unlock lands as a private system notice; a miss too; a character's holding says nothing", () => {
    const sim = fresh();
    sim.createPerson("g1", "Minesweeper");
    sim.createPerson("g2", "Pinball");
    const hit = composeGuestMessages(sim, sim.redeem("g1", "SANDY-1997"));
    expect(hit.filter((m) => m.kind === "system").map((m) => [m.text, m.audience])).toEqual([
      ["📓 New codex entry: “The Sandy File”.", ["g1"]],
    ]);
    const miss = composeGuestMessages(sim, sim.redeem("g1", "nope"));
    expect(miss.filter((m) => m.kind === "system").map((m) => m.text)).toEqual(["⛔ “nope” unlocks nothing."]);
    const shared = composeGuestMessages(sim, sim.share("g1", "g2", "The Sandy File"));
    expect(shared.filter((m) => m.kind === "system").map((m) => m.text)).toEqual([
      "📓 New codex entry: “The Sandy File” — shared by Minesweeper.",
    ]);
    // Sharing *to* a character produces no phone notice (no phone).
    expect(composeGuestMessages(sim, sim.share("g1", "Norton", "The Sandy File")).filter((m) => m.kind === "system")).toEqual([]);
  });
});

// --- the server routes --------------------------------------------------------

const CODES = { event: "EVT777", prime: "PRM777", mod: "MOD777" };
const dirs: string[] = [];
function freshRuntime(): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-codex-"));
  dirs.push(d);
  const rt = new EventRuntime({
    eventId: "evt",
    store: new Store(d),
    codes: CODES,
    scenarioName: "trapped",
    scenarioSource: SOURCE,
    joinBase: () => "http://party.local:7000",
  });
  rt.openDoors();
  return rt;
}
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
interface FakeRes {
  statusCode: number;
  body: string;
  frames: Array<{ event: string; data: unknown }>;
}
function fakeRes(): ServerResponse & FakeRes {
  const res = {
    statusCode: 0,
    body: "",
    frames: [] as Array<{ event: string; data: unknown }>,
    pendingEvent: null as string | null,
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    write(chunk: string) {
      // `sseSend` writes `event: x\n` then `data: {...}\n\n` as two chunks.
      const ev = /^event: (\S+)\n$/u.exec(chunk);
      if (ev) res.pendingEvent = ev[1]!;
      const data = /^data: (.*)\n\n$/su.exec(chunk);
      if (data && res.pendingEvent !== null) res.frames.push({ event: res.pendingEvent, data: JSON.parse(data[1]!) });
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
  };
  return res as unknown as ServerResponse & FakeRes;
}
async function post(rt: EventRuntime, path: string, body: unknown, token?: string, moderator = false) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq(body, token), res, "POST", path, url, { moderator });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}
async function stream(rt: EventRuntime, role: string, token: string): Promise<FakeRes> {
  const res = fakeRes();
  const url = new URL(`http://x/events?role=${role}&token=${encodeURIComponent(token)}`);
  await rt.handle(fakeReq({}), res, "GET", "/events", url, {});
  return res;
}
async function guest(rt: EventRuntime, name: string): Promise<{ id: string; token: string }> {
  const r = await post(rt, "/api/guest/register", { name, passcode: CODES.event });
  return { id: r.json.id as string, token: r.json.token as string };
}
async function performer(rt: EventRuntime, character: string): Promise<string> {
  const r = await post(rt, "/api/prime/login", { character, passcode: CODES.prime });
  return r.json.token as string;
}

describe("routes — codex", () => {
  it("a guest redeems a code and shares the entry; a bad code is a miss, not an error", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Minesweeper");
    const b = await guest(rt, "Pinball");
    const miss = await post(rt, "/api/guest/codex/redeem", { code: "WRONG" }, a.token);
    expect(miss.status).toBe(200);
    expect(miss.json.unlocked).toBeNull();
    const hit = await post(rt, "/api/guest/codex/redeem", { code: "sandy-1997" }, a.token);
    expect(hit.json.unlocked).toBe("The Sandy File");
    expect((hit.json.codex as Array<{ id: string }>).map((e) => e.id)).toEqual(["The Sandy File"]);
    expect((await post(rt, "/api/guest/codex/redeem", { code: "" }, a.token)).status).toBe(400);
    // Share to another guest; sharing what you don't hold / to nobody is refused.
    expect((await post(rt, "/api/guest/codex/share", { entry: "The Billboard", to: b.id }, a.token)).status).toBe(404);
    expect((await post(rt, "/api/guest/codex/share", { entry: "The Sandy File", to: "ghost" }, a.token)).status).toBe(404);
    expect((await post(rt, "/api/guest/codex/share", { entry: "The Sandy File", to: b.id }, a.token)).status).toBe(200);
    expect(rt.liveSim!.holdsCodex(b.id, "The Sandy File")).toBe(true);
    // No token → not signed in.
    expect((await post(rt, "/api/guest/codex/redeem", { code: "x" })).status).toBe(401);
  });

  it("a performer shares their character's entry; a director unlocks anything; codes lists QR links", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Minesweeper");
    const norton = await performer(rt, "Norton");
    expect((await post(rt, "/api/prime/codex/share", { entry: "The Sandy File", to: a.id }, norton)).status).toBe(404);
    expect((await post(rt, "/api/prime/codex/share", { entry: "Trabolta Wants Omnipotence", to: a.id }, norton)).status).toBe(200);
    expect(rt.liveSim!.holdsCodex(a.id, "Trabolta Wants Omnipotence")).toBe(true);
    expect((await post(rt, "/api/mod/codex", { who: a.id, entry: "the billboard" }, undefined, true)).json.holders).toEqual([a.id]);
    expect((await post(rt, "/api/mod/codex", { who: a.id, entry: "nope" }, undefined, true)).status).toBe(404);
    expect((await post(rt, "/api/mod/codex", { who: "ghost", entry: "The Billboard" }, undefined, true)).status).toBe(404);
    const codes = await post(rt, "/api/mod/codes", {}, undefined, true);
    expect(codes.json.codex).toEqual([
      {
        id: "The Sandy File",
        title: "The Sandy File",
        about: "Trabolta",
        code: "sandy1997",
        url: "http://party.local:7000/?code=EVT777&unlock=sandy1997",
      },
    ]);
  });

  it("codex + shares replay deterministically from the journal", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-codex-replay-"));
    dirs.push(d);
    const mk = () =>
      new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "t", scenarioSource: SOURCE, joinBase: () => "http://x" });
    const rt1 = mk();
    rt1.openDoors();
    const a = await guest(rt1, "Minesweeper");
    const b = await guest(rt1, "Pinball");
    await post(rt1, "/api/guest/codex/redeem", { code: "SANDY-1997" }, a.token);
    await post(rt1, "/api/guest/codex/share", { entry: "The Sandy File", to: b.id }, a.token);
    await post(rt1, "/api/guest/say", { channel: Sim.pmChannel(a.id, b.id), text: "psst" }, a.token);
    rt1.pause();
    const rt2 = mk();
    expect(rt2.restore()).not.toBeNull();
    expect(rt2.liveSim!.holdsCodex(a.id, "The Sandy File")).toBe(true);
    expect(rt2.liveSim!.holdsCodex(b.id, "The Sandy File")).toBe(true);
    expect(rt2.liveSim!.world.get(`${b.id}.humanity`)).toEqual({ kind: "number", value: 10 });
  });
});

describe("routes — private threads + performer scoping", () => {
  it("guests DM each other through `say` on a pm: channel; outsiders are refused", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Minesweeper");
    const b = await guest(rt, "Pinball");
    const c = await guest(rt, "Solitaire");
    const ch = Sim.pmChannel(a.id, b.id);
    expect((await post(rt, "/api/guest/say", { channel: ch, text: "hi" }, a.token)).status).toBe(200);
    expect((await post(rt, "/api/guest/say", { channel: ch, text: "snoop" }, c.token)).status).toBe(403);
    const res = fakeRes();
    const url = new URL(`http://x/api/history?token=${encodeURIComponent(b.token)}`);
    await rt.handle(fakeReq({}), res, "GET", "/api/history", url, {});
    const msgs = JSON.parse(res.body).messages as Array<{ channel: string; text: string }>;
    expect(msgs.some((m) => m.channel === ch && m.text === "hi")).toBe(true);
  });

  it("a guest's DM to a character reaches that character's booth only; admins and mods see everything", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Minesweeper");
    const trabolta = await performer(rt, "Trabolta");
    const norton = await performer(rt, "Norton");
    const tStream = await stream(rt, "prime", trabolta);
    const nStream = await stream(rt, "prime", norton);
    expect(tStream.statusCode).toBe(200);
    expect((await post(rt, "/api/guest/say", { channel: "dm:Trabolta", text: "are you real?" }, a.token)).status).toBe(200);
    const seen = (r: FakeRes) => r.frames.filter((f) => f.event === "message").map((f) => (f.data as { text: string }).text);
    expect(seen(tStream)).toContain("are you real?");
    expect(seen(nStream)).not.toContain("are you real?");
    // The guest's own history has it; Norton's history stream never did.
    const nHistory = nStream.frames.find((f) => f.event === "history")!.data as Array<{ text: string }>;
    expect(nHistory.map((m) => m.text)).not.toContain("are you real?");
    // Norton elevated to admin sees the whole feed on a fresh stream.
    await post(rt, "/api/mod/login", { passcode: CODES.mod }, norton);
    const nAdmin = await stream(rt, "prime", norton);
    const history = nAdmin.frames.find((f) => f.event === "history")!.data as Array<{ text: string }>;
    expect(history.map((m) => m.text)).toContain("are you real?");
    // A pm: between guests is invisible to a plain performer.
    const b = await guest(rt, "Pinball");
    await post(rt, "/api/guest/say", { channel: Sim.pmChannel(a.id, b.id), text: "secret" }, a.token);
    expect(seen(tStream)).not.toContain("secret");
    expect(seen(nAdmin)).toContain("secret");
  });
});
