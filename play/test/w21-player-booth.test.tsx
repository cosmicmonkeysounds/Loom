// Wave 21 (play lane, CONTRACT P1–P8): a `player: true` part plays the night
// like a guest — the taskbar's Mission · Chats · Scan, Mission as home (its
// score tiles, Quest Log / Codex / Wallet / 🚨 Wanted tiles, big buttons that
// are actions), Chats in sections with 📋 Notes and the Team rooms, a lean
// Start menu with 👥 People, the NEW MISSION pop-out, and a guest card with
// no staff-room lines. Wave 37 (C7): NEW MISSION said once — over its own
// Mission card the driver chimes and hands it to the title bar.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { playTone } from "../src/alerts.ts";
import { PlayHostContext, browserHost, memoryStore } from "../src/host.ts";
import { PopOutQuiet, PopOutScope, resetPopOutStores, usePopOuts, type PopOutsApi } from "../src/booth/popouts/rung.ts";
import { useBoothPopOuts, type DriverOpts } from "../src/booth/popouts/use-booth-popouts.ts";
import type { PrimeSession } from "../src/session/prime.ts";
import { mountHooks } from "./hooks-harness.ts";

vi.mock("../src/alerts.ts", async (importOriginal) => ({ ...(await importOriginal<typeof import("../src/alerts.ts")>()), playTone: vi.fn() }));

import { NOTES_ID, NOTES_TITLE, WANTED_NAV, boothActionOf, boothMissionOf, boothWhereOf, newMissionSpec, playerChats, playerStartIds, scanCaption } from "../src/booth/mission-model.ts";
import { PlayerMission, playerTaskbarButtons } from "../src/booth/player.tsx";
import { PeopleSheet, peopleTag } from "../src/booth/people.tsx";
import { boothStartItems, playerStartItems } from "../src/booth/header.tsx";
import { BoothTray } from "../src/booth/tray.tsx";
import { bindDraft } from "../src/booth/popouts/use-booth-popouts.ts";
import { reconcilePopOuts } from "../src/booth/popouts/model.ts";
import { callsOf, isPlayer, statsOf } from "../src/booth/wire.ts";
import { buildPrimeChannels } from "../src/session.ts";
import type { Channel, ChatMessage, Interaction, ObjectiveView, PrimeGuest, PrimeView } from "../src/types.ts";

const I = (id: string, label: string, extra: Partial<Interaction> = {}): Interaction => ({ id, label, who: "performer", description: null, ...extra });
const obj = (id: string, title: string, extra: Partial<ObjectiveView & { pick?: string[]; target?: { id: string; name: string } }> = {}): ObjectiveView => ({ id, title, brief: "", checklist: [], buttons: [], act: null, ...extra });
const guest = (id: string, name: string, extra: Partial<PrimeGuest> = {}): PrimeGuest => ({ id, name, faction: null, captured: false, location: "Desktop", ...extra });
const ch = (id: string, extra: Partial<Channel> = {}): Channel => ({ id, kind: "open", title: id, spaceId: "story", order: 0, messages: [], unread: 0, decision: null, lastTs: 0, ...extra });

const ints = [I("send", "🛡 Send to the Internet"), I("winner", "🎱 Bingo winner"), I("ribbon", "🎀 Give the ribbon"), I("defect", "📢 Defect openly", { arm: true }), I("look", "🤫 Look the other way")];
const view = (over: Partial<PrimeView> = {}): PrimeView =>
  ({
    character: "Norton Anti-Virus",
    faction: "Antivirus",
    player: true,
    guests: [guest("g1", "Winamp"), guest("g2", "Encarta", { location: null })],
    channels: [{ id: "loc:Desktop", kind: "location", title: "The Desktop", spaceId: "story", member: true, canPost: true, threadable: true }],
    spaces: [],
    interactions: ints,
    objectives: [obj("escort", "🛡 Escort the marked", { brief: "Bring them in.", buttons: ["send", "scan"], checklist: [{ label: "One caught", done: true }, { label: "Two caught", done: false }] }), obj("defect", "🤫 Whose side are you on?", { buttons: ["defect"], evergreen: true })],
    stats: [{ glyph: "⭐", label: "Points", value: "120" }],
    mission: { objective: "escort", place: "The Desktop" },
    questTotal: 3,
    quests: [{ id: "q", title: "Q", giver: null, status: "active" }],
    codexTotal: 10,
    codex: [{ id: "c", title: "C", text: "", about: null }],
    globalButtons: ["defect"],
    ...over,
  }) as PrimeView;

describe("the wire (C3 / C4)", () => {
  it("reads player, stats and never calls on a player", () => {
    expect(isPlayer(view())).toBe(true);
    expect(isPlayer({ ...view(), player: undefined })).toBe(false);
    expect(statsOf(view())).toEqual([{ glyph: "⭐", label: "Points", value: "120" }]);
    expect(statsOf({ ...view(), stats: [{ glyph: "⭐" } as never] })).toEqual([]);
    const calls = { rows: [], next: null, last: null, lastName: null, act: null, presses: 0 };
    expect(callsOf({ ...view(), calls })).toBeNull();
    expect(callsOf({ ...view(), player: false, calls })).not.toBeNull();
  });
});

describe("the player's frame (P1)", () => {
  it("the taskbar is Mission · Chats · Scan, Scan the primary, no Guests", () => {
    const b = playerTaskbarButtons({ pressed: "mission", chatsDot: true, scanOpen: false, mission: () => {}, chats: () => {}, scan: () => {} });
    expect(b.map((x) => x.id)).toEqual(["mission", "chats", "scan"]);
    expect(b.find((x) => x.id === "scan")?.primary).toBe(true);
    expect(b.find((x) => x.id === "mission")?.pressed).toBe(true);
    expect(b.find((x) => x.id === "chats")?.dot).toBe(true);
  });
  it("the tray shows the first stat instead of the act chip", () => {
    const html = renderToStaticMarkup(<BoothTray view={{ ...view(), night: { act: { code: "B", title: "Bingo" }, phase: null, step: 3 } }} onWallet={() => {}} />);
    expect(html).toContain("⭐ 120");
    expect(html).not.toContain("Act B");
    const plain = renderToStaticMarkup(<BoothTray view={{ ...view(), player: false, night: { act: { code: "B", title: "Bingo" }, phase: null, step: 3 } }} onWallet={() => {}} />);
    expect(plain).toContain("Act B");
    expect(plain).not.toContain("⭐ 120");
  });
});

describe("the player's Mission (P2)", () => {
  const list = [ch("loc:Desktop", { kind: "location", title: "The Desktop" }), ch("quests", { kind: "quests" }), ch("codex", { kind: "codex" })];
  it("gives the censor a 🔑 Filter tile after Wanted (wave 48), never anyone else", () => {
    const m = boothMissionOf(view(), { list, claimer: true, loose: 2, filter: 3 });
    expect(m.tiles.map((t) => [t.id, t.status, t.dot])).toEqual([
      ["wanted", "2 loose", true],
      ["filter", "3 to judge", true],
      ["quests", "1 active", false],
      ["codex", "1 known", false],
    ]);
    expect(m.tiles[1]!.nav).toEqual({ to: "room", id: "__filter" });
    expect(boothMissionOf(view(), { list, claimer: true, loose: 2, filter: 0 }).tiles[1]).toMatchObject({ id: "filter", status: "nothing to judge", dot: false });
    expect(boothMissionOf(view(), { list, claimer: true, loose: 2, filter: null }).tiles.some((t) => t.id === "filter")).toBe(false);
  });

  it("is the NOW objective with its Where, buttons, score tiles, desk tiles, and Also now (the evergreen kept out)", () => {
    const m = boothMissionOf(view(), { list, claimer: true, loose: 2 });
    expect(m.glyph).toBe("🛡");
    expect(m.title).toBe("Escort the marked");
    expect(m.where).toEqual({ kind: "go", name: "The Desktop", nav: { to: "room", id: "loc:Desktop" } });
    expect(m.buttons).toEqual(["send", "scan"]);
    expect(m.scores).toEqual([{ glyph: "⭐", label: "Points", value: "120" }]);
    expect(m.tiles.map((t) => [t.id, t.status])).toEqual([
      ["wanted", "2 loose"],
      ["quests", "1 active"],
      ["codex", "1 known"],
    ]);
    expect(m.tiles[0]!.nav).toEqual(WANTED_NAV);
    expect(m.also).toEqual([]);
    expect(m.freeRoam).toBe(false);
  });
  it("no 🚨 tile for a booth that does not claim; the approver gets its Wallet", () => {
    const m = boothMissionOf({ ...view(), wallet: { name: "Truthcoin", queue: [{ state: "held" } as never], every: 3, windowMs: 60_000 } }, { list, claimer: false, loose: 2 });
    expect(m.tiles.map((t) => t.id)).toEqual(["wallet", "quests", "codex"]);
    expect(m.tiles[0]).toMatchObject({ status: "1 to approve", dot: true });
  });
  it("a place the booth doesn't list reads as plain words; a mission for another objective shows none", () => {
    expect(boothWhereOf({ mission: { objective: "escort", place: "The Attic" } }, obj("escort", "x"), list)).toEqual({ kind: "place", name: "The Attic" });
    expect(boothWhereOf({ mission: { objective: "other", place: "The Desktop" } }, obj("escort", "x"), list)).toBeNull();
    expect(boothWhereOf({ mission: { objective: "escort", place: null } }, obj("escort", "x"), list)).toBeNull();
  });
  it("every big button is an action: a picker, a target's card, a global press, the scanner captioned", () => {
    const v = view({
      objectives: [
        obj("bingo", "🎱 Bingo", { buttons: ["winner"], pick: ["g1"] } as never),
        obj("bottle", "🍾 The bottle", { buttons: ["ribbon"], target: { id: "g2", name: "Encarta" } } as never),
        obj("escort", "🛡 Escort", { buttons: ["send", "scan", "pass"] }),
        obj("defect", "🤫 Side", { buttons: ["defect"] }),
      ],
    });
    expect(boothActionOf("winner", v)).toEqual({ kind: "pick", objective: "bingo" });
    expect(boothActionOf("ribbon", v)).toEqual({ kind: "target", guest: "g2" });
    expect(boothActionOf("defect", v)).toEqual({ kind: "global", id: "defect" });
    expect(boothActionOf("send", v)).toEqual({ kind: "scanFor", id: "send", caption: "📷 Scan a program to send to the Internet" });
    expect(boothActionOf("scan", v)).toEqual({ kind: "scan" });
    expect(boothActionOf("pass", v)).toBeNull();
    expect(boothActionOf("nope", v)).toBeNull();
    expect(scanCaption("🤫 Look the other way")).toBe("📷 Scan a program to look the other way");
  });
  it("renders the guest's Mission window with the score tile and the big buttons", () => {
    const html = renderToStaticMarkup(<PlayerMission view={view()} ctx={{ list, claimer: true, loose: 1 }} open={{ scan: () => {}, pick: () => {}, card: () => {}, global: () => {}, go: () => {} }} />);
    expect(html).toContain("Escort the marked");
    expect(html).toContain("📍 Go to The Desktop");
    expect(html).toContain("🛡 Send to the Internet");
    expect(html).toContain("SCAN A PASS");
    expect(html).toContain("desk-tile score");
    expect(html).toContain(">120<");
    expect(html).toContain("🚨");
    expect(html).toContain("1 / 2");
  });
});

describe("the player's Chats (P6)", () => {
  const me = "Norton Anti-Virus";
  const line = (seq: number, channel: string, from: string): ChatMessage => ({ seq, channel, channelKind: "dm", title: "", from, kind: "line", text: "hi", ts: seq, audience: ["g1"], parentSeq: null, hidden: false }) as ChatMessage;
  const list: Channel[] = [
    ch("__scanner", { kind: "scanner", spaceId: "booth" }),
    ch(NOTES_ID, { kind: "dm", title: "Readouts", spaceId: "booth" }),
    ch("__feed", { kind: "lobby" }),
    ch("quests", { kind: "quests" }),
    ch("room:quarantine", { kind: "group", staff: true, title: "# quarantine" }),
    ch("loc:Desktop", { kind: "location", title: "The Desktop", people: [{ id: "g1", name: "Winamp", kind: "guest", group: null }] }),
    ch("loc:Attic", { kind: "location", title: "The Attic" }),
    ch("cast:Trabolta", { kind: "dm", title: "Trabolta", spaceId: "cast" }),
    ch("guest:g1", { kind: "guest", title: "Winamp", people: [{ id: "g1", name: "Winamp", kind: "guest", group: null }], messages: [line(1, `dm:${me}`, "Winamp")] }),
    ch("guest:g2", { kind: "guest", title: "Encarta", people: [{ id: "g2", name: "Encarta", kind: "guest", group: null }] }),
    ch("guest:g3", { kind: "guest", title: "ICQ", unread: 1, people: [{ id: "g3", name: "ICQ", kind: "guest", group: null }], messages: [line(2, `dm:${me}`, "ICQ")] }),
  ];
  it("Your move · Messages · Team · Rooms, then Other rooms with the Chat log last", () => {
    const c = playerChats(list, { character: me, now: 0 });
    expect(c.sections.map((s) => [s.id, s.channels.map((x) => x.id)])).toEqual([
      ["move", ["guest:g3"]],
      ["messages", [NOTES_ID, "cast:Trabolta", "guest:g1"]],
      ["team", ["room:quarantine"]],
      ["rooms", ["loc:Desktop"]],
    ]);
    expect(c.sections[1]!.channels[0]!.title).toBe(NOTES_TITLE);
    expect(c.sections.find((s) => s.id === "team")?.title).toBe("TEAM");
    expect(c.other.map((x) => x.id)).toEqual(["loc:Attic", "__feed"]);
    expect(c.other[1]!.title).toBe("📜 Chat log");
  });
  it("Readouts are 📋 Notes on a player's booth", () => {
    const notes = buildPrimeChannels(new Map(), view()).find((c) => c.id === NOTES_ID)!;
    expect(notes.title).toBe("📋 Notes");
    expect(buildPrimeChannels(new Map(), view({ player: false })).find((c) => c.id === NOTES_ID)!.title).toBe("Readouts");
  });
});

describe("the player's Start menu and People (P4)", () => {
  const base = { character: "Clippy", wake: { supported: true, on: false, toggle: () => {} }, embedded: false, onHelp: () => {}, onSheet: () => {}, onPeople: () => {}, onSignOut: () => {} };
  it("Help, Keep my screen on, Get alerts, People, Sign out — no moderator powers, no 'What X knows'", () => {
    const items = playerStartItems(base);
    expect(items.map((i) => i.id)).toEqual(["help", "wake", "alerts", "people", "signout"]);
    expect(items.map((i) => i.id)).toEqual(playerStartIds({ wake: true, embedded: false }));
    expect(playerStartItems({ ...base, embedded: true }).map((i) => i.id)).toEqual(playerStartIds({ wake: true, embedded: true }));
    expect(items.find((i) => i.id === "signout")?.confirm).toContain("Sign out of Clippy?");
    // A plain performer's menu is unchanged.
    expect(boothStartItems({ ...base, admin: false, host: false, knows: 2 }).map((i) => i.id)).toEqual(["help", "wake", "alerts", "knows", "powers", "signout"]);
  });
  it("People tags MARKED / IN THE INTERNET only for a claimer", () => {
    const v = view({ wanted: [{ id: "g1", name: "Winamp", reason: null, location: null, lastSeen: null, markedAt: 0, claimedBy: null, captured: false }] } as never);
    expect(peopleTag(guest("g1", "Winamp"), v, true)).toEqual({ text: "MARKED", tone: "marked" });
    expect(peopleTag(guest("g1", "Winamp"), v, false)).toBeNull();
    expect(peopleTag(guest("g2", "Encarta", { captured: true }), v, true)).toEqual({ text: "IN THE INTERNET", tone: "internet" });
    const html = renderToStaticMarkup(<PeopleSheet view={v} claimer onPick={() => {}} onClose={() => {}} />);
    expect(html).toContain("Winamp");
    expect(html).toContain("📍 The Desktop");
    expect(html).toContain("📍 not in a room");
    expect(html).toContain("MARKED");
    expect(renderToStaticMarkup(<PeopleSheet view={v} claimer={false} onPick={() => {}} onClose={() => {}} />)).not.toContain("MARKED");
  });
});

describe("the NEW MISSION pop-out (P5)", () => {
  const a = obj("a", "🎱 Bingo", { brief: "Pick the winner." });
  const b = obj("b", "🍾 The bottle");
  it("remembers the first look, then pops each new NOW objective once; never an evergreen one", () => {
    const first = newMissionSpec([a], null, 0);
    expect(first.draft).toBeNull();
    expect(first.seen).toEqual(["a"]);
    const next = newMissionSpec([b, a], first.seen, 5);
    expect(next.draft).toMatchObject({ key: "mission:b", glyph: "🍾", title: "NEW MISSION · The bottle", body: ["Your game is on. Open Mission to see what to do."] });
    expect(next.draft?.actions).toEqual([{ id: "go", label: "▣ Go", kind: "primary", do: { kind: "mission" } }]);
    expect(newMissionSpec([b], next.seen, 6).draft).toBeNull(); // seen
    expect(newMissionSpec([a], next.seen, 7).draft).toBeNull(); // back to an old one
    expect(newMissionSpec([obj("e", "Explore", { evergreen: true })], next.seen, 8).draft).toBeNull();
    // Nothing live yet at sign-in: the first objective of the night pops.
    expect(newMissionSpec([a], newMissionSpec([], null, 0).seen, 1).draft).toMatchObject({ key: "mission:a", body: ["Pick the winner."] });
  });
  it("Go opens Mission; the pop-out retires once its objective ends", () => {
    let went = 0;
    const d = newMissionSpec([b], ["a"], 0).draft!;
    const spec = bindDraft(d, { act: async () => {}, card: () => {}, scan: () => {}, board: () => {}, door: () => {}, pick: () => {}, cue: () => {}, mission: () => (went += 1) }, () => {});
    void spec.actions[0]!.run();
    expect(went).toBe(1);
    const held = [{ spec: { ...d, actions: [] } as never }];
    const ctx = { wanted: null, calls: null, guestOf: () => null, wctx: {} as never };
    expect(reconcilePopOuts(held, { ...ctx, objectives: [b] }).retire).toEqual([]);
    expect(reconcilePopOuts(held, { ...ctx, objectives: [a] }).retire).toEqual(["mission:b"]);
  });
});

describe("wave 37 (C7): NEW MISSION, said once", () => {
  const a = obj("a", "🎱 Bingo", { brief: "Pick the winner." });
  const b = obj("b", "🍾 The bottle", { brief: "Make them answer." });
  type Ctx = { _currentValue: unknown };
  const scopeCtx = ((mountHooks(PopOutScope, { session: null, children: null }).output as ReactElement).type as unknown as { _context: Ctx })._context;
  const hostCtx = PlayHostContext as unknown as Ctx;
  const session = (objectives: ObjectiveView[]): PrimeSession =>
    ({ auth: { token: "tok-w37", character: "Norton Anti-Virus" }, view: view({ objectives, interactions: [] }), messages: new Map(), card: () => new Promise(() => {}) }) as unknown as PrimeSession;
  const opener = { act: async () => {}, card: () => {}, scan: () => {}, board: () => {}, door: () => {}, pick: () => {}, cue: () => {}, mission: () => {} };
  const opts = (objectives: ObjectiveView[], extra: Partial<DriverOpts> = {}): DriverOpts => ({ session: session(objectives), open: opener, now: 1_000, placeTitle: () => null, ownFireAt: () => null, ...extra });
  const heldKeys = () => (mountHooks(usePopOuts, undefined as never).output as PopOutsApi).held.map((e) => e.spec);
  beforeEach(() => {
    resetPopOutStores();
    vi.mocked(playTone).mockClear();
    scopeCtx._currentValue = { session: "tok-w37" };
    hostCtx._currentValue = { ...browserHost, storage: memoryStore(), sound: true };
  });
  afterEach(() => {
    scopeCtx._currentValue = null;
    hostCtx._currentValue = browserHost;
  });

  it("over its own Mission card: no pop-out, one chime, onMissionNews once with the title", () => {
    const news: Array<{ id: string; title: string }> = [];
    const extra = { missionShown: (id: string) => id === "b", onMissionNews: (o: { id: string; title: string }) => news.push(o) };
    const h = mountHooks(useBoothPopOuts, opts([a], extra));
    expect(news).toEqual([]);
    h.rerender(opts([b, a], extra));
    expect(news).toEqual([{ id: "b", title: "NEW MISSION · The bottle" }]);
    expect(vi.mocked(playTone)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(playTone).mock.calls[0]).toEqual(["info", true]);
    expect(heldKeys().map((x) => x.key)).toEqual([]);
    h.rerender(opts([b, a], extra));
    expect(news).toHaveLength(1);
    expect(vi.mocked(playTone)).toHaveBeenCalledTimes(1);
  });

  it("over its own card in PLAYER SELECT (a quiet scope): onMissionNews, but no tone face to face", () => {
    const news: Array<{ id: string; title: string }> = [];
    const extra = { missionShown: (id: string) => id === "b", onMissionNews: (o: { id: string; title: string }) => news.push(o) };
    const h = mountHooks(useBoothPopOuts, opts([a], extra));
    const q = mountHooks(PopOutQuiet, {});
    h.rerender(opts([b, a], extra));
    expect(news).toEqual([{ id: "b", title: "NEW MISSION · The bottle" }]);
    expect(vi.mocked(playTone)).not.toHaveBeenCalled();
    expect(heldKeys()).toEqual([]);
    q.unmount();
  });

  it("anywhere else: it pops (keeping its brief) and leaves by itself after 20 s; the driver plays nothing", () => {
    const news: unknown[] = [];
    const h = mountHooks(useBoothPopOuts, opts([a], { missionShown: () => false, onMissionNews: (o) => news.push(o) }));
    h.rerender(opts([b, a], { missionShown: () => false, onMissionNews: (o) => news.push(o) }));
    expect(news).toEqual([]);
    expect(vi.mocked(playTone)).not.toHaveBeenCalled();
    expect(heldKeys()).toMatchObject([{ key: "mission:b", title: "NEW MISSION · The bottle", body: ["Make them answer."], autoRetireMs: 20_000 }]);
    // No option given: as before (it pops). A fresh sign-in's memory.
    resetPopOutStores();
    hostCtx._currentValue = { ...browserHost, storage: memoryStore(), sound: true };
    const plain = mountHooks(useBoothPopOuts, opts([a]));
    plain.rerender(opts([b, a]));
    expect(heldKeys().map((x) => x.key)).toEqual(["mission:b"]);
  });

  it("raised under a card (held quiet), then × lands on Mission: no pop-out, the blink, one chime", () => {
    const news: Array<{ id: string; title: string }> = [];
    let onMission = false;
    const extra = () => ({ missionShown: () => onMission, onMissionNews: (o: { id: string; title: string }) => news.push(o) });
    const h = mountHooks(useBoothPopOuts, opts([a], extra()));
    const q = mountHooks(PopOutQuiet, {});
    h.rerender(opts([b, a], extra()));
    expect(heldKeys().map((x) => x.key)).toEqual(["mission:b"]);
    expect(news).toEqual([]);
    // × on the card: the quiet scope goes, and Mission is the window under it.
    q.unmount();
    onMission = true;
    h.rerender(opts([b, a], extra()));
    expect(heldKeys()).toEqual([]);
    expect(news).toEqual([{ id: "b", title: "NEW MISSION · The bottle" }]);
    expect(vi.mocked(playTone)).toHaveBeenCalledTimes(1);
    h.rerender(opts([b, a], extra()));
    expect(news).toHaveLength(1);
  });

  it("one already on screen (in Chats) that meets Mission goes too, with the blink and no second chime", () => {
    const news: Array<{ id: string; title: string }> = [];
    let onMission = false;
    const extra = () => ({ missionShown: () => onMission, onMissionNews: (o: { id: string; title: string }) => news.push(o) });
    const h = mountHooks(useBoothPopOuts, opts([a], extra()));
    h.rerender(opts([b, a], extra()));
    h.rerender(opts([b, a], extra()));
    expect(heldKeys().map((x) => x.key)).toEqual(["mission:b"]);
    onMission = true;
    h.rerender(opts([b, a], extra()));
    expect(heldKeys()).toEqual([]);
    expect(news).toEqual([{ id: "b", title: "NEW MISSION · The bottle" }]);
    expect(vi.mocked(playTone)).not.toHaveBeenCalled();
  });

  it("a mission whose objective stays live but moves off the headline goes; one beside a game of the same cue goes", () => {
    const held = [{ spec: { key: "mission:b", title: "NEW MISSION · The bottle", glyph: "🍾", body: [], tone: "info" as const, priority: 35, at: 50_000, sticky: false } }];
    const ctx = { wanted: null, calls: null, guestOf: () => null, wctx: {} as never };
    expect(reconcilePopOuts(held, { ...ctx, objectives: [b, a] }).retire).toEqual([]);
    expect(reconcilePopOuts(held, { ...ctx, objectives: [a, b] }).retire).toEqual(["mission:b"]);
    const game = { spec: { key: "game:9", title: "YOUR GAME IS ON", glyph: "🍾", body: [], tone: "alarm" as const, priority: 55, at: 52_000, sticky: false } };
    expect(reconcilePopOuts([...held, game], { ...ctx, objectives: [b, a] }).retire).toEqual(["mission:b"]);
  });
});
