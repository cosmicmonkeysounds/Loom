//! Wave 13 recheck, lane ccore — D1: `/api/prime/act` and `/api/scan`
//! answer `refused: true` when the story said no (at most a staff-room line),
//! so a booth reads "Not done: …" rather than a neutral note. D2: a booth's
//! and a host's `night.act` is the cue sheet's act, never the act of its
//! long-running objective (already so on the server; pinned here).

import { afterAll, describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import { primeView } from "../server/views.ts";
import { booth, cleanup, freshDir, guest, mod, post, runtime } from "./w13-fix-harness.ts";
import { STORY } from "./w13-recheck-story.ts";

afterAll(cleanup);

describe("D1: a refused press or scan says so", () => {
  it("/api/prime/act: refused only when the story turned the press down", async () => {
    const rt = runtime({}, freshDir(), STORY);
    rt.openDoors();
    const g = await guest(rt, "WinZip");
    const clippy = (await booth(rt, "Clippy")).json.token as string;
    const no = await post(rt, "/api/prime/act", { name: "answered", guest: g.id, token: clippy });
    expect(no.status).toBe(200);
    expect(no.json).toMatchObject({ refused: true, staff: ["🗣 The bottle is not on WinZip."] });
    await mod(rt, "/api/mod/var", { path: "Night.bottle_open", value: "true" });
    const yes = await post(rt, "/api/prime/act", { name: "answered", guest: g.id, token: clippy });
    expect(yes.json).toMatchObject({ replies: ["Accepted."] });
    expect(yes.json.refused).toBeUndefined();
    rt.dispose();
  });

  it("/api/scan: refused for a staff-only answer, never for a greeting or a reply", async () => {
    const rt = runtime({}, freshDir(), STORY);
    rt.openDoors();
    const g = await guest(rt, "Minesweeper");
    const mcafee = (await booth(rt, "McAfee")).json.token as string;
    const no = await post(rt, "/api/scan", { target: g.id, token: mcafee });
    expect(no.status).toBe(200);
    expect(no.json).toMatchObject({ refused: true, staff: ["🗣 Not now: Minesweeper."] });
    const norton = (await booth(rt, "Norton")).json.token as string;
    const hi = await post(rt, "/api/scan", { target: g.id, token: norton });
    expect(hi.json).toMatchObject({ said: [{ from: "Norton", text: "Hello there." }] });
    expect(hi.json.refused).toBeUndefined();
    await mod(rt, "/api/mod/var", { path: "Night.scan_open", value: "true" });
    const g2 = await guest(rt, "Solitaire");
    const ok = await post(rt, "/api/scan", { target: g2.id, token: mcafee });
    expect(ok.json).toMatchObject({ responses: ["Clean: Solitaire."] });
    expect(ok.json.refused).toBeUndefined();
    rt.dispose();
  });
});

describe("D2: a booth's act is the cue sheet's", () => {
  it("night.act follows the sheet while the booth's standing objective keeps an earlier act:", () => {
    const sim = Sim.fromSources(`# Acts
start: opening

CHARACTER Clippy
  when greet for program:
    reply Hi.

INTERACTION open the doors
  who: admin
  act: A · Doors

INTERACTION last call
  who: admin
  act: B · Close

OBJECTIVE The Bank
  for: Clippy
  act: A
  title: Be the bank

when open the doors:
  set Night.step = 1

== opening
Hi.
`);
    expect(primeView(sim, "Clippy").night!.act).toEqual({ code: "A", title: "Doors" });
    sim.signal("open the doors");
    sim.tick(1000);
    const p = primeView(sim, "Clippy");
    expect(p.objectives?.[0]).toMatchObject({ title: "Be the bank", act: "A" });
    expect(p.night!.act).toEqual({ code: "B", title: "Close" });
  });
});
