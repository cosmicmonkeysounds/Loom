// Wave 25 (docs/loom-house-desk.md §6.2): a host booth's windows — the
// taskbar Show · Chats · Desk · Scan, Show as home (the NOW card steps
// aside, the slim bar too), the Show window drawn off a fixture host view,
// and the Desk window off a fixture desk view.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import type { Channel, HostView, PrimeView } from "../src/types.ts";
import { hostCalls } from "../src/host/api.ts";
import type { HostClient } from "../src/host/client.ts";
import { hostFixture } from "./host-fixture.ts";
import { readBundledCss } from "./css.ts";
import { deskFixture } from "./desk-fixture.ts";

let current: unknown = null;
vi.mock("../src/session/prime.ts", async (orig) => ({ ...(await orig<typeof import("../src/session/prime.ts")>()), usePrimeSession: () => current }));

const { PerformerApp } = await import("../src/booth/app.tsx");
const { buildPrimeChannels } = await import("../src/session/prime.ts");
const { HostConsole, HostDock } = await import("../src/host/dock.tsx");
const { HostShowWindow } = await import("../src/host/show.tsx");
const { hostTaskbarButtons } = await import("../src/host/windows.tsx");
const { DeskBody } = await import("../src/host/desk.tsx");

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

function session(view: PrimeView, auth: Record<string, unknown> = {}) {
  const list: Channel[] = buildPrimeChannels(new Map(), view);
  return {
    auth: { token: "t", character: view.character, admin: false, eventId: "e", title: "Show", ...auth },
    ready: true,
    view,
    messages: new Map(),
    threads: { list, spaces: [], activeId: null, active: null, open: () => {}, back: () => {}, activeThreadRoot: null, openThread: () => {}, closeThread: () => {}, markRead: () => {} },
    alerts: { raise: () => {}, alert: null, dismiss: () => {} },
    notice: null,
    roomLinkPending: false,
    connected: true,
    widgetAnswers: new Map(),
  };
}

const prime = (over: Partial<PrimeView> = {}): PrimeView =>
  ({
    character: "Task Manager",
    faction: null,
    guests: [],
    channels: [],
    spaces: [],
    interactions: [],
    objectives: [{ id: "doors", title: "🚪 Run the door", brief: "Greet each guest.", checklist: [{ label: "Say hello", done: false }], buttons: [], act: null }],
    ...over,
  }) as PrimeView;

describe("a host booth's frame", () => {
  it("the taskbar reads Show · Chats · Desk · Scan; Show is home; no NOW card, no Guests button", () => {
    current = session(prime({ host: true }), { host: true });
    const html = renderToStaticMarkup(<PerformerApp onLeave={() => {}} />);
    const tours = [...html.matchAll(/data-tour="(show|chats|desk|scan|guests)"/gu)].map((m) => m[1]);
    expect(tours).toEqual(["show", "chats", "desk", "scan"]);
    expect(html).toMatch(/data-tour="show"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-tour="show"/u);
    expect(html).toContain('data-testid="host-show"');
    expect(html).not.toContain("booth-now-bar");
    // Show is on screen: the slim NEXT bar steps aside.
    expect(html).not.toContain('data-testid="host-nextbar"');
  });
  it("a plain performer keeps Scan · Guests and the NOW card", () => {
    current = session(prime());
    const html = renderToStaticMarkup(<PerformerApp onLeave={() => {}} />);
    expect(html).toContain('data-tour="guests"');
    expect(html).not.toContain('data-tour="desk"');
    expect(html).toContain("booth-now-bar");
  });
  it("the taskbar's windows: pressed is the window on screen, the waiting guests badge Chats", () => {
    const b = hostTaskbarButtons({ pressed: "desk", chatsBadge: 2, scanOpen: false, open: () => {}, scan: () => {} });
    expect(b.map((x) => x.label)).toEqual(["Show", "Chats", "Desk", "Scan"]);
    expect(b.map((x) => x.pressed === true)).toEqual([false, false, true, false]);
    expect(b[1]!.badge).toBe(2);
    expect(b[3]!.primary).toBe(true);
    expect(hostTaskbarButtons({ pressed: null, chatsBadge: 0, scanOpen: true, open: () => {}, scan: () => {} })[1]!.badge).toBeUndefined();
  });
});

const hostAuth = { token: "t", character: "Task Manager", admin: false, host: true, eventId: "e" };
const hostSession = { auth: hostAuth, messages: new Map(), view: null, threads: { open: () => {} } } as unknown as Parameters<typeof HostDock>[0]["session"];
function client(view: HostView | null): HostClient {
  return { view, receivedAt: 1_000, error: null, connected: true, refresh: () => {}, fresh: async () => {}, calls: view === null ? null : hostCalls(async () => ({}), () => view.alerts.path) };
}
function show(view: HostView | null, o: { showing?: boolean; jobs?: string } = {}): string {
  return renderToStaticMarkup(
    createElement(
      HostConsole,
      { session: hostSession, wide: false, openCard: () => {}, client: client(view), showing: o.showing ?? true },
      createElement(HostShowWindow, { jobs: o.jobs !== undefined ? createElement("p", null, o.jobs) : undefined, jobCount: o.jobs !== undefined ? 1 : 0, openGuests: () => {} }),
      createElement(HostDock, { session: hostSession, wide: false, openCard: () => {} }),
    ),
  );
}

describe("the Show window", () => {
  it("the night strip, a big NEXT with ARM, then the sections in order", () => {
    const html = show(hostFixture(), { jobs: "Run the door" });
    expect(html).toContain('class="host-show-strip"');
    expect(html).toMatch(/host-show-chip phase">Arrivals/u);
    expect(html).toMatch(/host-box-next[^"]*host-show-next/u);
    expect(html).toContain("Call everyone to the Desktop");
    expect(html).toMatch(/aria-label="Arm C1"[^>]*>ARM</u);
    const heads = [...html.matchAll(/class="host-show-head[^"]*" aria-expanded="(true|false)">[\s\S]*?<\/span>([^<]*)<\/button>/gu)].map((m) => `${m[2]}:${m[1]}`);
    expect(heads).toEqual(["Your jobs (1):true", "Needs you (2):true", "Coming up:true", "Judge (1):true", "Cue sheet:false", "People (2):false", "More:false"]);
    expect(html).toContain("Run the door");
    // Needs is open, with today's rows; the cue sheet is folded.
    expect(html).toContain("💰 1 held transfer");
    expect(html).not.toContain("Filter cues");
    // The bar steps aside while Show is on screen.
    expect(html).not.toContain('data-testid="host-nextbar"');
  });
  it("with Show off screen the slim bar is back, and its tap opens Show", () => {
    const html = show(hostFixture(), { showing: false });
    expect(html).toContain('data-testid="host-nextbar"');
    expect(html).toContain("Open the Show window.");
  });
  it("nothing to press: the card says why", () => {
    const html = show(hostFixture({ interactions: [] }));
    expect(html).toContain("NEXT — nothing to press");
  });
  it("before the first view: Loading; not a host: nothing", () => {
    expect(show(null)).toContain("Loading the cue sheet…");
    const performer = { ...hostSession, auth: { ...hostAuth, host: false } } as typeof hostSession;
    expect(renderToStaticMarkup(createElement(HostConsole, { session: performer, wide: false, openCard: () => {} }, createElement(HostShowWindow, {})))).toBe("");
  });
});

describe("the Desk window", () => {
  const calls = hostCalls(async () => ({}), () => "");
  const desk = (v = deskFixture()) => renderToStaticMarkup(createElement(DeskBody, { view: v, calls, client: { receivedAt: 1_000, connected: true, error: null, refresh: () => {} }, me: "Task Manager" }));
  it("status chips, STOP ALL, the standby cue with GO and its story events", () => {
    const html = desk();
    expect(html).toContain("🔊 router online (house-mac) · MOTU 828x");
    expect(html).toContain("1 sound missing");
    expect(html).toContain("■ STOP ALL");
    expect(html).toContain("12 · The Heart wakes");
    expect(html).toMatch(/class="w95-btn host-desk-go"[^>]*>GO</u);
    expect(html).toContain("⚡ Tells the story: heart_speaks, heart_reveal_done");
    expect(html).toContain("📝 Stand by the door");
  });
  it("what is playing with its progress and Stop; the cue list by section, the standby marked", () => {
    const html = desk();
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuenow="\d+"/u);
    expect(html).toContain("■ Stop");
    expect(html).toContain('<h4 class="host-desk-sec">Pre-show</h4>');
    expect(html).toMatch(/class="host-desk-row standby" aria-pressed="true"/u);
  });
  it("the checks: one row at a time, Test, Heard it / Nothing, next, the progress", () => {
    const html = desk();
    expect(html).toContain("1 of 6 checked");
    expect(html).toContain("Speakers · 2 of 6");
    expect(html).toContain("🔊 Test tone");
    expect(html).toContain("✓ Heard it");
    expect(html).toContain("✗ Nothing");
    expect(html).toContain("next ›");
    expect(html).not.toContain("Clear mark");
  });
  it("GO is off at the end of the list; an empty desk says where cues are built", () => {
    expect(desk(deskFixture({ standby: null }))).toMatch(/host-desk-go"[^>]*disabled=""/u);
    expect(desk(deskFixture({ standby: null, desk: { version: 1, cues: [] } }))).toContain("Run → House");
  });
  it("never edits: no desk save, no Save to project, no Reset marks in the window", () => {
    const s = src("host/desk.tsx");
    expect(s).not.toMatch(/\/api\/mod\/desk\/project|check\/reset|lights\/pair/u);
    expect(s).not.toMatch(/\bconfirm\(|\balert\(|window\.prompt/u);
  });
});

describe("wave 30: the Desk's Setup, Try it and How", () => {
  const sent: Array<{ route: string; body: Record<string, unknown> }> = [];
  const calls = hostCalls(async (route, body) => {
    sent.push({ route, body });
    return { ok: true };
  }, () => "");
  const desk = (v = deskFixture()) => renderToStaticMarkup(createElement(DeskBody, { view: v, calls, client: { receivedAt: 1_000, connected: true, error: null, refresh: () => {} }, me: "Task Manager" }));
  const well = () => {
    const v = deskFixture();
    return { ...v, house: { ...v.house, sounds: [{ name: "server_hum", to: ["server_spk"], file: "ok" as const, ms: 4000 }], minds: [{ character: "Trabolta", name: "Trabolta", online: true, workers: ["macbook"] }] } };
  };
  it("Setup sits above STANDBY: a card per system, a down one with its steps open", () => {
    const html = desk();
    expect(html.indexOf('data-testid="host-desk-setup"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-testid="host-desk-setup"')).toBeLessThan(html.indexOf('data-testid="host-desk-standby"'));
    expect(html).toMatch(/class="host-desk-setup-card bad" data-testid="host-desk-setup-sound"/u);
    expect(html).toMatch(/class="host-desk-setup-card ok" data-testid="host-desk-setup-lights"/u);
    expect(html).toContain("▾ What to do (1)");
    expect(html).toContain("stagehand/media/sounds/");
  });
  it("all connected is one line, folded", () => {
    const html = desk(well());
    expect(html).toContain("▸ All connected ✓ · 🔊 Sound · 💡 Lights · 🧠 Trabolta");
    expect(html).not.toContain("host-desk-setup-card");
  });
  it("How the Desk works is folded at the top", () => {
    const html = desk();
    expect(html).toMatch(/aria-expanded="false"[^>]*>▸ How the Desk works/u);
    expect(html.indexOf("How the Desk works")).toBeLessThan(html.indexOf('data-testid="host-desk-standby"'));
  });
  it("Try it: Say on the speakers, then the looks and the story sounds, each a tap", () => {
    const html = desk();
    expect(html).toContain('data-testid="host-desk-tryit"');
    expect(html).toContain("📢 Say on the speakers");
    expect(html).toMatch(/maxLength="280"/u);
    expect(html).toContain("0 / 280");
    expect(html).toMatch(/host-desk-say-go"[^>]*disabled=""/u);
    expect(html).toContain("▾ 💡 Looks (1)");
    expect(html).toContain("▾ ▶ Story sounds (1)");
    expect(html).toMatch(/class="w95-btn host-desk-try"/u);
    expect(html).toContain("⚠ no file on the router&#x27;s machine");
  });
  it("Try it's calls stay on the host allowlist", async () => {
    sent.length = 0;
    await calls.deskTest({ route: "/api/mod/lights/test", body: { look: "heart_wake" } });
    await calls.deskTest({ route: "/api/mod/audio/play", body: { sound: "server_hum" } });
    await calls.deskTest({ route: "/api/mod/audio/play", body: { say: "Hello" } });
    expect(sent.map((x) => x.route)).toEqual(["/api/mod/lights/test", "/api/mod/audio/play", "/api/mod/audio/play"]);
  });
});

describe("the Desk stays out of every first load", () => {
  it("only windows.tsx loads desk.tsx, and only by import()", () => {
    expect(src("host/windows.tsx")).toContain('import("./desk.tsx")');
    expect(src("host/windows.tsx")).not.toMatch(/^import (?!type )[^;]*from "\.\/desk\.tsx"/mu);
    for (const f of ["booth/app.tsx", "host/show.tsx", "host/dock.tsx", "ui.tsx", "guest/app.tsx"]) {
      expect(src(f), f).not.toMatch(/^import (?!type )[^;]*from "[./]*(host\/)?desk(-model)?\.tsx?"/mu);
    }
  });
});

describe("the host's taskbar on a 390 px phone", () => {
  // A live check at 390 px read "ShoChatDesk": the booth bar's Scan floor
  // (36% of the bar) squeezed three stacked windows under their words.
  const css = readBundledCss().replace(/\/\*[\s\S]*?\*\//gu, "");
  it("each stacked window keeps a 48 px target; a stacked Scan grows instead of taking a 36% floor", () => {
    expect(css).toMatch(/\.booth-frame \.taskbar \.taskbar-btn\.stacked:not\(\.primary\) \{[^}]*flex: 1 0 48px;[^}]*min-width: 48px;/u);
    expect(css).toMatch(/@media \(max-width: 599px\) \{ \.booth-frame \.taskbar \.taskbar-btn\.primary\.stacked \{ min-width: 64px; \} \}/u);
    // …and the tray clips rather than push the page 8 px sideways.
    expect(css).toMatch(/\.booth-frame \.taskbar \.taskbar-btn\.stacked ~ \.taskbar-tray \{ flex: 0 1 auto; min-width: 0; overflow: hidden; \}/u);
  });
  it("wave 26 (P2): a windowed booth's bar is the guest's — 56 px, equal windows 48–120 px, Scan a normal primary, two tray items under 430 px", () => {
    expect(css).toMatch(/\.booth-frame\.windowed \{ --taskbar-h: 56px; \}/u);
    expect(css).toMatch(/\.booth-frame\.windowed \.taskbar \.taskbar-btn\.stacked:not\(\.primary\),\s*\.booth-frame\.windowed \.taskbar \.taskbar-btn\.primary\.stacked \{ flex: 1 1 0; min-width: 48px; max-width: 120px; gap: 1px; \}/u);
    expect(css).toMatch(/@media \(max-width: 599px\) \{ \.booth-frame\.windowed \.taskbar \.taskbar-btn\.primary\.stacked \{ min-width: 48px; \} \}/u);
    expect(css).toMatch(/\.booth-frame\.windowed \.taskbar \.taskbar-tray > \* \{ flex: 0 0 auto; \}/u);
    expect(css).toMatch(/@media \(max-width: 429px\) \{ \.booth-frame\.windowed \.taskbar \.taskbar-tray > :nth-child\(n\+3\) \{ display: none; \} \}/u);
    // The windowed rules beat the wave-25 ones: they come later and weigh more.
    expect(css.indexOf(".booth-frame.windowed .taskbar .taskbar-btn.primary.stacked")).toBeGreaterThan(css.indexOf(".booth-frame .taskbar .taskbar-btn.primary { flex: 2 0 auto; }"));
    // The same numbers as the guest's frame.
    expect(css).toMatch(/\.guest-frame \{ --title-h: 52px; --taskbar-h: 56px; \}/u);
    expect(css).toMatch(/\.taskbar-btn\.stacked \{[^}]*flex: 1 1 0;[^}]*max-width: 120px;/u);
  });
});
