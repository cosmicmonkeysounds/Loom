// Wave 37 (C22): a host's Show window passes the glance test. Needs you
// comes before Your jobs (it is what a host looks for; Your jobs' cast-pack
// paragraphs used to push it to the fold all night), and the night strip is
// one line that scrolls sideways inside itself, so nothing drops off it.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import type { HostView } from "../src/types.ts";
import { hostCalls } from "../src/host/api.ts";
import type { HostClient } from "../src/host/client.ts";
import { HostConsole, HostDock } from "../src/host/dock.tsx";
import { HostShowWindow } from "../src/host/show.tsx";
import { hostFixture } from "./host-fixture.ts";

const hostAuth = { token: "t", character: "Task Manager", admin: false, host: true, eventId: "e" };
const hostSession = { auth: hostAuth, messages: new Map(), view: null, threads: { open: () => {} } } as unknown as Parameters<typeof HostDock>[0]["session"];
function client(view: HostView): HostClient {
  return { view, receivedAt: 1_000, error: null, connected: true, refresh: () => {}, fresh: async () => {}, calls: hostCalls(async () => ({}), () => view.alerts.path) };
}
function show(view: HostView, jobs = "Two long cast-pack paragraphs of what to do tonight."): string {
  return renderToStaticMarkup(
    createElement(
      HostConsole,
      { session: hostSession, wide: false, openCard: () => {}, client: client(view), showing: true },
      createElement(HostShowWindow, { jobs: createElement("p", null, jobs), jobCount: 1, openGuests: () => {} }),
      createElement(HostDock, { session: hostSession, wide: false, openCard: () => {} }),
    ),
  );
}
const heads = (html: string) => [...html.matchAll(/class="host-show-head[^"]*" aria-expanded="(true|false)">[\s\S]*?<\/span>([^<]*)<\/button>/gu)].map((m) => `${m[2]}:${m[1]}`);

describe("Show's sections (wave 37)", () => {
  it("Needs you is the first section, open while something waits, above Your jobs' text", () => {
    const html = show(hostFixture());
    const h = heads(html);
    expect(h[0]).toBe("Needs you (2):true");
    expect(h[1]).toBe("Your jobs (1):true");
    expect(h.slice(2)).toEqual(["Coming up:true", "Judge (1):true", "Cue sheet:false", "People (2):false", "More:false"]);
    // What waits reads before the cast-pack paragraphs.
    expect(html.indexOf("💰 1 held transfer")).toBeGreaterThan(-1);
    expect(html.indexOf("💰 1 held transfer")).toBeLessThan(html.indexOf("Two long cast-pack paragraphs"));
    // And Needs sits under NEXT and LAST, not above them.
    expect(html.indexOf('data-testid="host-next-box"')).toBeLessThan(html.indexOf('data-show="needs"'));
  });
  it("with nothing waiting, Needs stays first as one folded head and Your jobs is the first open section", () => {
    const html = show(hostFixture({ needs: [] }));
    const h = heads(html);
    expect(h[0]).toBe("Needs you · nothing:false");
    expect(h[1]).toBe("Your jobs (1):true");
    expect(html.indexOf('data-show="needs"')).toBeLessThan(html.indexOf('data-show="jobs"'));
  });
});

describe("the night strip (wave 37)", () => {
  it("the chips sit side by side in one strip (nothing drops; the rest is a swipe away)", () => {
    const html = show(hostFixture());
    const strip = html.match(/<div class="host-show-strip"[^>]*>([\s\S]*?)<\/div>/u)?.[1] ?? "";
    expect(strip).toMatch(/host-show-chip act">B<\/span><span class="host-show-chip phase">Arrivals/u);
    expect(html.match(/class="host-show-strip"/gu)).toHaveLength(1);
  });
  it("the hosts' help says the strip is one line and lists Needs you first", () => {
    const help = readFileSync(new URL("../../docs/help/play/14-hosts.md", import.meta.url), "utf8");
    expect(help).toMatch(/on one line; swipe it for the rest/u);
    expect(help.indexOf("**Needs you (n)**")).toBeLessThan(help.indexOf("**Your jobs**"));
    expect(help).toMatch(/do not pop on a host's phone/u);
    expect(help).toMatch(/about 45 seconds/u);
  });
});
