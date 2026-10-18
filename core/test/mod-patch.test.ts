//! W9 O1-01 (C7): keyed patches between two director views. The property:
//! `applyModPatch(prev, modPatch(prev, next))` deep-equals `next` — over
//! hand-made edge cases and over every frame of a scripted night of the show.

import { describe, expect, it } from "vitest";

import { Sim } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";
import { modView, type ModView } from "../server/views.ts";
import { applyModPatch, modPatch, modViewJson, type ModPatch } from "../server/mod-patch.ts";

/** What a console would receive: the patch goes over the wire as JSON. */
const wire = (p: ModPatch): ModPatch => JSON.parse(JSON.stringify(p)) as ModPatch;
const roundTrip = <T extends object>(prev: object, next: T): { out: T; patch: ModPatch } => {
  const patch = wire(modPatch(prev, next));
  return { out: applyModPatch(prev as T, patch), patch };
};

describe("modPatch / applyModPatch", () => {
  const base = {
    phase: "open",
    ledgerLen: 3,
    world: [
      { path: "a.x", value: "1" },
      { path: "b.y", value: "2" },
      { path: "c.z", value: "3" },
    ],
    codex: [
      { id: "Alpha", holders: ["g-1"] },
      { id: "Beta", holders: [] },
    ],
    roster: [
      { id: "g-1", name: "Ada" },
      { id: "g-2", name: "Bo" },
    ],
    wallet: { open: 1 },
  };

  it("an unchanged view is an empty patch", () => {
    expect(modPatch(base, structuredClone(base))).toEqual({});
  });

  it("a changed plain field goes whole; a gone field is removed; a new one is added", () => {
    const { wallet: _w, ...rest } = base;
    const next = { ...rest, ledgerLen: 4, facts: { mode: "auto" } };
    const { out, patch } = roundTrip(base, next);
    expect(patch).toEqual({ ledgerLen: { value: 4 }, wallet: { remove: true }, facts: { value: { mode: "auto" } } });
    expect(out).toEqual(next);
    expect("wallet" in out).toBe(false);
  });

  it("world: one changed entry, one added (kept sorted), one removed — no order sent", () => {
    const next = {
      ...base,
      world: [
        { path: "a.x", value: "1" },
        { path: "b.w", value: "new" },
        { path: "b.y", value: "20" },
      ],
    };
    const { out, patch } = roundTrip(base, next);
    expect(patch.world).toEqual({ set: [{ path: "b.w", value: "new" }, { path: "b.y", value: "20" }], del: ["c.z"] });
    expect(out).toEqual(next);
  });

  it("codex: a holder change resends only that entry; roster join + leave", () => {
    const next = {
      ...base,
      codex: [
        { id: "Alpha", holders: ["g-1", "g-3"] },
        { id: "Beta", holders: [] },
      ],
      roster: [
        { id: "g-2", name: "Bo" },
        { id: "g-3", name: "Cy" },
      ],
    };
    const { out, patch } = roundTrip(base, next);
    expect(patch.codex).toEqual({ set: [{ id: "Alpha", holders: ["g-1", "g-3"] }], del: [] });
    expect(patch.roster).toEqual({ set: [{ id: "g-3", name: "Cy" }], del: ["g-1"] });
    expect(out).toEqual(next);
    // Unchanged rows are the previous view's own objects.
    expect(out.codex[1]).toBe(base.codex[1]);
  });

  it("a reorder the receiver can't infer carries an explicit order", () => {
    const next = { ...base, roster: [base.roster[1]!, base.roster[0]!, { id: "g-0", name: "Zed" }] };
    const { out, patch } = roundTrip(base, next);
    expect(patch.roster).toEqual({ set: [{ id: "g-0", name: "Zed" }], del: [], order: ["g-2", "g-1", "g-0"] });
    expect(out).toEqual(next);
    // An unsorted world (never from `worldEntries`) is still rebuilt exactly.
    const odd = { ...base, world: [base.world[2]!, base.world[0]!, base.world[1]!] };
    expect(roundTrip(base, odd).out).toEqual(odd);
  });

  it("an array that can't be keyed (a duplicate key) goes whole", () => {
    const next = { ...base, roster: [{ id: "g-1", name: "Ada" }, { id: "g-1", name: "Ada again" }] };
    const { out, patch } = roundTrip(base, next);
    expect(patch.roster).toEqual({ value: next.roster });
    expect(out).toEqual(next);
  });

  it("modViewJson is byte-identical to JSON.stringify (undefined fields left out)", () => {
    const v = { ...base, minds: undefined, title: "T" };
    expect(modViewJson(v)).toBe(JSON.stringify(v));
    expect(modViewJson({})).toBe("{}");
    // …with keyed rows assembled from their own JSON (arrays, nulls inside a row).
    const odd = { world: [{ path: "a", value: [1, null] }], codex: [], roster: [{ id: "g-1", tags: { x: undefined } }] };
    expect(modViewJson(odd)).toBe(JSON.stringify(odd));
  });

  it("a view stands for what it was when it was sent, even if a row shared a live object that moved on", () => {
    const live = ["g-1"];
    const prev = { ...base, codex: [{ id: "Alpha", holders: live }] };
    const sent = JSON.parse(modViewJson(prev)) as typeof prev; // the keyframe, serialised once
    live.push("g-2"); // the sim moves on in place
    const next = { ...base, codex: [{ id: "Alpha", holders: live }] }; // a fresh row on the same live array
    const patch = wire(modPatch(prev, next));
    expect(patch.codex).toEqual({ set: [{ id: "Alpha", holders: ["g-1", "g-2"] }], del: [] });
    expect(applyModPatch(sent, patch)).toEqual(next);
  });
});

describe("a recorded night of the show: every patch rebuilds every view exactly", () => {
  it("a scripted burst (joins, the door scans, check-ins, cues, codex, the clock) round-trips frame by frame", () => {
    const sim = Sim.fromSources(scenarioSource("trapped-in-the-internet"));
    const frames: ModView[] = [];
    const snap = () => frames.push(modView(sim, "open", "trapped-in-the-internet"));
    snap();
    if (sim.model.entry !== null) sim.fireBeat(sim.model.entry);
    snap();
    const rooms = ["The Desktop", "The Start Bar", "The CPU", "The Cloud"];
    const codex = [...sim.model.codex.keys()];
    for (let i = 0; i < 12; i++) {
      const id = `g-${i}`;
      sim.createPerson(id, `K32 Bot ${i}`);
      snap();
      sim.signal("captcha answered", id, { passed: true });
      sim.signal("captcha answered", id, { passed: false });
      const p = sim.pendingChoiceFor(id);
      if (p && p.length > 0) sim.choose(id, 0);
      snap();
      sim.scan("Norton Anti-Virus", id);
      snap();
      sim.arrive(id, rooms[i % rooms.length]!);
      sim.unlock(id, codex[i % codex.length]!);
      snap();
      sim.tick(1000);
      snap();
    }
    for (const id of ["g-1", "g-2", "g-3"]) {
      sim.share(id, "g-4", codex[1]!);
      sim.setVar(`${id}.score`, "42");
      snap();
    }
    sim.restrict("g-5");
    sim.reveal("Unlimited Power");
    snap();
    for (let s = 0; s < 30; s++) {
      sim.tick(1000);
      snap();
    }

    let full = 0;
    let patched = 0;
    const keyed = new Set<string>();
    for (let i = 1; i < frames.length; i++) {
      const prev = frames[i - 1]!;
      const next = frames[i]!;
      const patch = wire(modPatch(prev, next));
      expect(applyModPatch(prev, patch), `frame ${i}`).toEqual(next);
      for (const [k, d] of Object.entries(patch)) if ("set" in d && d.set.length > 0) keyed.add(k);
      full += JSON.stringify(next).length;
      patched += JSON.stringify(patch).length;
    }
    // The point of it: a frame's patch is a sliver of the view.
    expect(frames.length).toBeGreaterThan(60);
    expect([...keyed].sort()).toEqual(["codex", "roster", "world"]);
    expect(patched * 20).toBeLessThan(full);
  });
});
