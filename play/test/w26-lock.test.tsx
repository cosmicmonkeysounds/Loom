//! Wave 26 (R1, CONTRACTS C2): the locked phone. While the story's `lock:`
//! header holds (`GuestView.locked`) — or a write came back `403 locked` —
//! the guest sees only the lock screen: the ⛔ card, Show my pass and the
//! `restricted: allow` buttons, the NOW objective, the Installation
//! Wizard's thread read-only. No composer, no menus, no cards, no Start.

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/client.ts";
import { LOCK_HEAD, LOCK_THREAD, LockScreen, lockButtons, lockLines, lockThread } from "../src/guest/lock.tsx";
import { LockFrame } from "../src/guest/lock-lazy.tsx";
import { lockedRefusal, sayRefusalText } from "../src/session/guest.ts";
import type { Channel, ChatMessage, Interaction, ObjectiveView } from "../src/types.ts";
import { readBundledCss } from "./css.ts";

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const msg = (seq: number, over: Partial<ChatMessage> = {}): ChatMessage => ({ seq, from: "Installation Wizard", text: `line ${seq}`, channel: LOCK_THREAD, ts: seq, kind: "line", parentSeq: null, ...over }) as ChatMessage;
const room = (id: string, messages: ChatMessage[], kind = "dm"): Channel => ({ id, title: id.replace(/^dm:/u, ""), kind, messages }) as unknown as Channel;
const findGerald: ObjectiveView = { id: "find_gerald", title: "Find Gerald", brief: "Find Gerald, the golden duck.", checklist: [{ label: "🦆 Find Gerald", done: false }], buttons: ["pass"], act: null };
const I = (id: string, label: string, extra: Partial<Interaction> = {}): Interaction => ({ id, label, who: "guest", description: null, ...extra });
const noop = () => {};

describe("what the lock screen keeps", () => {
  it("the Installation Wizard's thread, else the DM that spoke last", () => {
    const wiz = room(LOCK_THREAD, [msg(3)]);
    const trab = room("dm:Trabolta", [msg(9, { channel: "dm:Trabolta" })]);
    expect(lockThread([trab, wiz])?.id).toBe(LOCK_THREAD);
    expect(lockThread([room("dm:Clippy", [msg(2)]), trab, room("loc:The Desktop", [msg(20)], "location")])?.id).toBe("dm:Trabolta");
    expect(lockThread([room("loc:The Desktop", [msg(20)], "location")])).toBeNull();
  });
  it("read-only lines: never a card, a reply or a system row", () => {
    const kept = lockLines([msg(1), msg(2, { kind: "widget", widget: { kind: "poll", text: "?" } as never }), msg(3, { parentSeq: 1 }), msg(4, { kind: "system" }), msg(5, { kind: "narration" })]);
    expect(kept.map((m) => m.seq)).toEqual([1, 5]);
  });
  it("only the live buttons the view kept (the server filters to restricted: allow)", () => {
    expect(lockButtons([I("go to the bathroom", "🚻 Bathroom Mode"), I("back from the bathroom", "↩ Back from the bathroom", { live: false })]).map((i) => i.id)).toEqual(["go to the bathroom"]);
  });
});

describe("the lock screen", () => {
  const props = {
    objective: findGerald,
    rooms: [room(LOCK_THREAD, [msg(1, { text: "Welcome to the reinstallation." }), msg(2, { kind: "widget", widget: { kind: "poll", text: "Pick one" } as never })])],
    interactions: [I("go to the bathroom", "🚻 Bathroom Mode")],
    onPass: noop,
    onAct: noop,
  };
  // The lazy body; the eager frame (title bar, moments, Pass) renders around it.
  const body = renderToStaticMarkup(<LockScreen {...props} />);
  const frame = renderToStaticMarkup(<LockFrame {...props} title="Trapped in the Internet" me="g1" pins={[]} paused={false} conn="live" />);
  const html = frame + body;
  it("the ⛔ card, Show my pass and Bathroom Mode", () => {
    expect(html).toContain(LOCK_HEAD);
    expect(html).toContain("🎟 Show my pass");
    expect(html).toContain("🚻 Bathroom Mode");
  });
  it("the Find Gerald card without its buttons, and the thread read-only", () => {
    expect(html).toContain("Find Gerald");
    expect(html).toContain("Welcome to the reinstallation.");
    expect(html).not.toContain("Pick one");
    expect(html).not.toContain("objective-buttons");
    expect(html).not.toMatch(/composer|<textarea|<input/u);
  });
  it("a taskbar with only Pass: no Start, no Mission, no Chats, no Scan", () => {
    const bar = frame.slice(frame.indexOf('class="taskbar lock-bar"'));
    expect(bar).toContain(">Pass<");
    for (const w of ["Start", "Mission", "Chats", "Scan"]) expect(bar).not.toContain(`>${w}<`);
  });
  it("its copy is marked DRAFT for the sign-off", () => {
    expect(src("guest/lock.tsx")).toMatch(/\/\/ DRAFT w26 \(R1\)[^\n]*\nexport const LOCK_HEAD/u);
    expect(src("guest/lock.tsx")).toMatch(/\/\/ DRAFT w26 \(R1\)[^\n]*\nexport const LOCK_TEXT/u);
  });
  it("its buttons are 48 px; the screen scrolls inside the frame", () => {
    const css = readBundledCss().replace(/\/\*[\s\S]*?\*\//gu, "");
    expect(css).toMatch(/\.lock-actions \.lock-btn \{[^}]*min-height: 48px;/u);
    expect(css).toMatch(/\.lock-screen \{[^}]*flex: 1 1 auto;[^}]*min-height: 0;[^}]*overflow-y: auto;/u);
  });
});

describe("the frame is eager: a lock chunk still loading (or failing) keeps the pass and the moments", () => {
  it("the frame has the title bar and Pass around the screen; the part waits on an empty screen", () => {
    const frame = renderToStaticMarkup(<LockFrame objective={findGerald} rooms={[]} interactions={[]} onPass={noop} onAct={noop} title="T" me="g1" pins={[]} paused={false} conn="live" />);
    expect(frame).toContain("🔒 captured");
    expect(frame).toContain('class="lock-screen"');
    expect(frame).toMatch(/class="taskbar lock-bar"[\s\S]*>Pass</u);
    expect(src("guest/lock-lazy.tsx")).toMatch(/"This screen", <main className="lock-screen" aria-busy \/>\);/u);
  });
  it("the moments layer and the bar live in lock-lazy.tsx, not in the lazy lock.tsx", () => {
    expect(src("guest/lock-lazy.tsx")).toMatch(/<MomentsAndPins pins=\{pins\} me=\{me\} \/>\s*<LazyLockScreen \{\.\.\.screen\} \/>\s*<nav className="taskbar lock-bar"/u);
    expect(src("guest/lock.tsx")).not.toMatch(/MomentsAndPins|lock-bar|NowBar/u);
    expect(src("guest/app.tsx")).toMatch(/<LockFrame\s/u);
  });
  it("a failed chunk's Try again fills the screen's place, above the bar", () => {
    const css = readBundledCss().replace(/\/\*[\s\S]*?\*\//gu, "");
    expect(css).toMatch(/\.guest-frame\.locked > \.lazy-failed \{ flex: 1 1 auto;/u);
  });
});

describe("a `403 locked` answer", () => {
  it("is recognised, and never a toast", () => {
    const e = new ApiError("locked", 403, { error: "locked" });
    expect(lockedRefusal(e)).toBe(true);
    expect(lockedRefusal(new ApiError("not from a booth", 403))).toBe(false);
    expect(lockedRefusal(new Error("locked"))).toBe(false);
    expect(sayRefusalText(e)).toBeNull();
  });
  it("the guest app swaps to the lock screen on s.locked, which the session derives from the view or the 403", () => {
    expect(src("guest/app.tsx")).toMatch(/if \(s\.locked\) \{/u);
    expect(src("session/guest.ts")).toMatch(/locked: status\?\.locked === true \|\| locked403/u);
    expect(src("session/guest.ts")).toMatch(/if \(lockedRefusal\(e\)\) setLocked403\(true\);/u);
  });
  it("a ?unlock= or ?checkin= link opened while locked raises no toast", () => {
    const g = src("session/guest.ts");
    for (const kind of ["unlock", "checkin"]) expect(g).toContain(`if ("e" in a) return lockedRefusal(a.e) ? undefined : alertsRef.current?.raise(m.scanErrorNote(a.e, "${kind}"), { quiet: true });`);
    expect(g).not.toMatch(/if \("e" in a\) return alertsRef\.current\?\.raise\(m\.scanErrorNote/u);
  });
});

describe("the lock screen stays out of the first load", () => {
  it("only lock-lazy.tsx loads lock.tsx, and only by import()", () => {
    expect(src("guest/lock-lazy.tsx")).toContain('import("./lock.tsx")');
    for (const f of ["guest/app.tsx", "ui.tsx", "guest/frame.tsx", "session/guest.ts"]) expect(src(f), f).not.toMatch(/^import (?!type )[^;]*from "[./]*(guest\/)?lock\.tsx"/mu);
  });
});
