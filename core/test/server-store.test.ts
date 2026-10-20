import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { Sim } from "../src/runtime/sim/index.ts";
import { guestView } from "../server/views.ts";
import { Store, type Mutation } from "../server/store.ts";
import { scenarioSource } from "../examples/load.ts";

const SCENARIO = scenarioSource("escape-the-internet");

const dirs: string[] = [];
function freshStore(): Store {
  const d = mkdtempSync(join(tmpdir(), "loom-store-"));
  dirs.push(d);
  return new Store(d);
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("Store — durable round-trips", () => {
  it("persists passcodes", () => {
    const s = freshStore();
    expect(s.loadCodes()).toBeNull();
    s.saveCodes({ event: "EVT", mod: "MOD", prime: "PRM" });
    expect(s.loadCodes()).toEqual({ event: "EVT", mod: "MOD", prime: "PRM" });
  });

  it("persists scenario meta and guards the version", () => {
    const s = freshStore();
    expect(s.loadMeta()).toBeNull();
    expect(s.hasState()).toBe(false);
    s.saveMeta({ version: 1, scenarioName: "demo", scenarioSource: "X", phase: "open" });
    expect(s.hasState()).toBe(true);
    expect(s.loadMeta()).toEqual({ version: 1, scenarioName: "demo", scenarioSource: "X", phase: "open" });
  });

  it("appends and reads the journal in order, and clears it", () => {
    const s = freshStore();
    expect(s.readJournal()).toEqual([]);
    s.appendCommand("createPerson", ["g-1", "Alice"]);
    s.appendCommand("tick", [1000]);
    s.appendCommand("join", ["g-1", "Mods"]);
    expect(s.readJournal()).toEqual([
      { m: "createPerson", a: ["g-1", "Alice"] },
      { m: "tick", a: [1000] },
      { m: "join", a: ["g-1", "Mods"] },
    ]);
    s.clearJournal();
    expect(s.readJournal()).toEqual([]);
  });

  it("persists sessions (capability entries), defaulting to empty", () => {
    const s = freshStore();
    expect(s.loadSessions()).toEqual([]);
    s.saveSessions([
      ["t1", { character: null, admin: true, host: false }],
      ["t2", { character: "Moderator_Prime", admin: false, host: false }],
    ]);
    expect(s.loadSessions()).toEqual([
      ["t1", { character: null, admin: true, host: false }],
      ["t2", { character: "Moderator_Prime", admin: false, host: false }],
    ]);
  });
});

describe("Store — replay restores live sim state", () => {
  it("a fresh sim replayed from the journal matches the live one", () => {
    const store = freshStore();
    const live = Sim.fromSources(SCENARIO);

    // Mirror the server's `commit`: journal the call, then apply it.
    const commit = (m: Mutation, ...a: unknown[]): void => {
      store.appendCommand(m, a);
      (live as unknown as Record<string, (...x: unknown[]) => unknown>)[m]!(...a);
    };

    commit("createPerson", "g-1", "Alice");
    commit("createPerson", "g-2", "Bob");
    commit("join", "g-1", "Mods");
    commit("join", "g-2", "Chatters");
    commit("tick", 5000);
    commit("defect", "g-2", "Mods");
    commit("scan", "Moderator_Prime", "g-1");
    commit("tick", 3000);

    // Rebuild from scratch the way the server does on boot.
    const replayed = Sim.fromSources(SCENARIO);
    for (const e of store.readJournal()) {
      (replayed as unknown as Record<string, (...x: unknown[]) => unknown>)[e.m]!(...e.a);
    }

    expect(replayed.persons.size).toBe(live.persons.size);
    for (const id of ["g-1", "g-2"]) {
      expect(guestView(replayed, id)).toEqual(guestView(live, id));
    }
  });
});

describe("Store — the wallet journal line (wave 4, lane C)", () => {
  it("a `wallet` op round-trips with its director attribution", () => {
    const s = freshStore();
    const op = { op: "send", id: "t1", from: "g1", to: "g2", amount: 5, at: 0, via: "send" };
    s.appendCommand("wallet", [op], "Director");
    s.appendCommand("wallet", [{ op: "settle", id: "t1" }]);
    expect(s.readJournal()).toEqual([
      { m: "wallet", a: [op], by: "Director" },
      { m: "wallet", a: [{ op: "settle", id: "t1" }] },
    ]);
    const m: Mutation = "wallet";
    expect(m).toBe("wallet");
  });
});
