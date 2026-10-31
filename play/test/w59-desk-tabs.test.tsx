// Wave 59: the Desk's sub-tabs and 🖥 House. What never moves, which tab a device
// opens on, what stays unmounted (so it polls nothing), the terminals at a glance,
// and that the tab adds no reach: every write is a host route, and the lifecycle
// never appears. The scrolling, the sticky top and real polling are driven in
// Chromium by `scripts/sim/desk.spec.ts`.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ApiError } from "../src/client.ts";
import { HOST_READS, HOST_ROUTES, hostCalls, type HostRoute } from "../src/host/api.ts";
import { DeskBody } from "../src/host/desk.tsx";
import { DeskHouseBody, RUN_ONLY, type Act } from "../src/host/desk-house.tsx";
import {
  ADS_NOTE,
  ADS_NOT_YET,
  DESK_TAB_KEY,
  DREAM_CUE,
  DREAM_NOT_NOW,
  deskTabs,
  dreamDone,
  dreamRow,
  firstDeskTab,
  majorityBuild,
  playingChip,
  readDeskTab,
  saveDeskTab,
  setupBadge,
  silentTerminals,
  terminalLine,
  terminalLines,
  terminalsAside,
  identifyDone,
  voiceModeLine,
} from "../src/host/desk-tabs.ts";
import type { AdsStatus } from "../../core/src/audio-ads.ts";
import type { HostView } from "../src/types.ts";
import { deskFixture } from "./desk-fixture.ts";
import { elements, mountHooks } from "./hooks-harness.ts";

type Terminals = NonNullable<HostView["terminals"]>;

const client = { receivedAt: 1_000, connected: true, error: null, refresh: () => {} };
const mixer = { token: "t", eventId: "e" };

function recorder() {
  const sent: Array<{ route: HostRoute; body: Record<string, unknown> }> = [];
  const calls = hostCalls(async (route, body) => {
    sent.push({ route, body });
    return { ok: true };
  }, () => "Night.alerts");
  return { sent, calls };
}

const terminals = (over: Partial<Terminals> = {}): Terminals => ({
  voiceMuted: false,
  voiceFx: "auto",
  dream: false,
  silentMs: 20_000,
  rows: [
    { name: "Hall", view: "room", room: "The Tube", agoMs: 1_000, version: "b2", audio: true, visible: true, fullscreen: true, battery: 80, charging: true },
    { name: "CPU", view: "room", room: "The CPU", agoMs: 2_000, version: "b2", audio: false, visible: false, fullscreen: false, battery: 12, charging: false },
    { name: "Casino", view: "casino", agoMs: 60_000, version: "b1", audio: false },
    { name: "Server Room", view: "room", agoMs: 500, version: "b2", door: "closed" },
  ],
  ...over,
});

describe("the tabs", () => {
  it("five with the booth's token; Music and Mix need it", () => {
    expect(deskTabs(true).map((t) => t.id)).toEqual(["cues", "music", "mix", "house", "setup"]);
    expect(deskTabs(false).map((t) => t.id)).toEqual(["cues", "house", "setup"]);
  });

  it("M-2: Music opens first for Task Manager, Cues for anyone else", () => {
    const tabs = deskTabs(true);
    expect(firstDeskTab("Task Manager", null, tabs)).toBe("music");
    expect(firstDeskTab("Installation Wizard", null, tabs)).toBe("cues");
    expect(firstDeskTab(null, null, tabs)).toBe("cues");
  });

  it("a device's last tab wins, and a bad or unavailable one is ignored", () => {
    const tabs = deskTabs(true);
    expect(firstDeskTab("Task Manager", "cues", tabs)).toBe("cues");
    expect(firstDeskTab("Installation Wizard", "house", tabs)).toBe("house");
    expect(firstDeskTab("Installation Wizard", "rm -rf", tabs)).toBe("cues");
    expect(firstDeskTab("Installation Wizard", 7, tabs)).toBe("cues");
    expect(firstDeskTab("Task Manager", "music", deskTabs(false))).toBe("cues");
  });

  it("the memory is a convenience: a store that throws costs nothing", () => {
    const store = new Map<string, unknown>();
    const good = { load: <T,>(k: string) => (store.get(k) ?? null) as T | null, save: (k: string, v: unknown) => void store.set(k, v) };
    saveDeskTab(good, "setup");
    expect(store.get(DESK_TAB_KEY)).toBe("setup");
    expect(readDeskTab(good)).toBe("setup");
    const bad = {
      load: () => {
        throw new Error("blocked");
      },
      save: () => {
        throw new Error("blocked");
      },
    };
    expect(readDeskTab(bad)).toBeNull();
    expect(() => saveDeskTab(bad, "setup")).not.toThrow();
  });

  it("the chip names the running cue and counts the rest; none while nothing runs", () => {
    expect(playingChip([])).toBeNull();
    expect(playingChip([{ name: "Doors", state: "done" }])).toBeNull();
    expect(playingChip([{ name: "Hum", state: "running" }])).toBe("▶ Hum");
    expect(playingChip([{ name: "Hum", state: "running" }, { name: "Sweep", state: "running" }, { name: "Doors", state: "stopped" }])).toBe("▶ Hum +1");
  });

  it("Setup's tab carries the worst of its systems", () => {
    expect(setupBadge(["ok", "ok"])).toBeNull();
    expect(setupBadge(["ok", "warn"])).toBe("⚠");
    expect(setupBadge(["warn", "bad", "ok"])).toBe("✗");
  });
});

describe("the window", () => {
  const { calls } = recorder();
  const desk = (me: string, startTab?: "cues" | "music" | "mix" | "house" | "setup", v = deskFixture()) => renderToStaticMarkup(createElement(DeskBody, { view: v, calls, client, me, mixer, ...(startTab !== undefined ? { startTab } : {}) }));

  it("the top is the same on every tab: the chips, ■ STOP ALL, the note, the tabs", () => {
    for (const tab of ["cues", "music", "mix", "house", "setup"] as const) {
      const html = desk("Installation Wizard", tab);
      const top = html.slice(html.indexOf('data-testid="host-desk-top"'), html.indexOf('id="host-desk-panel"'));
      expect(top, tab).toContain("🔊 router online");
      expect(top, tab).toContain("■ STOP ALL");
      expect(top, tab).toContain('data-testid="host-desk-note"');
      expect(top, tab).toContain('role="tablist"');
    }
  });

  it("marks the open tab, and a running cue shows from every tab", () => {
    const html = desk("Installation Wizard", "house");
    expect(html).toMatch(/aria-selected="true"[^>]*data-testid="host-desk-tab-house"/u);
    expect(html).toMatch(/data-testid="host-desk-playing"[^>]*>▶ Pre-show hum</u);
    expect(desk("Installation Wizard", "setup")).toContain("▶ Pre-show hum");
    expect(desk("Installation Wizard", "cues", deskFixture({ runs: [] }))).not.toContain("host-desk-playing");
  });

  it("Task Manager opens on Music, anyone else on Cues with no music or mixer mounted", () => {
    const tm = desk("Task Manager");
    expect(tm).toMatch(/aria-selected="true"[^>]*data-testid="host-desk-tab-music"/u);
    expect(tm).toContain('data-testid="host-music"');
    expect(tm).not.toContain('data-testid="host-desk-standby"');
    const other = desk("Installation Wizard");
    expect(other).toContain('data-testid="host-desk-standby"');
    expect(other).not.toContain('data-testid="host-music"');
    expect(other).not.toContain('data-testid="host-mixer"');
  });

  it("each tab holds its own parts and nothing of the others", () => {
    const parts = { cues: 'data-testid="host-desk-standby"', house: 'data-testid="host-desk-house"', setup: 'data-testid="host-desk-setup"', music: 'data-testid="host-music"', mix: 'data-testid="host-mixer"' } as const;
    for (const tab of Object.keys(parts) as Array<keyof typeof parts>) {
      const html = desk("Installation Wizard", tab);
      for (const other of Object.keys(parts) as Array<keyof typeof parts>) {
        if (other === tab) expect(html, tab).toContain(parts[other]);
        else expect(html, `${tab} holds ${other}`).not.toContain(parts[other]);
      }
    }
  });

  it("Setup's tab says when a system is down", () => {
    expect(desk("Installation Wizard")).toMatch(/data-testid="host-desk-tab-setup"[\s\S]*?host-desk-tab-badge">✗</u);
  });
});

describe("a hop to another tab keeps what the host was doing", () => {
  type Element = ReturnType<typeof elements>[number];
  const propsOf = (e: Element) => e.props as Record<string, unknown>;
  const section = (h: { output: unknown }, name: string) => propsOf(elements(h.output).find((e) => (e.type as { name?: string }).name === name)!);
  const hop = (h: { output: unknown; act(f: () => void): void }, tab: string) => {
    const button = elements(h.output).find((e) => propsOf(e)["data-testid"] === `host-desk-tab-${tab}`)!;
    h.act(() => (propsOf(button)["onClick"] as () => void)());
  };

  it("the room being balanced: back on Mix the next fader doesn't move the whole house", () => {
    const { calls } = recorder();
    const h = mountHooks(DeskBody as (p: Parameters<typeof DeskBody>[0]) => unknown, { view: deskFixture(), calls, client, me: "Installation Wizard", mixer, startTab: "mix" });
    expect(section(h, "MixerSection")["scopeId"]).toBe("all");
    h.act(() => (section(h, "MixerSection")["onScope"] as (id: string) => void)("room:living"));
    hop(h, "cues");
    expect(elements(h.output).some((e) => (e.type as { name?: string }).name === "MixerSection")).toBe(false);
    hop(h, "mix");
    expect(section(h, "MixerSection")["scopeId"]).toBe("room:living");
  });

  it("a half-pasted TIDAL link: back on Music it is still in the box", () => {
    const { calls } = recorder();
    const h = mountHooks(DeskBody as (p: Parameters<typeof DeskBody>[0]) => unknown, { view: deskFixture(), calls, client, me: "Installation Wizard", mixer, startTab: "music" });
    expect(section(h, "MusicSection")["link"]).toBe("");
    h.act(() => (section(h, "MusicSection")["onLink"] as (t: string) => void)("https://tidal.com/playlist/abc"));
    hop(h, "cues");
    hop(h, "music");
    expect(section(h, "MusicSection")["link"]).toBe("https://tidal.com/playlist/abc");
  });
});

describe("the note says what the server said", () => {
  type Element = ReturnType<typeof elements>[number];
  const named = (e: Element, name: string) => (e.type as { name?: string }).name === name;
  const propsOf = (e: Element) => e.props as Record<string, unknown>;

  const mount = (answer: unknown, startTab: "cues" | "house") => {
    const sent: Array<{ route: HostRoute; body: Record<string, unknown> }> = [];
    const calls = hostCalls(async (route, body) => {
      sent.push({ route, body });
      return answer;
    }, () => "");
    const h = mountHooks(DeskBody as (p: Parameters<typeof DeskBody>[0]) => unknown, { view: deskFixture(), calls, client, me: "Installation Wizard", mixer, startTab });
    const note = () => {
      h.act(() => {});
      return propsOf(elements(h.output).find((e) => propsOf(e)["data-testid"] === "host-desk-note")!)["children"];
    };
    return { h, sent, note };
  };

  const stopAll = async (answer: unknown) => {
    const d = mount(answer, "cues");
    const button = elements(d.h.output).find((e) => named(e, "ActButton") && propsOf(e)["label"] === "■ STOP ALL")!;
    await (propsOf(button)["onClick"] as () => Promise<unknown>)();
    return d;
  };

  const sayIt = async (answer: unknown) => {
    const d = mount(answer, "house");
    const house = elements(d.h.output).find((e) => named(e, "DeskHouse"))!;
    const tryIt = propsOf(house)["tryIt"] as Element;
    const panel = mountHooks(tryIt.type as (p: unknown) => unknown, { ...(tryIt.props as object), say: "The bar is open" });
    const button = elements(panel.output).find((e) => propsOf(e)["label"] === "📢 Say it")!;
    await (propsOf(button)["onClick"] as () => Promise<unknown>)();
    return d;
  };

  it("Say it reads the answer: with no router it doesn't claim the speakers said it", async () => {
    const away = await sayIt({ ok: true, seq: 1, router: { online: false } });
    expect(away.sent).toEqual([{ route: "/api/mod/audio/play", body: { say: "The bar is open" } }]);
    expect(away.note()).toBe("📢 Said on the speakers — but the sound router is offline");
    expect((await sayIt({ ok: true, seq: 1, router: { online: true } })).note()).toBe("📢 Said on the speakers");
  });

  it("■ STOP ALL reads the answer: with no router it claims only the cues", async () => {
    const away = await stopAll({ ok: true, stopped: 1, router: { online: false } });
    expect(away.sent).toEqual([{ route: "/api/mod/desk/stop", body: { all: true } }]);
    expect(away.note()).toBe("■ Stopped every desk cue — but the sound router is offline");
    expect((await stopAll({ ok: true, stopped: 1, router: { online: true } })).note()).toBe("■ Stopped every desk cue and the house sounds");
  });
});

describe("🖥 House: the terminals", () => {
  it("the build most terminals run, or none on a tie", () => {
    expect(majorityBuild(terminals().rows)).toBe("b2");
    expect(majorityBuild([{ version: "a" }, { version: "b" }])).toBeNull();
    expect(majorityBuild([{}, {}])).toBeNull();
  });

  it("a live terminal says what needs a person; a silent one only that and its build", () => {
    const live = terminalLine(terminals().rows[1]!, 20_000, "b2");
    expect(live).toMatchObject({ name: "CPU", quiet: false, sub: "room · The CPU · 2 s ago" });
    expect(live.badges.filter((b) => b.warn).map((b) => b.text)).toEqual(["🔇 touch it", "💤 hidden", "⛶ not full", "🔋12%"]);
    const silent = terminalLine(terminals().rows[2]!, 20_000, "b2");
    expect(silent.quiet).toBe(true);
    expect(silent.badges).toEqual([{ key: "version", text: "b1", warn: true }]);
  });

  it("a charging tablet is fine, a terminal with no stamp is an old build, the door reads shut", () => {
    expect(terminalLine(terminals().rows[0]!, 20_000, "b2").badges.filter((b) => b.warn)).toEqual([]);
    expect(terminalLine({ name: "x", view: "room", agoMs: 0 }, 20_000, "b2").badges).toEqual([{ key: "version", text: "old build", warn: true }]);
    expect(terminalLine(terminals().rows[3]!, 20_000, "b2").badges.map((b) => b.text)).toEqual(["🚪 shut", "b2"]);
    expect(terminalLine({ name: "x", view: "room", agoMs: 0, door: "fault" }, 20_000, null).badges).toEqual([{ key: "door", text: "🚪 fault", warn: true }]);
    expect(terminalLine({ name: "x", view: "room", agoMs: 0, door: "none" }, 20_000, null).badges).toEqual([]);
  });

  it("silent ones lead, and the head counts them and the odd builds", () => {
    expect(terminalLines(terminals()).map((l) => l.name)).toEqual(["Casino", "CPU", "Hall", "Server Room"]);
    expect(silentTerminals(terminals())).toBe(1);
    expect(silentTerminals(null)).toBe(0);
    expect(terminalsAside(terminals())).toBe("3/4 live · 1 on another build");
    expect(terminalsAside(terminals({ rows: [] }))).toBe("0/0 live");
  });

  it("a poll that re-lists the terminals moves no row: the order never follows the server's", () => {
    const rows = terminals().rows;
    const shuffles = [rows, [...rows].reverse(), [rows[2]!, rows[0]!, rows[3]!, rows[1]!], [rows[1]!, rows[3]!, rows[2]!, rows[0]!]];
    for (const shuffled of shuffles) expect(terminalLines(terminals({ rows: shuffled })).map((l) => l.name)).toEqual(["Casino", "CPU", "Hall", "Server Room"]);
  });

  it("Identify's note is honest about a terminal that isn't answering", () => {
    expect(identifyDone({ name: "Hall", quiet: false })).toBe("📟 Hall shows its name");
    expect(identifyDone({ name: "Hall", quiet: true })).toBe("📟 Sent, but Hall isn't answering, so it may not show");
  });
});

describe("🖥 House: the switches", () => {
  const act: Act = async (done, call) => {
    const a = await call();
    if (typeof done === "function") done(a);
    return true;
  };
  const view = (over: Partial<HostView> = {}) => ({ terminals: terminals(), talk: null, ...over }) as HostView;
  const body = (v: HostView | null, rows: ReadonlyArray<{ id: string; live: boolean }> = [{ id: DREAM_CUE, live: true }], live = false) => {
    const { calls } = recorder();
    return renderToStaticMarkup(createElement(DeskHouseBody, { view: v, rows, calls, act, live, refresh: () => {}, tryIt: createElement("div", { "data-testid": "try" }) }));
  };

  it("Identify covers a terminal's screen: once the doors are open it asks first, and only then posts", async () => {
    type Tree = { props: { terminals: Terminals; live: boolean; calls: unknown; send: Act } };
    const box = (live: boolean, calls: unknown) => {
      const h = mountHooks(DeskHouseBody as (p: Parameters<typeof DeskHouseBody>[0]) => unknown, { view: view(), rows: [], calls: calls as never, act, live, refresh: () => {}, tryIt: null });
      const el = elements(h.output).find((e) => (e.type as { name?: string }).name === "TerminalsBox") as unknown as Tree;
      return mountHooks((el as unknown as { type: (p: Tree["props"]) => unknown }).type, el.props);
    };
    const asked = (live: boolean, calls: unknown) => elements(box(live, calls).output).filter((e) => (e.props as { label?: unknown }).label === "Identify");

    const closed = recorder();
    const before = asked(false, closed.calls);
    expect(before.map((e) => (e.type as { name?: string }).name)).toEqual(["ActButton", "ActButton", "ActButton", "ActButton"]);
    await (before[0]!.props as { onClick: () => Promise<unknown> }).onClick();
    expect(closed.sent).toEqual([{ route: "/api/mod/screen/identify", body: { name: "Casino" } }]);

    const open = recorder();
    const after = asked(true, open.calls);
    expect(after.map((e) => (e.type as { name?: string }).name)).toEqual(["ConfirmButton", "ConfirmButton", "ConfirmButton", "ConfirmButton"]);
    expect((after[0]!.props as { ask: string }).ask).toMatch(/The show is live — guests will see this/u);
    expect(open.sent).toEqual([]);
    await (after[0]!.props as { onConfirm: () => Promise<unknown> }).onConfirm();
    expect(open.sent).toEqual([{ route: "/api/mod/screen/identify", body: { name: "Casino" } }]);
  });

  it("his voice, the TV, the dream, Try it, the terminals, and what stays on Run", () => {
    const html = body(view());
    for (const word of ["🌀 His voice", ">Auto<", ">Clean<", ">Broken<", "Break his next words (8 s)", "🔊 Mute the TV voice", "🌀 Clippy&#x27;s dream", "🌀 Bring the dream back", "■ Stop + the announcement", 'data-testid="try"', "📟 Terminals", "3/4 live", "Identify"]) expect(html, word).toContain(word);
    expect(html).toContain(RUN_ONLY.replace(/'/gu, "&#x27;"));
    expect(html.indexOf('data-testid="try"')).toBeLessThan(html.indexOf("📟 Terminals"));
  });

  it("the dream reads its state from the server, and its switch waits for 🕚", () => {
    expect(body(view({ terminals: terminals({ dream: true }) }))).toContain("🌀 Put the terminals back");
    const off = body(view(), [{ id: DREAM_CUE, live: false }]);
    expect(off).toMatch(/data-testid="host-desk-dream"[^>]*>|disabled=""[^>]*data-testid="host-desk-dream"/u);
    expect(off).toContain(DREAM_NOT_NOW);
    expect(dreamRow([], true, false)).toBeNull();
    expect(dreamRow([{ id: DREAM_CUE, live: true }], true, false)).toMatchObject({ live: true, on: true, state: "on the terminals" });
    // Behind closed doors no story hears it: the server would only say "no scenario loaded".
    expect(dreamRow([{ id: DREAM_CUE, live: true }], false, true)).toMatchObject({ live: false });
    expect(body(view({ doorsClosed: true }))).toContain(DREAM_NOT_NOW);
    expect(body(view(), [])).not.toContain("Clippy&#x27;s dream");
  });

  it("says when the story refused the switch or the cues moved", () => {
    expect(dreamDone(true, { refused: true })).toContain("# hosts");
    expect(dreamDone(true, { ok: true, refused: true, staff: ["🌀 Not now: the story's own line."] })).toBe("🌀 Not now: the story's own line.");
    expect(dreamDone(true, { moved: true })).toContain("tap again");
    expect(dreamDone(true, { ok: true })).toContain("going back");
    expect(dreamDone(false, { ok: true })).toContain("coming back");
  });

  it("⚡ only while a talk scene has one; an older server has no voice row", () => {
    expect(body(view())).not.toContain("⚡ Glitch");
    expect(body(view({ talk: { glitch: "ad_burst" } as never }))).toContain("⚡ Glitch");
    expect(body(view({ terminals: terminals({ voiceFx: undefined as never }) }))).not.toContain("🌀 His voice");
  });

  it("reads the house with no view, and each mode says what it does", () => {
    expect(body(null)).toContain("Reading the house");
    expect(voiceModeLine("auto")).toContain("Follows the night");
    expect(voiceModeLine("clean")).toContain("Kept clean");
    expect(voiceModeLine("broken")).toContain("Fully broken");
  });

  it("the flavour and the stop with the announcement post to host routes", async () => {
    const { sent, calls } = recorder();
    await calls.voiceShot("skip");
    await calls.deskStopAll(true);
    expect(sent).toEqual([
      { route: "/api/mod/screen/voice", body: { shot: "skip" } },
      { route: "/api/mod/desk/stop", body: { all: true, announce: true } },
    ]);
    expect(HOST_ROUTES).toContain("/api/mod/screen/voice");
  });

  it("📷 Photos is mounted in 🖥 House and nowhere else, so off that tab it polls nothing", () => {
    const src = (f: string) => readFileSync(new URL(`../src/host/${f}`, import.meta.url), "utf8");
    expect(src("desk-house.tsx")).toContain("<PhotosSection auth={auth} calls={calls} />");
    expect(src("desk.tsx")).not.toMatch(/import .*PhotosSection|<PhotosSection/u);
    expect(HOST_READS as readonly string[]).toContain("/api/mod/photos");
    const house = (auth?: { token: string; eventId: string }) => {
      const { calls } = recorder();
      return renderToStaticMarkup(createElement(DeskHouseBody, { view: view(), rows: [], ...(auth !== undefined ? { auth } : {}), calls, act, live: false, refresh: () => {}, tryIt: null }));
    };
    expect(house(mixer)).toContain('data-testid="host-photos"');
    expect(house()).not.toContain('data-testid="host-photos"');
  });

  const adsOn: AdsStatus = { on: true, aired: 3, total: 14, playing: null, running: true, hold: null };

  it("📢 says how it stands, what the next one waits on, and what it is", () => {
    const with_ = (ads: Partial<AdsStatus> = {}) => body(view({ terminals: terminals({ ads: { ...adsOn, ...ads } }) }));
    expect(with_()).toContain("📢 Audio ads");
    expect(with_()).toContain("3 played: the next within 10 minutes");
    expect(with_()).toContain(ADS_NOTE.replace("'", "&#x27;"));
    expect(with_({ hold: "talk" })).toContain("3 played: waiting for a talk scene");
    expect(with_({ running: false })).toContain("they run from the second hunt to the final reveal");
    expect(with_({ on: false })).toContain("3 played: off");
    expect(body(view())).not.toContain("📢 Audio ads");
  });

  it("📢's two buttons are Run's route, and pressing the one already on sends nothing", async () => {
    const box = (ads: AdsStatus, calls: unknown) => {
      const h = mountHooks(DeskHouseBody as (p: Parameters<typeof DeskHouseBody>[0]) => unknown, { view: view({ terminals: terminals({ ads }) }), rows: [], calls: calls as never, act, live: false, refresh: () => {}, tryIt: null });
      const el = elements(h.output).find((e) => (e.type as { name?: string }).name === "AdsBox") as unknown as { type: (p: unknown) => unknown; props: unknown };
      return elements(mountHooks(el.type, el.props).output).filter((e) => (e.type as { name?: string }).name === "ActButton");
    };
    const r = recorder();
    const [on, off] = box(adsOn, r.calls);
    expect((on!.props as { pressed: boolean }).pressed).toBe(true);
    await (on!.props as { onClick: () => Promise<unknown> }).onClick();
    expect(r.sent).toEqual([]);
    await (off!.props as { onClick: () => Promise<unknown> }).onClick();
    expect(r.sent).toEqual([{ route: "/api/mod/screen/ads", body: { on: false } }]);
    expect(HOST_ROUTES).toContain("/api/mod/screen/ads");
    // Behind closed doors the server has no story to hold the switch, and the note says so.
    let refused = "";
    const refusing: Act = async (_done, _call, refusal) => {
      refused = refusal?.(new ApiError("no scenario loaded", 409)) ?? "";
      return false;
    };
    const h = mountHooks(DeskHouseBody as (p: Parameters<typeof DeskHouseBody>[0]) => unknown, { view: view({ terminals: terminals({ ads: adsOn }) }), rows: [], calls: r.calls as never, act: refusing, live: false, refresh: () => {}, tryIt: null });
    const el = elements(h.output).find((e) => (e.type as { name?: string }).name === "AdsBox") as unknown as { type: (p: unknown) => unknown; props: unknown };
    const offAgain = elements(mountHooks(el.type, el.props).output).filter((e) => (e.type as { name?: string }).name === "ActButton")[1]!;
    await (offAgain.props as { onClick: () => Promise<unknown> }).onClick();
    expect(refused).toBe(ADS_NOT_YET);
  });
});

describe("what the Desk may never do", () => {
  const src = (f: string) => readFileSync(new URL(`../src/host/${f}`, import.meta.url), "utf8");

  it("no lifecycle control on the Desk, in words or routes", () => {
    for (const f of ["desk.tsx", "desk-house.tsx", "desk-tabs.ts"]) {
      const s = src(f).split("\n").filter((l) => !l.startsWith("//!") && !l.trim().startsWith("*") && !l.trim().startsWith("/**")).join("\n");
      expect(s, f).not.toMatch(/Go live|Push draft|\bRestart\b|End the (show|night|event)|\/api\/mod\/(reset|load|resync|costume)|spatial\/descent/u);
    }
  });

  it("the costume's switch and the descent stay a director's: House points at Run", () => {
    expect(src("desk-house.tsx")).not.toMatch(/calls\.costume|setCostume|\/api\/mod\/costume/u);
    expect(RUN_ONLY).toContain("Run → Terminals");
    expect(HOST_ROUTES as readonly string[]).not.toContain("/api/mod/costume");
    expect(HOST_ROUTES as readonly string[]).not.toContain("/api/mod/spatial/descent");
  });

  it("the tabs are thumb-sized and fit a phone with no sideways scroll", () => {
    const css = readFileSync(new URL("../src/css/host.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.host-desk-tab \{[^}]*min-height: 48px/u);
    expect(css).toMatch(/\.host-desk-tabs \{[^}]*grid-auto-columns: minmax\(0, 1fr\)/u);
    expect(css).toMatch(/\.host-desk-top \{[^}]*flex: 0 0 auto/u);
  });
});
