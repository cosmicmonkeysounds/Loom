// Wave 42b (B5): the guest's place in an agent-voiced character's line.
// Fixture `agentWait` frames (the server lane's shape: `{channel, audience,
// character, state, position?, etaS?}`) through the stream handler, the
// model, the guest's channels and the room's strip.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AGENT_WAIT_TTL_MS, applyAgentWait, useAgentWait, type AgentWait, type AgentWaitNotice } from "../src/agent-wait.ts";
import { etaWords, waitBar, waitLine } from "../src/agent-wait-words.ts";
import { mountHooks } from "./hooks-harness.ts";
import { ChannelView } from "../src/chat.tsx";
import { chatFrameHandler } from "../src/client.ts";
import { withAgents } from "../src/session.ts";
import { WaitStrip } from "../src/stream/wait-strip.tsx";
import type { Channel, GuestView } from "../src/types.ts";

const frame = (state: AgentWaitNotice["state"], extra: Partial<AgentWaitNotice> = {}): AgentWaitNotice => ({
  channel: "dm:Trabolta",
  audience: ["g-1"],
  character: "Trabolta",
  state,
  ...extra,
});

const fold = (frames: AgentWaitNotice[], at = 1000): ReadonlyMap<string, AgentWait> => frames.reduce<ReadonlyMap<string, AgentWait>>((m, f) => applyAgentWait(m, f, at), new Map());

function dm(extra: Partial<Channel> = {}): Channel {
  return { id: "dm:Trabolta", kind: "dm", title: "Jean Trabolta", spaceId: "story", messages: [], unread: 0, decision: null, lastTs: 0, ...extra };
}

const view = { people: [{ id: "Trabolta", name: "Jean Trabolta", kind: "character", faction: null, known: [], location: null, agent: { online: true } }] } as unknown as GuestView;

describe("the agentWait frame", () => {
  it("reaches its handler through the chat stream", () => {
    const seen: AgentWaitNotice[] = [];
    const onFrame = chatFrameHandler(() => ({ onAgentWait: (n) => seen.push(n) }), { replace: () => {}, upsert: () => {}, drop: () => {} });
    onFrame("agentWait", JSON.stringify(frame("queued", { position: 7, etaS: 42 })));
    expect(seen).toEqual([frame("queued", { position: 7, etaS: 42 })]);
  });
});

describe("the wait model", () => {
  it("keeps the furthest place back while the line moves up, and idle clears it", () => {
    const m = fold([frame("queued", { position: 7, etaS: 60 }), frame("queued", { position: 3, etaS: 24 })]);
    expect(m.get("dm:Trabolta")).toMatchObject({ state: "queued", position: 3, etaS: 24, from: 7, at: 1000 });
    expect(waitBar(m.get("dm:Trabolta")!)).toEqual({ done: 5, total: 7 });
    const answering = applyAgentWait(m, frame("answering"), 2000);
    expect(answering.get("dm:Trabolta")).toMatchObject({ state: "answering", position: null, from: null });
    const idle = applyAgentWait(answering, frame("idle"), 3000);
    expect(idle.has("dm:Trabolta")).toBe(false);
    // An idle for a thread not waiting changes nothing (same map).
    expect(applyAgentWait(idle, frame("idle"), 4000)).toBe(idle);
  });

  it("a new wait after an answer starts its bar again", () => {
    const m = fold([frame("queued", { position: 9 }), frame("answering"), frame("queued", { position: 2 })]);
    expect(m.get("dm:Trabolta")!.from).toBe(2);
    expect(waitBar(m.get("dm:Trabolta")!)).toEqual({ done: 1, total: 2 });
  });

  it("drops a nonsense position or eta rather than showing it", () => {
    const w = fold([frame("queued", { position: 0, etaS: -3 })]).get("dm:Trabolta")!;
    expect(w.position).toBeNull();
    expect(w.etaS).toBeNull();
    expect(waitBar(w)).toBeNull();
  });

  it("lingers no longer than a typing note", () => {
    expect(AGENT_WAIT_TTL_MS).toBe(150_000);
  });
});

describe("useAgentWait", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
    vi.stubGlobal("window", { setTimeout: (f: () => void, ms: number) => setTimeout(f, ms) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("a wait with no follow-up ages out; a newer frame restarts its clock; a public thread is ignored", () => {
    const h = mountHooks(useAgentWait, true);
    const out = () => h.output as ReturnType<typeof useAgentWait>;
    h.act(() => out().onAgentWait(frame("queued", { position: 5 })));
    expect(out().waits.get("dm:Trabolta")?.position).toBe(5);
    vi.advanceTimersByTime(AGENT_WAIT_TTL_MS - 10_000);
    h.act(() => out().onAgentWait(frame("queued", { position: 4 })));
    // The first frame's timer fires: the newer frame keeps the wait.
    h.act(() => vi.advanceTimersByTime(10_000));
    expect(out().waits.get("dm:Trabolta")?.position).toBe(4);
    h.act(() => vi.advanceTimersByTime(AGENT_WAIT_TTL_MS));
    expect(out().waits.size).toBe(0);
    h.act(() => out().onAgentWait({ ...frame("queued", { position: 1 }), channel: "loc:The Desktop", public: true }));
    expect(out().waits.size).toBe(0);
  });

  it("no session, no waits", () => {
    const h = mountHooks(useAgentWait, false);
    const out = () => h.output as ReturnType<typeof useAgentWait>;
    h.act(() => out().onAgentWait(frame("queued", { position: 2 })));
    expect(out().waits.size).toBe(0);
  });
});

describe("the strip's words (DRAFT w42)", () => {
  it("says the place and the wait, in the thread's own name", () => {
    expect(waitLine("Jean Trabolta", { position: 7, etaS: 63 })).toBe("Jean Trabolta is answering other programs. You are 7th in line, about 1 min. Please do not move the mouse.");
    expect(waitLine("Jean Trabolta", { position: 1, etaS: 6 })).toBe("Jean Trabolta is answering other programs. You are next in line, about 5 sec. Please do not move the mouse.");
    expect(waitLine("Clippy", { position: null, etaS: null })).toBe("Clippy is answering other programs. You are in line. Please do not move the mouse.");
  });

  it("spells ordinals and rounds the wait", () => {
    const place = (n: number) => /You are (\S+) in line/.exec(waitLine("X", { position: n, etaS: null }))![1];
    expect([2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(place)).toEqual(["2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th"]);
    expect([0, 2, 33, 59, 60, 89, 90, 164].map(etaWords)).toEqual(["about 5 sec", "about 5 sec", "about 35 sec", "about 55 sec", "about 1 min", "about 1 min", "about 2 min", "about 3 min"]);
  });
});

describe("the guest's DM with him", () => {
  it("queued: the thread carries the wait; answering: the typing note; idle: neither", () => {
    const queued = fold([frame("queued", { position: 4, etaS: 20 })]);
    const [q] = withAgents([dm()], view, new Map(), queued);
    expect(q!.wait).toMatchObject({ state: "queued", position: 4 });
    expect(q!.typing).toBeUndefined();

    const [a] = withAgents([dm()], view, new Map(), fold([frame("answering")]));
    expect(a!.typing).toBe("Trabolta");
    expect(a!.wait).toBeUndefined();

    const [i] = withAgents([dm()], view, new Map(), fold([frame("queued", { position: 4 }), frame("idle")]));
    expect(i!.wait).toBeUndefined();
    expect(i!.typing).toBeUndefined();
  });

  it("a typing frame wins over a wait that never heard its answering", () => {
    const [c] = withAgents([dm()], view, new Map([["dm:Trabolta", "Trabolta"]]), fold([frame("queued", { position: 2 })]));
    expect(c!.typing).toBe("Trabolta");
    expect(c!.wait).toBeUndefined();
  });

  it("the guest's first load carries the waits, not the strip or its words", () => {
    const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
    expect(src("stream/channel-view.tsx")).toContain('import("./wait-strip.tsx")');
    expect(src("stream/channel-view.tsx")).not.toMatch(/^import [^;]*(wait-strip|agent-wait-words)/mu);
    expect(src("agent-wait.ts")).not.toMatch(/^import [^;]*agent-wait-words/mu);
    // No `//!` headers: esbuild keeps those in the bundle.
    for (const f of ["agent-wait.ts", "agent-wait-words.ts", "stream/wait-strip.tsx"]) expect(src(f)).not.toMatch(/^\/\/!/mu);
  });

  it("the room draws the strip (its own chunk) above the composer, never as a message", async () => {
    const c = withAgents([dm()], view, new Map(), fold([frame("queued", { position: 7, etaS: 63 })]))[0]!;
    const room = () => renderToStaticMarkup(<ChannelView channel={c} onBack={() => {}} onSend={() => {}} />);
    // Still loading: nothing in its place, and the room renders.
    expect(room()).not.toContain("wait-strip");
    await new Promise((r) => setTimeout(r, 20));
    const html = room();
    expect(html).toContain('class="wait-strip" role="status"');
    expect(html).toContain("Jean Trabolta is answering other programs. You are 7th in line, about 1 min.");
    expect(html.indexOf("wait-strip")).toBeLessThan(html.indexOf("stream-foot"));
    expect(html).not.toMatch(/class="msg[^"]*"[^>]*>[^]*answering other programs/u);
    // Answering: the typing note, no strip.
    const a = withAgents([dm()], view, new Map(), fold([frame("answering")]))[0]!;
    const typed = renderToStaticMarkup(<ChannelView channel={a} onBack={() => {}} onSend={() => {}} />);
    expect(typed).not.toContain("wait-strip");
    expect(typed).toContain("Trabolta is typing");
  });

  it("the strip's bar fills as the line moves up", () => {
    const w = fold([frame("queued", { position: 10 }), frame("queued", { position: 1 })]).get("dm:Trabolta")!;
    const html = renderToStaticMarkup(<WaitStrip name="Jean Trabolta" wait={w} />);
    expect(html).toContain('<i style="width:100%"></i>');
    expect(html).toContain("You are next in line");
    const mid = fold([frame("queued", { position: 8 }), frame("queued", { position: 5 })]).get("dm:Trabolta")!;
    expect(renderToStaticMarkup(<WaitStrip name="Jean Trabolta" wait={mid} />)).toContain('<i style="width:50%"></i>');
    // No position: the words, no bar.
    const none = fold([frame("queued")]).get("dm:Trabolta")!;
    expect(renderToStaticMarkup(<WaitStrip name="Jean Trabolta" wait={none} />)).not.toContain("wait-bar");
  });
});
