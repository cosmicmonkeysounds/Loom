// Wave 32 (docs/loom-w32-contract.md C5 + C6): the 🤖 Talk card in a host's
// Show window — its rules (talk-model.ts), the card drawn off a fixture host
// view with a talk scene, the slim bar's 🤖 Talk chip — and the phones'
// light takeover for a burst.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import type { ChatMessage, HostView } from "../src/types.ts";
import type { TalkView } from "../../core/src/talk-back.ts";
import { hostCalls } from "../src/host/api.ts";
import type { HostClient } from "../src/host/client.ts";
import { HostConsole, HostDock, type HostConsoleState } from "../src/host/dock.tsx";
import { HostShowWindow } from "../src/host/show.tsx";
import { showTarget } from "../src/host/show-model.ts";
import { ApiError } from "../src/client.ts";
import { ARM_LINE } from "../src/arm.ts";
import { clockSkew } from "../src/host/client.ts";
import { TalkBody } from "../src/host/talk.tsx";
import { TALK_MAX, TALK_PLACEHOLDER, TALK_RELAY, canSend, chipFace, chipKey, draftAfterSend, glitchText, talkChipShown, talkClock, talkErrorText, talkFoldedLine, talkLines, talkOpen, talkSecs, talkSentText, talkState } from "../src/host/talk-model.ts";
import { TAKEOVER_LIGHT_MS, TAKEOVER_MS, takeoverKind, takeoverStart } from "../src/moments/model.ts";
import { elements, mountHooks } from "./hooks-harness.ts";
import { hostFixture } from "./host-fixture.ts";


const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

/** A talk scene as the server's `talkView` builds it (made-up lines, not the show's). */
function talk(over: Partial<TalkView> = {}): TalkView {
  return {
    scene: "intro",
    title: "Meet the host",
    hint: "Say what Clippy says; let him answer; then start the hunt.",
    clippy: [
      { text: "Is everything all right up there?", label: "You OK?", direction: "he insists he is fine" },
      { text: "Shall we begin the hunt?" },
    ],
    trabolta: [{ text: "Everything is under control.", label: "Under control" }],
    glitch: "ad_burst",
    thinking: false,
    since: null,
    online: true,
    awake: true,
    ...over,
  };
}

const line = (seq: number, from: string, text: string, over: Partial<ChatMessage> = {}): ChatMessage =>
  ({ seq, channel: "loc:The Desktop", channelKind: "location", title: "The Desktop", from, kind: "line", text, ts: seq, audience: "all", parentSeq: null, hidden: false, ...over }) as ChatMessage;

describe("talk-model: the card's rules", () => {
  it("open for the relay (Task Manager), folded for other hosts; the host's own fold wins", () => {
    expect(TALK_RELAY).toBe("Task Manager");
    expect(talkOpen("Task Manager", undefined)).toBe(true);
    expect(talkOpen("Norton", undefined)).toBe(false);
    expect(talkOpen("Norton", true)).toBe(true);
    expect(talkOpen("Task Manager", false)).toBe(false);
    expect(talkOpen(null, undefined)).toBe(false);
    expect(talkFoldedLine()).toBe("Task Manager is relaying Clippy");
  });

  it("Trabolta's state: asleep first, then no mind online, then thinking… Ns (slow past 12 s), else listening", () => {
    expect(talkState(talk({ awake: false, online: false }), 0)).toEqual({ text: "💤 Trabolta is asleep", tone: "asleep" });
    expect(talkState(talk({ online: false }), 0).tone).toBe("off");
    expect(talkState(talk({ online: false }), 0).text).toBe("⚠ No mind online — use his canned lines");
    expect(talkState(talk({ thinking: true, since: 10_000 }), 14_900)).toEqual({ text: "🤖 thinking… 4s", tone: "thinking" });
    expect(talkState(talk({ thinking: true, since: 10_000 }), 22_000)).toEqual({ text: "🤖 thinking… 12s — tap one of his lines", tone: "slow" });
    expect(talkState(talk({ thinking: true, since: null }), 0).text).toBe("🤖 thinking…");
    expect(talkState(talk(), 0)).toEqual({ text: "👂 Trabolta is listening", tone: "ok" });
    // A phone clock behind the server's never reads a negative wait.
    expect(talkSecs(10_000, 9_000)).toBe(0);
    expect(talkSecs(null, 9_000)).toBeNull();
  });

  it("the room's last lines: the Desktop's spoken lines only, oldest first, at most four", () => {
    const msgs = [
      line(5, "Trabolta", "Welcome, programs."),
      line(1, "Clippy", "Hello!"),
      line(2, "Narrator", "The screen hums.", { kind: "narration" }),
      line(3, "Trabolta", "secret", { hidden: true }),
      line(4, "Clippy", "elsewhere", { channel: "loc:The Tube" }),
      line(6, "Clippy", "Are you OK?"),
      line(7, "Trabolta", "I am FINE."),
      line(8, "Clippy", "Good."),
    ];
    const got = talkLines(msgs);
    expect(got.map((l) => l.seq)).toEqual([5, 6, 7, 8]);
    expect(got.map((l) => l.his)).toEqual([true, false, true, false]);
    expect(talkLines(msgs, 10).map((l) => l.seq)).toEqual([1, 5, 6, 7, 8]);
  });

  it("send only with words, under the cap, nothing in flight", () => {
    expect(canSend("", false)).toBe(false);
    expect(canSend("   ", false)).toBe(false);
    expect(canSend("hi", true)).toBe(false);
    expect(canSend("hi", false)).toBe(true);
    expect(canSend("x".repeat(TALK_MAX + 1), false)).toBe(false);
  });

  it("a chip's face is its label, else its text; keys per scene and side", () => {
    expect(chipFace({ text: "Long words", label: "Short" })).toBe("Short");
    expect(chipFace({ text: "Long words", label: " " })).toBe("Long words");
    expect(chipFace({ text: "Long words" })).toBe("Long words");
    expect(chipKey("bottle", "trabolta", 2)).toBe("bottle:trabolta:2");
    // 📺 swaps one scene for the next with the card open: line k of each is a different key.
    expect(chipKey("bottle", "trabolta", 0)).not.toBe(chipKey("ad", "trabolta", 0));
  });

  it("after a send, only the sent words leave the box; words typed on in flight stay", () => {
    expect(draftAfterSend("You OK?", "You OK?")).toBe("");
    expect(draftAfterSend("You OK? Shall we", "You OK?")).toBe("Shall we");
    // Edited inside the sent words while in flight: nothing is lost.
    expect(draftAfterSend("You fine?", "You OK?")).toBe("You fine?");
    expect(draftAfterSend("", "You OK?")).toBe("");
  });

  it("the thinking count runs on the server's clock (the poll's Date header), not the phone's", () => {
    // A phone 60 s fast: its wall reads 60 s past the server's.
    const landed = Date.parse("Tue, 27 Oct 2026 20:00:00 GMT") + 60_000;
    const skew = clockSkew("Tue, 27 Oct 2026 20:00:00 GMT", landed);
    expect(skew).toBe(-60_000);
    expect(talkClock(landed, skew)).toBe(landed - 60_000);
    expect(clockSkew(null, 5)).toBe(0);
    expect(clockSkew("", 5)).toBe(0);
    expect(clockSkew("not a date", 5)).toBe(0);
    expect(talkClock(5, undefined)).toBe(5);
    // 3 s after a Clippy line on the server, the fast phone still reads 3 s, not "slow".
    const since = landed - 60_000;
    expect(talkState(talk({ thinking: true, since }), talkClock(landed + 3_000, skew))).toEqual({ text: "🤖 thinking… 3s", tone: "thinking" });
    expect(talkState(talk({ thinking: true, since }), landed + 3_000).tone).toBe("slow");
  });

  it("the server's refusals, said kindly", () => {
    expect(talkErrorText("no_talk", 409)).toBe("The talk scene is over — nothing was sent.");
    expect(talkErrorText("asleep", 409)).toBe("Trabolta is asleep — nothing was sent.");
    expect(talkErrorText("closed", 409)).toBe("The doors aren't open yet — nothing was sent.");
    expect(talkErrorText("too_long", 400)).toBe(`Too long — keep it under ${TALK_MAX} characters.`);
    expect(talkErrorText("empty", 400)).toBe("Type what Clippy said first.");
    expect(talkErrorText("not from a booth", 403)).toBe("This server can't relay yet — tell the director.");
    expect(talkErrorText("boom", 500)).toBe("Not sent — boom");
    expect(talkErrorText("Failed to fetch", 0)).toBe("Not sure it went through — Failed to fetch");
  });

  it("what a sent line and a ⚡ press say", () => {
    expect(talkSentText("Clippy", { ok: true, asked: true, online: true })).toBe("✓ Trabolta heard Clippy");
    expect(talkSentText("Clippy", { ok: true, asked: true, online: false })).toBe("✓ Sent — no mind online, tap one of his lines");
    expect(talkSentText("Trabolta", { ok: true })).toBe("✓ Trabolta said it");
    expect(glitchText({ ok: true })).toBe("✓ ⚡ Glitch");
    expect(glitchText({ refused: true })).toBe("⚡ No glitch right now — # hosts says why");
    expect(glitchText({ moved: true })).toBe("⚡ Cues moved — tap again");
  });

  it("the bar's chip: only with a scene on and the bar showing; a jump lands on the card", () => {
    expect(talkChipShown(talk(), true)).toBe(true);
    expect(talkChipShown(talk(), false)).toBe(false);
    expect(talkChipShown(null, true)).toBe(false);
    expect(talkChipShown(undefined, true)).toBe(false);
    expect(showTarget("talk")).toBe("talk");
  });
});

// --- the card, drawn ----------------------------------------------------------------

const hostAuth = (character: string) => ({ token: "t", character, admin: false, host: true, eventId: "e" });
function hostSession(character: string, messages: ChatMessage[] = []) {
  return { auth: hostAuth(character), messages: new Map(messages.map((m) => [m.seq, m])), view: null, threads: { open: () => {} } } as unknown as Parameters<typeof HostDock>[0]["session"];
}
function client(view: HostView): HostClient {
  return { view, receivedAt: 1_000, error: null, connected: true, refresh: () => {}, fresh: async () => {}, calls: hostCalls(async () => ({}), () => view.alerts.path) };
}
function render(view: HostView, o: { who?: string; showing?: boolean; messages?: ChatMessage[] } = {}): string {
  const session = hostSession(o.who ?? "Task Manager", o.messages);
  return renderToStaticMarkup(
    createElement(
      HostConsole,
      { session, wide: false, openCard: () => {}, client: client(view), showing: o.showing ?? true },
      ...(o.showing === false ? [] : [createElement(HostShowWindow, {})]),
      createElement(HostDock, { session, wide: false, openCard: () => {} }),
    ),
  );
}

describe("the 🤖 Talk card in Show", () => {
  it("Task Manager's stands open between NEXT and the status line: title, hint, state, lines, box, chips, ⚡, NEXT", () => {
    const html = render(hostFixture({ talk: talk() }), { messages: [line(1, "Clippy", "Hello, everyone!"), line(2, "Trabolta", "Greetings, programs.")] });
    const next = html.indexOf('data-testid="host-next-box"');
    const card = html.indexOf('data-testid="host-talk"');
    const status = html.indexOf('data-testid="host-show-status"');
    expect(next).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(next);
    expect(status).toBeGreaterThan(card);
    expect(html).toContain('data-show="talk"');
    expect(html).toContain("Meet the host");
    expect(html).toContain("Say what Clippy says; let him answer; then start the hunt.");
    expect(html).toContain("👂 Trabolta is listening");
    expect(html).toMatch(/host-talk-line his"><span class="host-talk-from">Trabolta:<\/span> Greetings, programs\./u);
    expect(html).toContain(`placeholder="${TALK_PLACEHOLDER}"`);
    expect(html).toContain(`maxLength="${TALK_MAX}"`);
    // Send is disabled while the box is empty.
    expect(html).toMatch(/<button type="button" class="w95-btn host-talk-send" disabled=""[^>]*>Send</u);
    expect(html).toContain(">You OK?</button>");
    expect(html).toContain(">Shall we begin the hunt?</button>");
    expect(html).toContain("Clippy says (tap = send)");
    expect(html).toContain("Trabolta says (tap twice)");
    expect(html).toContain(">Under control</button>");
    // The direction is the worker's, never on the phone.
    expect(html).not.toContain("he insists he is fine");
    expect(html).toContain('data-testid="host-talk-glitch"');
    // The console's own NEXT, with ARM, inside the card.
    expect(html).toMatch(/data-testid="host-talk-next"[\s\S]*Call everyone to the Desktop[\s\S]*aria-label="Arm C1"[^>]*>ARM</u);
  });

  it("another host sees it folded: who relays, and Open", () => {
    const html = render(hostFixture({ talk: talk() }), { who: "Norton" });
    expect(html).toContain('class="host-box host-talk folded"');
    expect(html).toContain("Task Manager is relaying Clippy");
    expect(html).toMatch(/aria-expanded="false">Open</u);
    expect(html).not.toContain('data-testid="host-talk-box"');
  });

  it("no talk scene (null, or an older server): no card", () => {
    expect(render(hostFixture({ talk: null }))).not.toContain('data-testid="host-talk"');
    expect(render(hostFixture())).not.toContain('data-testid="host-talk"');
  });

  it("no ⚡ when the scene names no glitch; no mind online reads on the card", () => {
    const html = render(hostFixture({ talk: talk({ glitch: null, online: false }) }));
    expect(html).not.toContain('data-testid="host-talk-glitch"');
    expect(html).toContain("⚠ No mind online — use his canned lines");
  });
});

describe("the slim bar's 🤖 Talk chip", () => {
  it("shows while a scene is on and Show is off screen", () => {
    const html = render(hostFixture({ talk: talk() }), { showing: false });
    expect(html).toContain('data-testid="host-nextbar"');
    expect(html).toMatch(/data-testid="host-talk-chip" aria-label="Open the Talk card"/u);
  });
  it("not without a scene, and not while Show is up (the bar steps aside)", () => {
    expect(render(hostFixture({ talk: null }), { showing: false })).not.toContain('data-testid="host-talk-chip"');
    expect(render(hostFixture({ talk: talk() }))).not.toContain('data-testid="host-talk-chip"');
  });
  it("its tap jumps to the card; the card's targets keep the 44 px floor", () => {
    expect(src("host/dock.tsx")).toMatch(/openTalk: \(\) => jumpTo\("talk"\)/u);
    const css = src("css/host.css");
    for (const sel of [".host-talk-fold", ".host-talk-send", ".host-talk-chip-btn", ".host-talk-glitch"]) expect(css).toMatch(new RegExp(`\\${sel} \\{[^}]*min-height: var\\(--tap\\)`, "u"));
    expect(css).toMatch(/\.host-talk-chip \{[^}]*min-width: var\(--tap\); min-height: var\(--tap\)/u);
  });
  it("the card stays in the booth's chunk: nothing the guest entry imports statically reaches it", () => {
    // Walk main.tsx's static imports (a dynamic import() is its own chunk).
    const root = new URL("../src/", import.meta.url);
    const seen = new Set<string>();
    const walk = (url: URL) => {
      if (seen.has(url.pathname)) return;
      seen.add(url.pathname);
      const text = readFileSync(url, "utf8");
      for (const m of text.matchAll(/^\s*(?:import|export)\s+(?:type\s)?[^;]*?from\s+"(\.{1,2}\/[^"]+)"/gmu)) {
        if (/^\s*(?:import|export)\s+type\s/u.test(m[0])) continue;
        const next = new URL(m[1]!, url);
        if (existsSync(next) && /\.tsx?$/u.test(next.pathname)) walk(next);
      }
    };
    walk(new URL("main.tsx", root));
    const rel = [...seen].map((p) => p.split("/src/").pop()!);
    expect(rel).toContain("main.tsx");
    expect(rel.length).toBeGreaterThan(20);
    expect(rel.filter((p) => /^host\/talk/u.test(p))).toEqual([]);
  });
});

describe("the light takeover for a burst (C5)", () => {
  it("a burst is light for every phone; otherwise the phone's own", () => {
    expect(takeoverKind("full", { light: true })).toBe("light");
    expect(takeoverKind("full", {})).toBe("full");
    expect(takeoverKind("full", null)).toBe("full");
    expect(takeoverKind("full", undefined)).toBe("full");
    expect(takeoverKind("light", {})).toBe("light");
    expect(takeoverKind("light", { light: true })).toBe("light");
  });
  it("the takeover a due glitch starts: a burst is the light one, 2.5 s, on a guest's phone too", () => {
    expect(takeoverStart(7, "full", { text: "BUY NOW", light: true })).toEqual({ at: 7, text: "BUY NOW", light: true, ms: TAKEOVER_LIGHT_MS });
    expect(takeoverStart(7, "full", { text: "BUY NOW" })).toEqual({ at: 7, text: "BUY NOW", light: false, ms: TAKEOVER_MS });
    expect(takeoverStart(7, "light", null)).toEqual({ at: 7, text: null, light: true, ms: TAKEOVER_LIGHT_MS });
  });
});

// --- the card, driven (hooks harness: taps, keys, sends) ----------------------------

type Post = { as: string; text: string; direction?: string };
type Ev = { target: { value: string } };
type Key = { key: string; shiftKey: boolean; nativeEvent: { isComposing: boolean }; preventDefault: () => void };

/** A deferred answer to one `calls.talk`. */
function deferred() {
  let resolve!: (v: Record<string, unknown>) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<Record<string, unknown>>((y, n) => {
    resolve = y;
    reject = n;
  });
  return { promise, resolve, reject };
}

/** TalkBody on a fake console: a recording `calls.talk`, the draft held
 *  outside (as the console holds it), and a rerender after every change. */
function drive(scene: TalkView = talk(), o: { skew?: number; now?: number } = {}) {
  let draft = "";
  const posts: Post[] = [];
  const answers: Array<ReturnType<typeof deferred>> = [];
  const toasts: string[] = [];
  const setTalkDraft = (v: string | ((d: string) => string)) => {
    draft = typeof v === "function" ? v(draft) : v;
  };
  const calls = {
    talk: (as: string, text: string, direction?: string) => {
      posts.push({ as, text, ...(direction !== undefined ? { direction } : {}) });
      const d = deferred();
      answers.push(d);
      return d.promise;
    },
    cue: async () => ({ ok: true }),
  };
  const c = () =>
    ({
      ctx: { now: o.now ?? 0, calls, session: { messages: new Map() } },
      client: { refresh: () => {}, skew: o.skew },
      desk: { setToast: (t: string | null) => t !== null && toasts.push(t), armed: null, pending: null, locked: () => false, tap: () => {} },
      bar: null,
      stale: false,
      talkDraft: draft,
      setTalkDraft,
    }) as unknown as HostConsoleState;
  let current = scene;
  const h = mountHooks(TalkBody as (p: { c: HostConsoleState; talk: TalkView }) => unknown, { c: c(), talk: current });
  const sync = () => h.rerender({ c: c(), talk: current });
  const all = () => elements(h.output) as Array<ReactElement<Record<string, unknown>>>;
  const byTest = (id: string) => all().find((e) => e.props["data-testid"] === id);
  const chips = (side: "clippy" | "trabolta") => all().filter((e) => e.type === "button" && String(e.props["className"]).includes(`host-talk-chip-btn ${side}`));
  const text = (e: ReactElement<Record<string, unknown>> | undefined): string => (e === undefined ? "" : elements(e.props["children"]).length === 0 ? String(e.props["children"] ?? "") : JSON.stringify(e.props["children"]));
  const flush = async () => {
    for (let n = 0; n < 5; n += 1) await Promise.resolve();
    sync();
  };
  return {
    h,
    posts,
    answers,
    toasts,
    get draft() {
      return draft;
    },
    type(v: string) {
      h.act(() => (byTest("host-talk-box")!.props["onChange"] as (e: Ev) => void)({ target: { value: v } }));
      sync();
    },
    key(k: Partial<Key>) {
      let prevented = false;
      const ev: Key = { key: "Enter", shiftKey: false, nativeEvent: { isComposing: false }, preventDefault: () => (prevented = true), ...k };
      h.act(() => (byTest("host-talk-box")!.props["onKeyDown"] as (e: Key) => void)(ev));
      sync();
      return prevented;
    },
    tap(e: ReactElement<Record<string, unknown>> | undefined) {
      h.act(() => (e!.props["onClick"] as () => void)());
      sync();
    },
    scene(next: TalkView) {
      current = next;
      sync();
    },
    byTest,
    chips,
    text,
    flush,
  };
}

describe("the 🤖 Talk card, driven", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("Send posts the box as Clippy; once taken, only the sent words leave — Clippy's next sentence typed in flight stays", async () => {
    const d = drive();
    d.type("Are you OK up there?");
    d.tap(d.byTest("host-talk-send"));
    expect(d.posts).toEqual([{ as: "Clippy", text: "Are you OK up there?" }]);
    expect(d.text(d.byTest("host-talk-send"))).toBe("Sending…");
    // The box stays live while it's in flight.
    d.type("Are you OK up there? You look");
    d.answers[0]!.resolve({ ok: true, asked: true, online: true });
    await d.flush();
    expect(d.draft).toBe("You look");
    expect(d.toasts).toEqual(["✓ Trabolta heard Clippy"]);
    expect(d.text(d.byTest("host-talk-send"))).toBe("Send");
  });

  it("an untouched box clears once the server took it", async () => {
    const d = drive();
    d.type("Hello!");
    d.tap(d.byTest("host-talk-send"));
    d.answers[0]!.resolve({ ok: true });
    await d.flush();
    expect(d.draft).toBe("");
  });

  it("a refused send keeps the draft and says why, kindly", async () => {
    const d = drive();
    d.type("Shall we begin?");
    d.tap(d.byTest("host-talk-send"));
    d.answers[0]!.reject(new ApiError("no_talk", 409));
    await d.flush();
    expect(d.draft).toBe("Shall we begin?");
    expect(d.text(d.byTest("host-talk-error"))).toBe("The talk scene is over — nothing was sent.");
    expect(d.toasts).toEqual([]);
    // Typing again clears the error.
    d.type("Shall we begin? Now?");
    expect(d.byTest("host-talk-error")).toBeUndefined();
  });

  it("Enter sends; Shift+Enter and an IME's Enter don't", () => {
    const d = drive();
    d.type("One");
    expect(d.key({ shiftKey: true })).toBe(false);
    expect(d.key({ nativeEvent: { isComposing: true } })).toBe(false);
    expect(d.key({ key: "a" })).toBe(false);
    expect(d.posts).toEqual([]);
    expect(d.key({})).toBe(true);
    expect(d.posts).toEqual([{ as: "Clippy", text: "One" }]);
  });

  it("a Clippy chip sends on one tap, with its hidden direction; nothing else goes while it's in flight", async () => {
    const d = drive();
    d.tap(d.chips("clippy")[0]);
    expect(d.posts).toEqual([{ as: "Clippy", text: "Is everything all right up there?", direction: "he insists he is fine" }]);
    expect(d.chips("clippy").every((b) => b.props["disabled"] === true)).toBe(true);
    d.answers[0]!.resolve({ ok: true });
    await d.flush();
    d.tap(d.chips("clippy")[1]);
    expect(d.posts[1]).toEqual({ as: "Clippy", text: "Shall we begin the hunt?" });
  });

  it("a Trabolta chip arms on the first tap and fires his line on the second", () => {
    vi.useFakeTimers({ now: 50_000 });
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} });
    vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
    const d = drive();
    d.tap(d.chips("trabolta")[0]);
    expect(d.posts).toEqual([]);
    expect(JSON.stringify(d.chips("trabolta")[0]!.props["children"])).toContain(ARM_LINE);
    vi.advanceTimersByTime(500);
    d.tap(d.chips("trabolta")[0]);
    expect(d.posts).toEqual([{ as: "Trabolta", text: "Everything is under control." }]);
    d.h.unmount();
  });

  it("an arm never carries into the next scene: 📺 swaps the scene, line 0's second tap only arms the new one", () => {
    vi.useFakeTimers({ now: 50_000 });
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} });
    vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
    const d = drive(talk({ scene: "bottle", trabolta: [{ text: "The bottle line." }] }));
    d.tap(d.chips("trabolta")[0]);
    d.scene(talk({ scene: "ad", trabolta: [{ text: "The ad line." }] }));
    // The new scene's chip shows its own face, not "Tap again to fire".
    expect(d.chips("trabolta")[0]!.props["children"]).toBe("The ad line.");
    vi.advanceTimersByTime(500);
    d.tap(d.chips("trabolta")[0]);
    expect(d.posts).toEqual([]);
    vi.advanceTimersByTime(500);
    d.tap(d.chips("trabolta")[0]);
    expect(d.posts).toEqual([{ as: "Trabolta", text: "The ad line." }]);
    d.h.unmount();
  });

  it("the state chip counts on the server's clock: a phone 60 s fast reads 3 s, not slow", () => {
    const since = 1_000_000;
    const d = drive(talk({ thinking: true, since }), { now: since + 63_000, skew: -60_000 });
    expect(d.text(d.byTest("host-talk-state"))).toBe("🤖 thinking… 3s");
  });
});
