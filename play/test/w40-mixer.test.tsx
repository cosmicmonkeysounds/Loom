// Wave 40 (docs/loom-w40-contract.md C5): the Desk window's 🎚 Mixer — the
// poll's outcome, the optimistic layer released on seq, the per-fader
// throttle (≤ 10 a second, the trailing value always sent), which post each
// control makes, and the panel drawn off a fixture view.

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { MIX_CHANGES_MAX, scopeStrips, type MixChange, type MixerView } from "../../core/src/house-mixer.ts";
import { HOST_READS, HOST_ROUTES, hostCalls, type HostRoute } from "../src/host/api.ts";
import {
  MIX_SEND_MS,
  NO_MIXER,
  NO_PENDING,
  NOT_A_MIXER,
  ROUTER_OFFLINE,
  answered,
  answeredMix,
  faderChange,
  layeredLevels,
  mergeChange,
  mergeMixerView,
  mixerPollOutcome,
  movedCount,
  musicCalls,
  musicDone,
  muteChange,
  nowPlaying,
  offerChange,
  pickedScope,
  releaseSeen,
  resetChanges,
  routerBanner,
  sending,
  stripRow,
  takeDue,
  trackClock,
  withAnsweredMix,
  type MixPending,
} from "../src/host/mixer-model.ts";
import { MixerBody } from "../src/host/mixer.tsx";
import { DeskBody } from "../src/host/desk.tsx";
import { deskFixture } from "./desk-fixture.ts";

function fixture(over: Partial<MixerView> = {}): MixerView {
  return {
    mix: { seq: 4, levels: { "src:music": { db: -6, mute: false } } },
    sources: [
      { id: "music", label: "Music", kind: "bus", meterOnly: false },
      { id: "tracks", label: "Featured tracks", kind: "bus", meterOnly: false },
      { id: "sfx", label: "Sound effects", kind: "bus", meterOnly: false },
      { id: "announce", label: "Announcements", kind: "bus", meterOnly: false },
      { id: "in:trabolta", label: "Trabolta (in 3)", kind: "input", ch: 3, role: "trabolta", meterOnly: false },
      { id: "in:clippy", label: "Clippy (in 1)", kind: "input", ch: 1, role: "clippy", meterOnly: true },
    ],
    rooms: [
      { id: "living", name: "Living room", speakers: [{ id: "living_l", name: "Living L", out: [9] }, { id: "sub", name: "Sub", out: [1] }] },
      { id: "kitchen", name: "Kitchen", speakers: [{ id: "kitchen", name: "Kitchen", out: [3] }] },
    ],
    meters: { at: 1, outputs: { "9": -12, "3": -30 }, inputs: { "3": -20, "1": -40 }, sources: {}, buses: { music: { "9": -18 } } },
    music: {
      scene: "act1",
      beds: [{ playlist: "lounge", speakers: ["living_l"], track: "Dial-up Dreams", posS: 65, durS: 200 }],
      missing: ["rave"],
      scenes: ["off", "act1", "act2"],
      hand: true,
      playlists: [{ name: "lounge", tracks: 4, loop: true }],
    },
    router: { online: true, lastSeen: 1, name: "desktop" },
    now: 1,
    ...over,
  };
}

describe("the mixer's poll", () => {
  it("404 is no mixer yet, 403 is not a host; a view needs mix, sources and rooms", () => {
    expect(mixerPollOutcome(404, { error: "not found" })).toEqual({ kind: "error", message: NO_MIXER });
    expect(mixerPollOutcome(403, { error: "not from a booth" })).toEqual({ kind: "error", message: NOT_A_MIXER });
    expect(mixerPollOutcome(500, { error: "boom" })).toEqual({ kind: "error", message: "boom" });
    expect(mixerPollOutcome(200, { mix: {} }).kind).toBe("error");
    const v = fixture();
    expect(mixerPollOutcome(200, v)).toEqual({ kind: "view", view: v });
  });

  it("a poll never steps the mix back to an older seq; an answer's newer mix wins", () => {
    const a = fixture();
    const older = fixture({ mix: { seq: 3, levels: {} }, now: 2 });
    const merged = mergeMixerView(a, older);
    expect(merged.mix).toBe(a.mix);
    expect(merged.now).toBe(2);
    expect(mergeMixerView(null, older)).toBe(older);
    const answer = answeredMix({ ok: true, mix: { seq: 9, levels: { master: { db: -3, mute: false } } } });
    expect(answer?.seq).toBe(9);
    expect(withAnsweredMix(a, answer)?.mix.seq).toBe(9);
    expect(withAnsweredMix(a, { seq: 1, levels: {} })).toBe(a);
    expect(answeredMix({ ok: true })).toBeNull();
  });

  it("the mixer GET and the two posts are on the host lists; the router's meters route is not", () => {
    expect(HOST_READS as readonly string[]).toContain("/api/mod/audio/mixer");
    for (const r of ["/api/mod/audio/mix", "/api/mod/audio/music"]) expect(HOST_ROUTES as readonly string[]).toContain(r);
    expect(HOST_ROUTES as readonly string[]).not.toContain("/api/mod/audio/meters");
  });
});

describe("the optimistic layer", () => {
  const server = fixture().mix.levels;
  it("a moved fader shows its own value over the server's at once", () => {
    const p = offerChange(NO_PENDING, server, faderChange("src:music", -12.3));
    expect(layeredLevels(server, p)["src:music"]).toEqual({ db: -12.5, mute: false });
    // A mute keeps the fader's dB; a reset is unity (dropped from the levels).
    const m = offerChange(p, server, muteChange("src:music", { db: -12.5, mute: false }));
    expect(layeredLevels(server, m)["src:music"]).toEqual({ db: -12.5, mute: true });
    const r = offerChange(m, server, { key: "src:music", reset: true });
    expect(layeredLevels(server, r)["src:music"]).toBeUndefined();
  });

  it("holds the key until a view's seq reaches the post's answer, and nothing more is waiting", () => {
    let p = offerChange(NO_PENDING, server, faderChange("master", -3));
    let due = takeDue(p, 1_000);
    expect(due.changes).toEqual([{ key: "master", db: -3 }]);
    p = due.pending;
    // A poll that left before the post: still ours.
    expect(releaseSeen(p, 4)).toBe(p);
    p = answered(p, ["master"], 5);
    expect(sending(p)).toBe(false);
    expect(releaseSeen(p, 4)).toBe(p);
    expect(layeredLevels(fixture().mix.levels, p)["master"]).toEqual({ db: -3, mute: false });
    const released = releaseSeen(p, 5);
    expect(released["master"]).toBeUndefined();
    // A newer move made while the post was out keeps the key past the seq.
    p = offerChange(due.pending, server, faderChange("master", -4));
    p = answered(p, ["master"], 5);
    expect(releaseSeen(p, 5)["master"]?.level.db).toBe(-4);
    due = takeDue(p, 2_000);
    expect(due.changes).toEqual([{ key: "master", db: -4 }]);
  });

  it("a failed post lets go at the next view (the server's value shows again)", () => {
    let p = offerChange(NO_PENDING, server, faderChange("src:sfx", -20));
    p = takeDue(p, 0).pending;
    p = answered(p, ["src:sfx"], null);
    expect(releaseSeen(p, 0)["src:sfx"]).toBeUndefined();
  });
});

describe("the throttle", () => {
  const server = fixture().mix.levels;
  const drag = (p: MixPending, db: number) => offerChange(p, server, faderChange("src:music", db));

  it("≤ 10 a second per fader, never two out for one key, the last value always goes", () => {
    let p = drag(NO_PENDING, -7);
    let due = takeDue(p, 1_000);
    expect(due.changes).toEqual([{ key: "src:music", db: -7 }]);
    p = due.pending;
    // While it is out, the drag goes on: nothing more is sent, only the last is kept.
    p = drag(p, -8);
    p = drag(p, -9);
    p = drag(p, -9.5);
    due = takeDue(p, 1_010);
    expect(due.changes).toEqual([]);
    expect(due.wakeAt).toBeNull(); // waits for the answer, not the clock
    p = answered(due.pending, ["src:music"], 5);
    // Answered at +20 ms: the gap still holds it to +100 ms.
    due = takeDue(p, 1_020);
    expect(due.changes).toEqual([]);
    expect(due.wakeAt).toBe(1_000 + MIX_SEND_MS);
    due = takeDue(p, 1_000 + MIX_SEND_MS);
    expect(due.changes).toEqual([{ key: "src:music", db: -9.5 }]);
  });

  it("a whole drag sends at most one post per gap", () => {
    let p: MixPending = NO_PENDING;
    const sent: MixChange[] = [];
    for (let t = 0; t <= 1_000; t += 16) {
      p = drag(p, -t / 50);
      const due = takeDue(p, t);
      p = due.pending;
      sent.push(...due.changes);
      // Answered at once, every time.
      if (due.changes.length > 0) p = answered(p, ["src:music"], t);
    }
    expect(sent.length).toBeLessThanOrEqual(11);
    // After the drag ends the trailing value goes.
    const last = takeDue(p, 2_000).changes;
    expect([...sent, ...last].pop()).toEqual({ key: "src:music", db: -20 });
  });

  it("keys travel together in one post, at most MIX_CHANGES_MAX", () => {
    let p: MixPending = NO_PENDING;
    for (let i = 0; i < MIX_CHANGES_MAX + 3; i++) p = offerChange(p, server, faderChange(`spk:s${i}`, -1));
    const due = takeDue(p, 0);
    expect(due.changes).toHaveLength(MIX_CHANGES_MAX);
    expect(due.wakeAt).toBe(0);
    expect(takeDue(due.pending, 0).changes).toHaveLength(3);
  });

  it("merges a key's waiting changes field by field; a reset then a move is from unity", () => {
    expect(mergeChange({ key: "k", db: -3 }, { key: "k", mute: true })).toEqual({ key: "k", db: -3, mute: true });
    expect(mergeChange({ key: "k", db: -3, mute: true }, { key: "k", reset: true })).toEqual({ key: "k", reset: true });
    expect(mergeChange({ key: "k", reset: true }, { key: "k", db: -2 })).toEqual({ key: "k", db: -2, mute: false });
  });
});

describe("which post each control makes", () => {
  function recorder() {
    const sent: Array<{ route: HostRoute; body: Record<string, unknown> }> = [];
    const calls = hostCalls(async (route, body) => {
      sent.push({ route, body });
      return { ok: true };
    }, () => "Night.alerts");
    return { sent, calls };
  }

  it("a fader, a mute and a Reset post {changes} to /api/mod/audio/mix", async () => {
    const { sent, calls } = recorder();
    const v = fixture();
    await calls.mix([faderChange("room:living/src:music", 3.26)]);
    await calls.mix([muteChange("spk:sub", { db: 0, mute: false })]);
    await calls.mix(resetChanges(v, { kind: "all" }, v.mix.levels));
    expect(sent).toEqual([
      { route: "/api/mod/audio/mix", body: { changes: [{ key: "room:living/src:music", db: 3.5 }] } },
      { route: "/api/mod/audio/mix", body: { changes: [{ key: "spk:sub", mute: true }] } },
      { route: "/api/mod/audio/mix", body: { changes: [{ key: "src:music", reset: true }] } },
    ]);
  });

  it("a Reset clears the scope's levels on the server and on this phone, nothing outside it", () => {
    const v = fixture();
    const levels = layeredLevels(v.mix.levels, offerChange(NO_PENDING, v.mix.levels, faderChange("room:living", -4)));
    expect(resetChanges(v, { kind: "room", room: "living" }, levels)).toEqual([{ key: "room:living", reset: true }]);
    expect(resetChanges(v, { kind: "room", room: "kitchen" }, levels)).toEqual([]);
    expect(movedCount(v, { kind: "all" }, v.mix.levels)).toBe(1);
  });

  it("the music buttons post their command to /api/mod/audio/music", async () => {
    const { sent, calls } = recorder();
    await calls.music(musicCalls.scene("act2"));
    await calls.music(musicCalls.next("lounge"));
    await calls.music(musicCalls.next());
    await calls.music(musicCalls.stop());
    await calls.music(musicCalls.story());
    expect(sent.map((s) => [s.route, s.body])).toEqual([
      ["/api/mod/audio/music", { action: "scene", scene: "act2" }],
      ["/api/mod/audio/music", { action: "next", playlist: "lounge" }],
      ["/api/mod/audio/music", { action: "next" }],
      ["/api/mod/audio/music", { action: "stop" }],
      ["/api/mod/audio/music", { action: "story" }],
    ]);
    expect(musicDone(musicCalls.stop(), { ok: true, seq: 1, router: true })).toBe("■ Music stopped");
    expect(musicDone(musicCalls.next("lounge"), { ok: true, seq: 1, router: false })).toMatch(/no router is listening/u);
    expect(musicDone(musicCalls.next(), { ok: true, seq: 2, router: { online: false, lastSeen: null, name: null } })).toMatch(/no router is listening/u);
    expect(musicDone(musicCalls.story(), { ok: true, seq: 3, router: { online: true, lastSeen: 1, name: "desk" } })).toBe("↺ Following the story");
  });
});

describe("what the panel draws", () => {
  it("now playing: the scenes, the hand, each bed's progress, the missing playlists", () => {
    const np = nowPlaying(fixture().music)!;
    expect(np.scenes).toEqual(["off", "act1", "act2"]);
    expect(np.hand).toBe(true);
    expect(np.beds).toEqual([{ playlist: "lounge", name: "lounge", track: "Dial-up Dreams", progress: 65 / 200, time: "1:05 / 3:20" }]);
    expect(np.warnings).toEqual(["rave: no tracks found"]);
    expect(nowPlaying(null)).toBeNull();
    const bare = nowPlaying({ scene: "x", beds: [{ playlist: "p", speakers: [], track: null, posS: 3 }], missing: [] })!;
    expect(bare.scenes).toEqual(["x"]);
    expect(bare.beds[0]).toEqual({ playlist: "p", name: "p", track: "—", progress: null, time: "0:03" });
    expect(trackClock(3_601)).toBe("60:01");
  });

  it("a strip says where it plays when the levels around it move it", () => {
    const v = fixture({ mix: { seq: 1, levels: { master: { db: -3, mute: false }, "src:music": { db: -6, mute: false }, "room:kitchen": { db: 0, mute: true } } } });
    const all = scopeStrips(v, { kind: "all" }).map(stripRow);
    expect(all[0]).toMatchObject({ label: "Master", hint: null, dbText: "−3.0 dB", fader: true });
    expect(all.find((r) => r.key === "src:music")).toMatchObject({ hint: "plays at −9.0 dB", fill: expect.any(Number) });
    const meter = all.find((r) => r.kind === "meter")!;
    expect(meter).toMatchObject({ fader: false, key: null });
    expect(meter.note).toMatch(/meter only/u);
    const kitchen = scopeStrips(v, { kind: "room", room: "kitchen" }).map(stripRow);
    expect(kitchen[0]).toMatchObject({ muted: true, hint: null });
    expect(kitchen.find((r) => r.key === "room:kitchen/src:sfx")?.hint).toBe("silent");
    expect(routerBanner(v)).toBeNull();
    expect(routerBanner(fixture({ router: { online: false, lastSeen: null, name: null } }))).toBe(ROUTER_OFFLINE);
  });

  it("a scope that left falls back to Everywhere", () => {
    const scopes = [
      { scope: { kind: "all" as const }, id: "all", label: "Everywhere" },
      { scope: { kind: "room" as const, room: "living" }, id: "room:living", label: "Living room" },
    ];
    expect(pickedScope(scopes, "room:living").label).toBe("Living room");
    expect(pickedScope(scopes, "room:gone").id).toBe("all");
  });

  const body = (v: MixerView, scopeId = "all") =>
    renderToStaticMarkup(createElement(MixerBody, { view: v, levels: v.mix.levels, scopeId, onScope: () => {}, onChange: () => {}, note: null, error: null }));

  it("draws the scope chips and that scope's faders, and leaves now playing to 🎵 Music", () => {
    const html = body(fixture());
    expect(html).not.toContain("NOW PLAYING");
    for (const t of ["Everywhere", "Living room", "Kitchen"]) expect(html).toContain(t);
    expect(html).toMatch(/type="range"[^>]*min="-60"[^>]*max="10"[^>]*step="0.5"/u);
    expect(html).toContain("Mixed outside the router");
    expect(html).not.toContain(ROUTER_OFFLINE);
    // A director's name never reaches the panel (the view carries none).
    expect(html).not.toMatch(/\bby\b/u);
    const living = body(fixture(), "room:living");
    expect(living).toContain("Living L");
    expect(living).toContain("Sub");
    expect(living).toContain("Reset Living room");
  });

  it("says when no router listens", () => {
    expect(body(fixture({ router: { online: false, lastSeen: null, name: null }, music: null }))).toContain(ROUTER_OFFLINE);
  });

  it("the Desk shows the Mixer folded (it polls nothing until opened)", () => {
    const calls = hostCalls(async () => ({ ok: true }), () => "Night.alerts");
    const html = renderToStaticMarkup(createElement(DeskBody, { view: deskFixture(), calls, client: { receivedAt: 1_000, connected: true, error: null, refresh: () => {} }, me: "Task Manager", mixer: { token: "t", eventId: "e" } }));
    expect(html).toContain("▸ 🎚 Mixer");
    expect(html).toMatch(/aria-expanded="false"[^>]*>▸ 🎚 Mixer/u);
    expect(html).not.toContain("host-mix-body");
    // Without the booth's token there is no Mixer.
    expect(renderToStaticMarkup(createElement(DeskBody, { view: deskFixture(), calls, client: { receivedAt: 1_000, connected: true, error: null, refresh: () => {} }, me: "Task Manager" }))).not.toContain("🎚 Mixer");
  });
});

describe("the mixer's stylesheet and chunk", () => {
  const css = readFileSync(new URL("../src/css/host.css", import.meta.url), "utf8");
  it("the fader keeps its drag off the page; every control is 44 px; the picker is 16 px", () => {
    expect(css).toMatch(/\.host-mix-fader \{[^}]*touch-action:\s*none/u);
    for (const sel of [".host-mix-fader", ".host-mix-mute", ".host-mix-scope", ".host-mix-skip", ".host-mix-reset", ".host-mix-story", ".host-mix-scene-pick"]) {
      expect(css, sel).toMatch(new RegExp(`\\${sel}[^{]*\\{[^}]*min-height:\\s*var\\(--tap\\)`, "u"));
    }
    expect(css).toMatch(/\.host-mix-scene-pick \{[^}]*font: 16px/u);
  });
  it("only the Desk's chunk reaches the mixer", () => {
    const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
    expect(src("host/desk.tsx")).toContain('from "./mixer.tsx"');
    expect(src("host/windows.tsx")).not.toMatch(/^import (?!type )[^;]*from "\.\/(desk|mixer)\.tsx"/mu);
  });
});
