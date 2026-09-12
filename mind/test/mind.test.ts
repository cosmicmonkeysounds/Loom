import { describe, expect, it } from "vitest";

import { Mind, factsFrom, guestOfDm, variablesFrom } from "../src/bridge.ts";
import { ModClient } from "../src/mod-api.ts";
import { DEFAULTS, parsePersona } from "../src/persona.ts";
import { buildMessages, stateBlock } from "../src/prompt.ts";
import { applyDelta, extractJson, parseReply } from "../src/reply.ts";
import { SseParser } from "../src/sse.ts";

const PERSONA = `---
character: Trabolta
model: llama3.2
endpoint: http://localhost:11434/v1/
temperature: 0.9
max_tokens: 120
variables: truth, untruth, stance, love
---

You are TRABOLTA.
Reply with JSON.
`;

describe("persona", () => {
  it("parses frontmatter knobs and the system prompt", () => {
    const p = parsePersona(PERSONA);
    expect(p.character).toBe("Trabolta");
    expect(p.model).toBe("llama3.2");
    expect(p.endpoint).toBe("http://localhost:11434/v1"); // trailing slash trimmed
    expect(p.temperature).toBe(0.9);
    expect(p.maxTokens).toBe(120);
    expect(p.variables).toEqual(["truth", "untruth", "stance", "love"]);
    expect(p.maxStep).toBe(DEFAULTS.maxStep);
    expect(p.system).toBe("You are TRABOLTA.\nReply with JSON.");
  });
  it("defaults everything but the character; refuses a persona with none", () => {
    const p = parsePersona("---\ncharacter: Clippy\n---\nHi.");
    expect(p.model).toBe(DEFAULTS.model);
    expect(p.variables).toEqual([]);
    expect(() => parsePersona("Just a prompt.")).toThrow(/character/u);
  });
});

describe("reply parsing", () => {
  const allowed = ["truth", "untruth", "stance", "love"];
  it("reads the JSON shape, clamps deltas, ignores undeclared variables", () => {
    const r = parseReply('{"say": "Hello, program.", "adjust": {"untruth": 40, "love": -3, "destruct": 3, "Stance": "2"}}', allowed, 15);
    expect(r.say).toBe("Hello, program.");
    expect(r.adjust).toEqual({ untruth: 15, love: -3, stance: 2 });
  });
  it("tolerates prose around the object, and code fences", () => {
    const r = parseReply('Sure! Here you go:\n```json\n{"say":"Gerald.","adjust":{}}\n```', allowed, 15);
    expect(r).toEqual({ say: "Gerald.", adjust: {} });
  });
  it("falls back to the raw text when the model ignores JSON", () => {
    expect(parseReply("I have considered it.", allowed, 15)).toEqual({ say: "I have considered it.", adjust: {} });
    expect(parseReply("```\nplain\n```", allowed, 15).say).toBe("plain");
  });
  it("extractJson handles braces inside strings", () => {
    expect(extractJson('x {"say": "a } b", "n": 1} y')).toEqual({ say: "a } b", n: 1 });
    expect(extractJson("no object")).toBeNull();
    expect(extractJson("{broken")).toBeNull();
  });
  it("applyDelta clamps to the world's range", () => {
    expect(applyDelta(95, 10, [0, 100])).toBe(100);
    expect(applyDelta(-95, -10)).toBe(-100);
    expect(applyDelta(35, 15)).toBe(50);
  });
});

describe("prompt", () => {
  const persona = parsePersona(PERSONA);
  const state = {
    variables: { truth: 35, untruth: 30, stance: -35, love: 50 },
    codex: [{ id: "The Joe Rogan Archive", title: "The Joe Rogan Archive", about: "World", text: "Two thousand\nhours." }],
    facts: { "Night.phase": "free_roam" },
  };
  const guest = {
    id: "g1",
    name: "Minesweeper",
    faction: null,
    codex: [{ id: "The Sandy File", title: "The Sandy File", about: "Trabolta", text: "…" }],
    facts: { humanity: "30", left_behind: "body" },
  };
  it("puts the live state under the persona and the thread as turns", () => {
    const msgs = buildMessages(persona, state, guest, [
      { mine: false, text: "are you real?" },
      { mine: true, text: "Define real." },
      { mine: false, text: "do you love Sandy?" },
    ]);
    expect(msgs[0]!.role).toBe("system");
    expect(msgs[0]!.content.startsWith("You are TRABOLTA.")).toBe(true);
    expect(msgs[0]!.content).toContain("truth=35, untruth=30, stance=-35, love=50");
    expect(msgs[0]!.content).toContain("Night.phase: free_roam");
    expect(msgs[0]!.content).toContain("You are talking to: Minesweeper");
    expect(msgs[0]!.content).toContain("Their humanity: 30");
    expect(msgs[0]!.content).toContain("They know: The Sandy File");
    expect(msgs[0]!.content).toContain("- The Joe Rogan Archive: Two thousand hours.");
    expect(msgs.slice(1).map((m) => [m.role, m.content])).toEqual([
      ["user", "are you real?"],
      ["assistant", "Define real."],
      ["user", "do you love Sandy?"],
    ]);
  });
  it("never ends on the assistant's own line", () => {
    const msgs = buildMessages(persona, state, guest, [{ mine: true, text: "Hello?" }]);
    expect(msgs[msgs.length - 1]!.role).toBe("user");
    expect(stateBlock(persona, { ...state, codex: [] }, { ...guest, codex: [] })).toContain("They know nothing yet.");
  });
});

describe("feed filtering + state extraction", () => {
  it("picks a guest's typed DM to the character and nothing else", () => {
    const base = { seq: 1, kind: "line", text: "hi", hidden: false };
    expect(guestOfDm({ ...base, channel: "dm:Trabolta", from: "Minesweeper", audience: ["g1"] }, "Trabolta")).toBe("g1");
    expect(guestOfDm({ ...base, channel: "dm:Trabolta", from: "Trabolta", audience: ["g1"] }, "Trabolta")).toBeNull();
    expect(guestOfDm({ ...base, channel: "dm:Clippy", from: "Minesweeper", audience: ["g1"] }, "Trabolta")).toBeNull();
    expect(guestOfDm({ ...base, channel: "dm:Trabolta", from: "Minesweeper", audience: "all" }, "Trabolta")).toBeNull();
    expect(guestOfDm({ ...base, channel: "dm:Trabolta", from: "Minesweeper", audience: ["g1"], kind: "system" }, "Trabolta")).toBeNull();
    expect(guestOfDm({ ...base, channel: "dm:Trabolta", from: "Minesweeper", audience: ["g1"], hidden: true }, "Trabolta")).toBeNull();
  });
  it("reads the character's variables and story facts out of the world table", () => {
    const world = [
      { path: "Trabolta.truth", value: "35" },
      { path: "Trabolta.love", value: "50" },
      { path: "Trabolta.glitched", value: "true" },
      { path: "Night.phase", value: "free_roam" },
      { path: "g1.truth", value: "8" },
    ];
    expect(variablesFrom(world, "Trabolta", ["truth", "love", "stance"])).toEqual({ truth: 35, love: 50 });
    expect(factsFrom(world, ["Night."])).toEqual({ "Night.phase": "free_roam" });
  });
});

describe("SseParser", () => {
  it("reassembles frames across chunk boundaries and skips pings", () => {
    const p = new SseParser();
    expect(p.feed(":ok\n\nevent: snap")).toEqual([]);
    expect(p.feed("shot\ndata: {\"a\":1}\n\n:ping\n\nevent: message\ndata: {\"b\"")).toEqual([{ event: "snapshot", data: '{"a":1}' }]);
    expect(p.feed(":2}\n\n")).toEqual([{ event: "message", data: '{"b":2}' }]);
  });
});

describe("Mind — end to end against a fake server + fake model", () => {
  function fakeServer() {
    const calls: Array<{ path: string; body: unknown }> = [];
    let truth = 35;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      const path = url.replace(/^https?:\/\/[^/]+/u, "");
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
      if (path.endsWith("/api/mod/login")) return json({ token: "T" });
      if (path.includes("/api/state?role=mod")) return json({ world: [{ path: "Trabolta.truth", value: String(truth) }, { path: "Night.phase", value: "free_roam" }, { path: "g1.humanity", value: "30" }], roster: [] });
      if (path.includes("/api/state?role=guest")) return json({ id: "g1", name: "Minesweeper", faction: null, codex: [] });
      if (path.includes("/api/state?role=prime")) return json({ codex: [{ id: "The Sandy File", title: "The Sandy File", about: "Trabolta", text: "Sandy." }] });
      if (path.endsWith("/api/mod/say") || path.endsWith("/api/mod/var")) {
        calls.push({ path, body });
        if (path.endsWith("/api/mod/var")) truth = Number((body as { value: string }).value);
        return json({ ok: true });
      }
      return json({ error: "nope" }, 404);
    };
    return { calls, fetchImpl };
  }

  it("answers a live guest DM once, in order, and nudges only declared variables", async () => {
    const { calls, fetchImpl } = fakeServer();
    const client = new ModClient({ server: "http://x", event: "evt", passcode: "MOD", fetchImpl });
    const seenPrompts: string[] = [];
    const mind = new Mind({
      client,
      persona: parsePersona(PERSONA),
      log: () => {},
      completeImpl: async (messages) => {
        seenPrompts.push(messages.map((m) => `${m.role}:${m.content}`).join("|"));
        return '{"say":"Define real.","adjust":{"truth":5,"destruct":3}}';
      },
    });
    // History is context, never answered.
    await mind.onFrame("history", JSON.stringify([{ seq: 0, channel: "dm:Trabolta", from: "Minesweeper", kind: "line", text: "old question", audience: ["g1"] }]));
    expect(calls).toEqual([]);
    // A live DM is answered; a lobby line and the echo of our own reply are not.
    await mind.onFrame("message", JSON.stringify({ seq: 1, channel: "lobby", from: "Minesweeper", kind: "line", text: "hello room", audience: "all" }));
    await mind.onFrame("message", JSON.stringify({ seq: 2, channel: "dm:Trabolta", from: "Minesweeper", kind: "line", text: "are you real?", audience: ["g1"] }));
    await mind.onFrame("message", JSON.stringify({ seq: 3, channel: "dm:Trabolta", from: "Trabolta", kind: "line", text: "Define real.", audience: ["g1"] }));
    expect(calls.map((c) => c.path.split("/").pop())).toEqual(["say", "var"]);
    expect(calls[0]!.body).toEqual({ as: "Trabolta", channel: "guest:g1", text: "Define real." });
    expect(calls[1]!.body).toEqual({ path: "Trabolta.truth", value: "40" });
    // The prompt carried the old question as context and the live state.
    expect(seenPrompts[0]).toContain("user:old question");
    expect(seenPrompts[0]).toContain("user:are you real?");
    expect(seenPrompts[0]).toContain("truth=35");
    expect(seenPrompts[0]).toContain("- The Sandy File: Sandy.");
    // A duplicate seq is ignored.
    await mind.onFrame("message", JSON.stringify({ seq: 2, channel: "dm:Trabolta", from: "Minesweeper", kind: "line", text: "are you real?", audience: ["g1"] }));
    expect(calls).toHaveLength(2);
  });

  it("dry run composes but sends nothing; a plain-text model reply is still a line", async () => {
    const { calls, fetchImpl } = fakeServer();
    const client = new ModClient({ server: "http://x", event: "default", passcode: "MOD", fetchImpl });
    expect(client.path("/api/mod/say")).toBe("/api/mod/say"); // default event → bare routes
    const mind = new Mind({ client, persona: parsePersona(PERSONA), dryRun: true, log: () => {}, completeImpl: async () => "I have considered it." });
    await mind.onFrame("history", "[]");
    await mind.onFrame("message", JSON.stringify({ seq: 9, channel: "dm:Trabolta", from: "Pinball", kind: "line", text: "?", audience: ["g2"] }));
    expect(calls).toEqual([]);
    const reply = await mind.answer("g2");
    expect(reply).toEqual({ say: "I have considered it.", adjust: {} });
  });
});
