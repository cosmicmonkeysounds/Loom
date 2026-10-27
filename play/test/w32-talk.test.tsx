// Wave 32 (docs/loom-w32-contract.md C5 + C6): the 🤖 Talk card in a host's
// Show window — its rules (talk-model.ts), the card drawn off a fixture host
// view with a talk scene, the slim bar's 🤖 Talk chip — and the phones'
// light takeover for a burst.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import type { ChatMessage, HostView } from "../src/types.ts";
import type { TalkView } from "../../core/src/talk-back.ts";
import { hostCalls } from "../src/host/api.ts";
import type { HostClient } from "../src/host/client.ts";
import { HostConsole, HostDock } from "../src/host/dock.tsx";
import { HostShowWindow } from "../src/host/show.tsx";
import { showTarget } from "../src/host/show-model.ts";
import { TALK_MAX, TALK_PLACEHOLDER, TALK_RELAY, canSend, chipFace, chipKey, glitchText, talkChipShown, talkErrorText, talkFoldedLine, talkLines, talkOpen, talkSecs, talkSentText, talkState } from "../src/host/talk-model.ts";
import { takeoverKind } from "../src/moments/model.ts";
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

  it("a chip's face is its label, else its text; keys per side", () => {
    expect(chipFace({ text: "Long words", label: "Short" })).toBe("Short");
    expect(chipFace({ text: "Long words", label: " " })).toBe("Long words");
    expect(chipFace({ text: "Long words" })).toBe("Long words");
    expect(chipKey("trabolta", 2)).toBe("trabolta:2");
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
  it("the card stays in the booth's chunk: no guest-side module imports it", () => {
    for (const f of ["guest/app.tsx", "ui.tsx", "moments/provider.tsx", "session/guest.ts"]) expect(src(f)).not.toMatch(/host\/talk/u);
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
  it("the provider plays it through takeoverKind", () => {
    expect(src("moments/provider.tsx")).toMatch(/const light = takeoverKind\(input\.takeover!, input\.glitch\) === "light";/u);
  });
});
