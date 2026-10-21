//! Wave 18b (Q7): "stop all house sounds" from a host's phone (More →
//! House → 🔊 House sound, beside the TV voice) and from the director
//! phone's ☰, through `POST /api/mod/audio/stop`.

import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HOST_ROUTES, hostCalls } from "../src/host/api.ts";
import { HostContext, type HostCtx } from "../src/host/kit.tsx";
import { moreGroups, moreTabOf } from "../src/host/model.ts";
import { MoreTab } from "../src/host/tab-more.tsx";
import { STOP_SOUNDS_LABEL, STOP_WITH_ANNOUNCE_LABEL, stopSoundsLine } from "../src/house-sound.ts";
import type { HostView } from "../src/types.ts";
import { hostFixture } from "./host-fixture.ts";

function inDrawer(view: HostView, el: ReactElement, post: (route: string, body: Record<string, unknown>) => Promise<Record<string, unknown>> = async () => ({})): string {
  const ctx: HostCtx = {
    view,
    calls: hostCalls(post as never, () => view.alerts.path),
    session: { auth: { token: "t", character: "Task Manager", admin: false, host: true, eventId: "e" }, messages: new Map() } as unknown as HostCtx["session"],
    now: 0,
    run: async () => true,
    go: () => {},
    openRoom: () => {},
    openCard: () => {},
  };
  return renderToStaticMarkup(createElement(HostContext.Provider, { value: ctx }, el));
}

describe("stop all house sounds", () => {
  it("is a host route, and the call posts {announce}", async () => {
    expect(HOST_ROUTES).toContain("/api/mod/audio/stop");
    const seen: Array<[string, Record<string, unknown>]> = [];
    const calls = hostCalls((async (route: string, body: Record<string, unknown>) => {
      seen.push([route, body]);
      return { ok: true, seq: 1, router: { online: true } };
    }) as never, () => "Night.alerts");
    await calls.stopSounds(false);
    await calls.stopSounds(true);
    expect(seen).toEqual([
      ["/api/mod/audio/stop", { announce: false }],
      ["/api/mod/audio/stop", { announce: true }],
    ]);
  });

  it("a House sound section on every event's House tab, next to the terminals", () => {
    expect(moreTabOf("sound")).toBe("house");
    expect(moreGroups(hostFixture()).house).toEqual(["wallet", "king", "terminals", "sound", "agents"]);
    expect(moreGroups(hostFixture({ wallet: null, king: null, terminals: null, agents: [] })).house).toEqual(["sound"]);
    const house = inDrawer(hostFixture(), createElement(MoreTab, { focus: "sound" }));
    expect(house).toContain('data-section="sound"');
    expect(house).toContain(STOP_SOUNDS_LABEL);
    expect(house).toContain(STOP_WITH_ANNOUNCE_LABEL);
    // Right after the TV voice's section.
    expect(house.indexOf('data-section="terminals"')).toBeLessThan(house.indexOf('data-section="sound"'));
  });

  it("says whether the router heard it", () => {
    expect(stopSoundsLine({ ok: true, seq: 3, router: { online: true } }, false)).toBe("🔇 House sounds are fading out");
    expect(stopSoundsLine({ ok: true, seq: 3, router: { online: true } }, true)).toBe("🔇 House sounds and the announcement are fading out");
    expect(stopSoundsLine({ ok: true, seq: 3, router: { online: false } }, false)).toMatch(/No sound router is listening/u);
    expect(stopSoundsLine(null, false)).toMatch(/No sound router/u);
  });

  it("the director phone has one stop button, in its ☰ sheet", () => {
    const src = readFileSync(new URL("../src/director.tsx", import.meta.url), "utf8");
    expect(src).toContain('fetch(`${base}/api/mod/audio/stop`');
    expect(src.match(/data-testid="director-stop-sounds"/gu)).toHaveLength(1);
    expect(src).toContain("s.stopSounds(false)");
  });
});
