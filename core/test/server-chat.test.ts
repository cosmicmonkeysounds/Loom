import { describe, expect, it } from "vitest";

import { Sim, type SimEvent } from "../src/runtime/sim/index.ts";
import {
  ChatStore,
  HISTORY_LIMIT,
  boothOwnRow,
  capHistory,
  guestOwnRow,
  composeGuestMessages,
  decisionChannelFor,
  visibleTo,
  type ChatMessage,
} from "../server/chat.ts";
import { scenarioSource } from "../examples/load.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll } from "vitest";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";

const SCENARIO = scenarioSource("escape-the-internet");

/** Replay a fixed script against a fresh sim, composing as the server would. */
function play(): { sim: Sim; store: ChatStore } {
  const sim = Sim.fromSources(SCENARIO);
  const store = new ChatStore();
  const step = (evs: SimEvent[]) => store.append(composeGuestMessages(sim, evs));
  step(sim.createPerson("g1", "Alice"));
  step(sim.createPerson("g2", "Bob"));
  step(sim.join("g1", "Mods"));
  step(sim.scan("Recruiter", "g1"));
  step(sim.tick(20000)); // one ambient bark
  return { sim, store };
}

describe("chat composition — widgets", () => {
  const SRC = `# W
start: Boot
LOCATION Hall
  label: The Hall
ROLE Guest
  when someone joins:
    -> Greet
CHARACTER Host
== Greet
  setting: Hall
Host: Hello.
show poll "Ready?" to guest
== Boot
  setting: Hall
show image "https://x/poster.png" to everyone with caption: "Tonight"
`;
  it("a global widget lands in the setting's room for all; an addressed one docks under the speaker", () => {
    const sim = Sim.fromSources(SRC);
    const boot = composeGuestMessages(sim, sim.fireBeat("Boot"));
    expect(boot).toHaveLength(1);
    expect(boot[0]).toMatchObject({ kind: "widget", channel: "loc:Hall", audience: "all", text: "https://x/poster.png" });
    expect(boot[0]!.widget).toEqual({ kind: "image", text: "https://x/poster.png", params: { caption: "Tonight" } });
    const join = composeGuestMessages(sim, sim.createPerson("g1", "Ada"));
    const card = join.find((m) => m.kind === "widget");
    expect(card).toMatchObject({ channel: "dm:Host", audience: ["g1"], text: "Ready?" });
  });
});

describe("chat composition — channel routing", () => {
  it("routes a character's line into that character's DM channel", () => {
    const sim = Sim.fromSources(SCENARIO);
    sim.createPerson("g1", "Alice");
    const msgs = composeGuestMessages(sim, sim.scan("Recruiter", "g1"));
    expect(msgs).toHaveLength(1);
    const dm = msgs[0]!;
    expect(dm.channelKind).toBe("dm");
    expect(dm.channel).toBe("dm:Recruiter");
    expect(dm.kind).toBe("line");
    expect(dm.audience).toEqual(["g1"]);
  });

  it("routes a personal state transition into the lobby, addressed to one guest", () => {
    const sim = Sim.fromSources(SCENARIO);
    sim.createPerson("g1", "Alice");
    const msgs = composeGuestMessages(sim, sim.join("g1", "Mods"));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.channel).toBe("lobby");
    expect(msgs[0]!.kind).toBe("system");
    expect(msgs[0]!.audience).toEqual(["g1"]);
  });

  it("routes an ambient bark into the lobby, audience = everyone", () => {
    const sim = Sim.fromSources(SCENARIO);
    sim.createPerson("g1", "Alice");
    const msgs = composeGuestMessages(sim, sim.tick(20000));
    const bark = msgs.find((m) => m.kind === "narration");
    expect(bark).toBeDefined();
    expect(bark!.channel).toBe("lobby");
    expect(bark!.audience).toBe("all");
  });

  it("mirrors a faction-scoped broadcast into each faction channel (members only)", () => {
    const sim = Sim.fromSources(SCENARIO);
    sim.createPerson("g1", "Alice");
    sim.join("g1", "Mods");
    sim.createPerson("g2", "Bob");
    sim.join("g2", "Chatters");
    const synthetic: SimEvent = {
      type: "broadcast",
      cue: "lockdown_siren",
      scope: "faction(Mods) | faction(Chatters)",
      audience: ["g1", "g2"],
    };
    const msgs = composeGuestMessages(sim, [synthetic]);
    const channels = msgs.map((m) => m.channel);
    // The faction broadcast mirrors into each faction channel (plus any
    // routed authored feed like #announcements — scoped to the same audience).
    expect(channels).toContain("faction:Mods");
    expect(channels).toContain("faction:Chatters");
    const mods = msgs.find((m) => m.channel === "faction:Mods")!;
    expect(mods.channelKind).toBe("faction");
    expect(mods.title).toBe("#mods");
    expect(mods.audience).toEqual(["g1"]); // only the Mod
  });

  it("docks a narrative decision under the speaker's DM, world choices in the lobby", () => {
    const sim = Sim.fromSources(SCENARIO);
    sim.createPerson("g1", "Alice");
    const events = sim.scan("Recruiter", "g1");
    expect(decisionChannelFor(events, "g1")).toBe("dm:Recruiter");
    // No preceding dialogue → falls back to the lobby.
    expect(decisionChannelFor([{ type: "choicePrompted", person: "g1", promptId: "g1", options: [] }], "g1")).toBe(
      "lobby",
    );
  });
});

describe("ChatStore — history, visibility, moderation", () => {
  it("gives each guest only the messages addressed to them", () => {
    const { store } = play();
    const g1 = store.historyFor("g1", false);
    const g2 = store.historyFor("g2", false);
    // g1 got: their join (lobby/system), the Recruiter DM, and the ambient bark.
    expect(g1.some((m) => m.channel === "dm:Recruiter")).toBe(true);
    expect(g1.some((m) => m.kind === "narration")).toBe(true);
    // g2 never joined or got scanned — but still sees the global ambient bark.
    expect(g2.some((m) => m.channel === "dm:Recruiter")).toBe(false);
    expect(g2.some((m) => m.audience === "all")).toBe(true);
    expect(g2.every((m) => m.audience === "all")).toBe(true);
  });

  it("assigns dense, monotonic seqs", () => {
    const { store } = play();
    store.all().forEach((m, i) => expect(m.seq).toBe(i));
  });

  it("withholds hidden messages from guests but flags them for admins", () => {
    const { store } = play();
    const dm = store.all().find((m) => m.channel === "dm:Recruiter")!;
    store.setHidden(dm.seq, true);

    const guest = store.historyFor("g1", false);
    expect(guest.some((m) => m.seq === dm.seq)).toBe(false); // gone for the guest

    const admin = store.historyFor("g1", true);
    const flagged = admin.find((m) => m.seq === dm.seq)!;
    expect(flagged.hidden).toBe(true); // visible + flagged for the moderator

    // Restoring brings it back for the guest.
    store.setHidden(dm.seq, false);
    expect(store.historyFor("g1", false).some((m) => m.seq === dm.seq)).toBe(true);
  });

  it("re-applies persisted moderation after a deterministic rebuild", () => {
    const live = play();
    const dm = live.store.all().find((m) => m.channel === "dm:Recruiter")!;
    live.store.setHidden(dm.seq, true);
    const persistedHidden = live.store.hiddenSeqs();

    // A fresh process: replay the identical script, then re-apply moderation.
    const rebuilt = play();
    rebuilt.store.loadHidden(persistedHidden);

    // Same content, same seqs (history is deterministic) …
    expect(rebuilt.store.all().map((m) => m.text)).toEqual(live.store.all().map((m) => m.text));
    // … so the hidden flag lands on the same message.
    expect(rebuilt.store.get(dm.seq)!.hidden).toBe(true);
    expect(rebuilt.store.historyFor("g1", false).some((m) => m.seq === dm.seq)).toBe(false);
  });
});

describe("typed chat — the journaled `say` command", () => {
  it("every story-composed message is a thread root (parentSeq null)", () => {
    const { store } = play();
    expect(store.all().every((m) => m.parentSeq === null)).toBe(true);
  });

  it("routes a guest's typed lobby message to everyone as a line from their name", () => {
    const sim = Sim.fromSources(SCENARIO);
    sim.createPerson("g1", "Alice");
    const msgs = composeGuestMessages(sim, sim.say("g1", "lobby", "hello internet"));
    expect(msgs).toHaveLength(1);
    const m = msgs[0]!;
    expect(m.channel).toBe("lobby");
    expect(m.kind).toBe("line");
    expect(m.from).toBe("Alice"); // display name, not the id
    expect(m.text).toBe("hello internet");
    expect(m.audience).toBe("all");
    expect(m.parentSeq).toBe(null);
  });

  it("scopes a faction message to that faction's members", () => {
    const sim = Sim.fromSources(SCENARIO);
    sim.createPerson("g1", "Alice");
    sim.join("g1", "Mods");
    sim.createPerson("g2", "Bob");
    sim.join("g2", "Chatters");
    const msgs = composeGuestMessages(sim, sim.say("g1", "faction:Mods", "mods only"));
    expect(msgs[0]!.channel).toBe("faction:Mods");
    expect(msgs[0]!.audience).toEqual(["g1"]);
  });

  it("derives a guest's DM audience as themselves", () => {
    const sim = Sim.fromSources(SCENARIO);
    sim.createPerson("g1", "Alice");
    const msgs = composeGuestMessages(sim, sim.say("g1", "dm:Recruiter", "are you there?"));
    expect(msgs[0]!.channel).toBe("dm:Recruiter");
    expect(msgs[0]!.audience).toEqual(["g1"]);
  });

  it("carries an explicit audience (a performer replying into a guest thread)", () => {
    const sim = Sim.fromSources(SCENARIO);
    sim.createPerson("g1", "Alice");
    const msgs = composeGuestMessages(sim, sim.say("Recruiter", "dm:Recruiter", "found you", null, ["g1"]));
    expect(msgs[0]!.from).toBe("Recruiter"); // a character, not in persons → name passes through
    expect(msgs[0]!.audience).toEqual(["g1"]);
  });

  it("links a reply to its root and counts it (Slack threads)", () => {
    const sim = Sim.fromSources(SCENARIO);
    const store = new ChatStore();
    const step = (evs: SimEvent[]) => store.append(composeGuestMessages(sim, evs));
    sim.createPerson("g1", "Alice");
    const [root] = step(sim.say("g1", "lobby", "anyone here?"));
    const [reply] = step(sim.say("g1", "lobby", "guess not", root!.seq));
    expect(reply!.parentSeq).toBe(root!.seq);
    expect(store.replies(root!.seq).map((m) => m.seq)).toEqual([reply!.seq]);
    expect(store.replyCount(root!.seq)).toBe(1);
    // The root itself is not a reply to anything.
    expect(store.replyCount(reply!.seq)).toBe(0);
  });

  it("replays typed chat deterministically (same seqs + thread links)", () => {
    const run = () => {
      const sim = Sim.fromSources(SCENARIO);
      const store = new ChatStore();
      const step = (evs: SimEvent[]) => store.append(composeGuestMessages(sim, evs));
      step(sim.createPerson("g1", "Alice"));
      const [root] = step(sim.say("g1", "lobby", "hi"));
      step(sim.say("g1", "lobby", "still hi", root!.seq));
      return store;
    };
    const a = run();
    const b = run();
    expect(b.all().map((m) => [m.seq, m.from, m.text, m.parentSeq])).toEqual(
      a.all().map((m) => [m.seq, m.from, m.text, m.parentSeq]),
    );
  });
});

describe("visibleTo", () => {
  const base: Omit<ChatMessage, "audience"> = {
    seq: 0,
    channel: "lobby",
    channelKind: "lobby",
    title: "Lobby",
    from: "",
    kind: "narration",
    text: "hi",
    ts: 0,
    parentSeq: null,
    hidden: false,
  };
  it('"all" reaches everyone', () => {
    expect(visibleTo({ ...base, audience: "all" }, "anyone")).toBe(true);
  });
  it("a fixed audience reaches only its members", () => {
    expect(visibleTo({ ...base, audience: ["g1"] }, "g1")).toBe(true);
    expect(visibleTo({ ...base, audience: ["g1"] }, "g2")).toBe(false);
  });
});

describe("the reconnect history is capped for guests and booths (W8 T9-05)", () => {
  const msg = (seq: number, o: Partial<ChatMessage> = {}): ChatMessage => ({
    seq,
    channel: "lobby",
    channelKind: "lobby",
    title: "#lobby",
    from: "Narrator",
    kind: "line",
    text: `line ${seq}`,
    ts: seq,
    audience: "all",
    parentSeq: null,
    hidden: false,
    ...o,
  });

  it("keeps the last N ordinary messages, every pinned-room row and sticky pin, and the root of a kept reply", () => {
    const msgs: ChatMessage[] = [
      msg(0, { channel: "codex", channelKind: "pinned" as ChatMessage["channelKind"] }),
      msg(1, { pin: "" }),
      msg(2), // a thread root, old
      msg(3),
      msg(4),
      msg(5, { channel: "quests", channelKind: "pinned" as ChatMessage["channelKind"] }),
      msg(6),
      msg(7, { parentSeq: 2 }),
      msg(8),
    ];
    expect(capHistory(msgs, 3).map((m) => m.seq)).toEqual([0, 1, 2, 5, 6, 7, 8]);
    // Under the cap nothing is cut (a copy, seq-ordered).
    expect(capHistory(msgs, 100).map((m) => m.seq)).toEqual(msgs.map((m) => m.seq));
  });

  it("keeps every alert, every card and the viewer's own rows; the public rooms are what is cut", () => {
    const msgs: ChatMessage[] = [
      msg(0, { kind: "signal", alert: true, text: "!lights out" }),
      msg(1, { kind: "widget", channel: "dm:Clippy", channelKind: "dm", audience: ["g1"] }),
      msg(2, { channel: "dm:Trabolta", channelKind: "dm", audience: ["g1"] }),
      msg(3, { channel: "pm:g1:g2", channelKind: "dm", audience: ["g1", "g2"] }),
      msg(4, { kind: "system", audience: ["g1"] }), // a notice to them alone
      msg(5, { channel: "dm:Clippy", channelKind: "dm", audience: ["@Norton"] }), // a booth's Inbox
      msg(6, { channel: "faction:Mods", channelKind: "faction", audience: ["g1", "g2", "g3"] }),
      msg(7),
      msg(8),
      msg(9),
    ];
    // A guest (who never sees a booth's Inbox): the alert, the card and
    // their own threads stay; the shared rows go.
    const guest = msgs.filter((m) => m.seq !== 5);
    expect(capHistory(guest, 1, guestOwnRow("g1")).map((m) => m.seq)).toEqual([0, 1, 2, 3, 4, 9]);
    // A booth: its own `@<Character>` rows stay, another character's DM with a guest is ordinary.
    expect(capHistory(msgs, 1, boothOwnRow("Norton")).map((m) => m.seq)).toEqual([0, 1, 5, 9]);
    // …but its own `dm:<Character>` threads with guests stay (each guest's card is built from them).
    const clippy = capHistory(msgs, 1, boothOwnRow("Clippy")).map((m) => m.seq);
    expect(clippy).toContain(5);
    expect(clippy).not.toContain(2);
    const talk: ChatMessage[] = [
      msg(0, { channel: "dm:Clippy", channelKind: "dm", audience: ["g1"], from: "g1" }),
      msg(1, { channel: "dm:Clippy", channelKind: "dm", audience: ["g1"], from: "Clippy" }),
      ...Array.from({ length: 1000 }, (_, i) => msg(i + 2)),
    ];
    const kept = capHistory(talk, 400, boothOwnRow("Clippy"));
    expect(kept.slice(0, 2).map((m) => m.seq)).toEqual([0, 1]);
    expect(kept).toHaveLength(402);
  });

  const CODES = { event: "EVT555", prime: "PRM555", mod: "MOD555" };
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  function call(rt: EventRuntime, method: string, pathAndQuery: string, body: unknown, moderator = false) {
    const buf = Buffer.from(JSON.stringify(body ?? {}));
    const req = {
      headers: {},
      [Symbol.asyncIterator]: async function* () {
        yield buf;
      },
      on() {},
    } as unknown as IncomingMessage;
    let raw = "";
    const res = {
      statusCode: 0,
      body: "",
      writeHead(s: number) {
        res.statusCode = s;
        return res;
      },
      write(chunk: string) {
        raw += chunk;
        return true;
      },
      end(b?: string) {
        if (typeof b === "string") res.body = b;
        return res;
      },
    };
    const url = new URL(`http://x${pathAndQuery}`);
    return rt.handle(req, res as unknown as ServerResponse, method, url.pathname, url, { moderator }).then(() => ({
      json: JSON.parse(res.body || "{}") as Record<string, unknown>,
      history: (): ChatMessage[] => {
        const block = raw.split("\n\n").find((b) => b.startsWith("event: history\n"));
        return block === undefined ? [] : (JSON.parse(block.slice(block.indexOf("data: ") + 6)) as ChatMessage[]);
      },
    }));
  }

  it("a fresh guest stream after 1,000 lobby lines: the N recent lines, seq-ordered; the REST history and a director's stream keep everything", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-hist-"));
    dirs.push(d);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "escape-the-internet", scenarioSource: SCENARIO, joinBase: () => "http://localhost" });
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Alice", passcode: CODES.event });
    const id = g.json["id"] as string;
    await call(rt, "POST", "/api/mod/say", { channel: `guest:${id}`, text: "your own early DM" }, true);
    await call(rt, "POST", "/api/mod/broadcast", { scope: "everyone", cue: "!an early alert" }, true);
    for (let i = 0; i < 1000; i++) await call(rt, "POST", "/api/mod/say", { channel: "lobby", text: `lobby ${i}` }, true);

    const stream = await call(rt, "GET", `/events?role=guest&token=${encodeURIComponent(g.json["token"] as string)}`, {});
    const h = stream.history();
    expect(h.length).toBeLessThanOrEqual(HISTORY_LIMIT + 10);
    expect(h.length).toBeGreaterThanOrEqual(HISTORY_LIMIT);
    expect(h.at(-1)!.text).toBe("lobby 999");
    expect(h.some((m) => m.text === "lobby 0")).toBe(false);
    // Their own DM and an alert outlast the public flood (a waking phone
    // still banners an alert it missed).
    expect(h.some((m) => m.text === "your own early DM")).toBe(true);
    expect(h.some((m) => m.alert === true)).toBe(true);
    const seqs = h.map((m) => m.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    // The REST history (and a director's stream) is still the whole thing.
    expect(rt.chatHistoryFor(id).some((m) => m.text === "your own early DM")).toBe(true);
    const mod = await call(rt, "GET", "/events?role=mod", {}, true);
    expect(mod.history().some((m) => m.text === "lobby 0")).toBe(true);
    rt.dispose();
  });
});
