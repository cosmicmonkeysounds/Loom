// Wave 42b (B5): the guest's place in an agent-voiced character's line.
// Fixture `agentWait` frames (the server lane's shape: `{channel, audience,
// character, state, position?, etaS?}`) through the stream handler, the
// model, the guest's channels and the room's strip.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AGENT_WAIT_TTL_MS, applyAgentWait, useAgentWait, type AgentWait, type AgentWaitNotice } from "../src/agent-wait.ts";
import { etaLeft, etaWords, waitBar, waitLine, waitWords } from "../src/agent-wait-words.ts";
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

const fold = (frames: AgentWaitNotice[], at = Date.now()): ReadonlyMap<string, AgentWait> => frames.reduce<ReadonlyMap<string, AgentWait>>((m, f) => applyAgentWait(m, f, at), new Map());

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
    const m = fold([frame("queued", { position: 7, etaS: 60 }), frame("queued", { position: 3, etaS: 24 })], 1000);
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
    const h = mountHooks(useAgentWait, "g-1");
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

  it("another guest's frame is never this guest's wait", () => {
    const h = mountHooks(useAgentWait, "g-1");
    const out = () => h.output as ReturnType<typeof useAgentWait>;
    h.act(() => out().onAgentWait(frame("queued", { position: 3, audience: ["g-2"] })));
    h.act(() => out().onAgentWait(frame("answering", { audience: ["@Clippy"] })));
    expect(out().waits.size).toBe(0);
    h.act(() => out().onAgentWait(frame("queued", { position: 3 })));
    expect(out().waits.get("dm:Trabolta")?.position).toBe(3);
    // Another guest's idle does not clear mine.
    h.act(() => out().onAgentWait(frame("idle", { audience: ["g-2"] })));
    expect(out().waits.size).toBe(1);
  });

  it("a history frame (reconnect, story reset) clears every wait; the replay after it restores the open ones", () => {
    const h = mountHooks(useAgentWait, "g-1");
    const out = () => h.output as ReturnType<typeof useAgentWait>;
    h.act(() => out().onAgentWait(frame("queued", { position: 4 })));
    h.act(() => out().onAgentWait({ ...frame("answering"), channel: "dm:WebMD" }));
    expect(out().waits.size).toBe(2);
    const seen: string[] = [];
    const onFrame = chatFrameHandler(
      () => ({ onWaitsReset: () => (seen.push("reset"), out().onWaitsReset()), onHistory: () => void seen.push("history"), onAgentWait: (n) => out().onAgentWait(n) }),
      { replace: () => {}, upsert: () => {}, drop: () => {} },
    );
    // The server: `history`, then only the still-open waits (this one moved up; WebMD's went idle while asleep).
    h.act(() => onFrame("history", "[]"));
    expect(seen).toEqual(["reset", "history"]);
    expect(out().waits.size).toBe(0);
    h.act(() => onFrame("agentWait", JSON.stringify(frame("queued", { position: 2 }))));
    expect([...out().waits.keys()]).toEqual(["dm:Trabolta"]);
    expect(out().waits.get("dm:Trabolta")).toMatchObject({ position: 2, from: 2 });
  });

  it("another guest signing in on this phone starts with no waits", () => {
    const h = mountHooks(useAgentWait, "g-1");
    const out = () => h.output as ReturnType<typeof useAgentWait>;
    h.act(() => out().onAgentWait(frame("queued", { position: 4 })));
    h.act(() => h.rerender("g-2"));
    expect(out().waits.size).toBe(0);
  });

  it("no session, no waits", () => {
    const h = mountHooks(useAgentWait, null);
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

  it("the estimate counts down from its frame and is dropped, never negative, once it runs out", () => {
    const w = { etaS: 63, at: 10_000 };
    expect(etaLeft(w, 10_000)).toBe(63);
    expect(etaLeft(w, 40_000)).toBe(33);
    expect(etaLeft(w, 72_500)).toBe(1);
    expect(etaLeft(w, 73_000)).toBeNull();
    expect(etaLeft(w, 500_000)).toBeNull();
    expect(etaLeft({ etaS: null, at: 10_000 }, 10_000)).toBeNull();
    // Run out: the place stays, no time is said.
    expect(waitLine("Jean Trabolta", { position: 2, etaS: etaLeft(w, 90_000) })).toBe("Jean Trabolta is answering other programs. You are 2nd in line. Please do not move the mouse.");
  });

  it("splits the place, the wait and the tail (the wait is not spoken)", () => {
    expect(waitWords("Jean Trabolta", { position: 3, etaS: 20 })).toEqual(["Jean Trabolta is answering other programs. You are 3rd in line", ", about 20 sec", ". Please do not move the mouse."]);
    expect(waitWords("Jean Trabolta", { position: 3, etaS: null })[1]).toBe("");
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

  it("the guest's stream scopes waits to them and clears them on every history frame", () => {
    const src = readFileSync(new URL("../src/session/guest.ts", import.meta.url), "utf8");
    expect(src).toContain("useAgentWait(me?.id ?? null)");
    expect(src).toMatch(/useChatStream\(url, \{[^]*onAgentWait,\s*onWaitsReset,/u);
  });

  it("the room draws the strip (its own chunk) above the composer, never as a message", async () => {
    const c = withAgents([dm()], view, new Map(), fold([frame("queued", { position: 7, etaS: 63 })]))[0]!;
    const text = (h: string) => h.replace(/<[^>]+>/gu, "");
    const room = () => renderToStaticMarkup(<ChannelView channel={c} onBack={() => {}} onSend={() => {}} />);
    // Still loading: nothing in its place, and the room renders.
    expect(room()).not.toContain("wait-strip");
    await new Promise((r) => setTimeout(r, 20));
    const html = room();
    expect(html).toContain('class="wait-strip"');
    // Polite, the place spoken, the countdown hidden from a screen reader.
    expect(html).toContain('<span role="status" aria-live="polite">Jean Trabolta is answering other programs. You are 7th in line<span aria-hidden="true">, about 1 min</span>. Please do not move the mouse.</span>');
    expect(text(html)).toContain("Jean Trabolta is answering other programs. You are 7th in line, about 1 min.");
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
    // An old frame's estimate has run down: the place, no time.
    const old = fold([frame("queued", { position: 2, etaS: 30 })], Date.now() - 31_000).get("dm:Trabolta")!;
    expect(renderToStaticMarkup(<WaitStrip name="Jean Trabolta" wait={old} />)).toContain('You are 2nd in line<span aria-hidden="true"></span>. Please');
    const half = fold([frame("queued", { position: 2, etaS: 90 })], Date.now() - 45_000).get("dm:Trabolta")!;
    expect(renderToStaticMarkup(<WaitStrip name="Jean Trabolta" wait={half} />)).toContain(", about 45 sec");
    // No position: the words, no bar.
    const none = fold([frame("queued")]).get("dm:Trabolta")!;
    expect(renderToStaticMarkup(<WaitStrip name="Jean Trabolta" wait={none} />)).not.toContain("wait-bar");
  });
});
