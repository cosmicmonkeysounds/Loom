//! The control plane's boot (C1: T4-02, T4-03, S1-ops-01): a deployment
//! waits for its database with a capped backoff instead of giving up on one
//! probe, an unregistered event is "starting" (never "unknown") until the
//! boot settles, and `/api/health` says how far it got. Fake deps, no
//! Postgres.

import { describe, expect, it } from "vitest";

import { ControlPlaneBoot, DB_RETRY_MAX_MS, dbRetryDelay, startControlPlane, type BootDeps } from "../server/boot.ts";

interface Row {
  id: string;
}

function harness(opts: { misses?: number; rows?: Row[]; setupFails?: number; bad?: string } = {}) {
  let probes = 0;
  let setups = 0;
  const hosted: string[] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  const healthAtProbe: number[] = [];
  const settledAtProbe: boolean[] = [];
  let boot: ControlPlaneBoot | null = null;
  const deps: BootDeps<Row> = {
    dbReady: async () => {
      healthAtProbe.push(boot!.health(hosted.length).status);
      settledAtProbe.push(boot!.settled);
      probes++;
      return probes > (opts.misses ?? 0);
    },
    setup: async () => {
      setups++;
      if (setups <= (opts.setupFails ?? 0)) throw new Error("connection terminated");
    },
    liveEvents: async () => opts.rows ?? [{ id: "e1" }],
    host: (row) => {
      if (row.id === opts.bad) throw new Error("bad journal");
      hosted.push(row.id);
    },
    keyOf: (row) => ({ id: row.id, codes: [`G-${row.id}`, `P-${row.id}`, `M-${row.id}`] }),
    sleep: async (ms) => void sleeps.push(ms),
    log: (line) => void logs.push(line),
  };
  return {
    deps,
    attach: (b: ControlPlaneBoot) => (boot = b),
    get probes() {
      return probes;
    },
    hosted,
    sleeps,
    logs,
    healthAtProbe,
    settledAtProbe,
  };
}

describe("the control plane's boot", () => {
  it("backs off 1, 2, 4, 8 s and caps at 15 s", () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(dbRetryDelay)).toEqual([1000, 2000, 4000, 8000, DB_RETRY_MAX_MS, DB_RETRY_MAX_MS, DB_RETRY_MAX_MS]);
  });

  it("a deployment retries a late database, then hosts every live event and goes healthy (T4-03)", async () => {
    const h = harness({ misses: 3, rows: [{ id: "e1" }, { id: "e2" }] });
    const boot = h.attach(new ControlPlaneBoot(true));
    expect(boot.health(1)).toEqual({ status: 503, body: { ok: false, reason: "starting" } });
    await startControlPlane(boot, h.deps);
    expect(h.probes).toBe(4);
    expect(h.sleeps).toEqual([1000, 2000, 4000]);
    expect(h.hosted).toEqual(["e1", "e2"]);
    expect(boot.phase).toBe("up");
    expect(boot.settled).toBe(true);
    expect(boot.controlPlane).toBe(true);
    expect(boot.rehydrated).toBe(2);
    // While it waited: unhealthy, unsettled (so the router answers 503 starting).
    expect(h.healthAtProbe).toEqual([503, 503, 503, 503]);
    expect(h.settledAtProbe.every((s) => !s)).toBe(true);
    expect(boot.health(3)).toEqual({ status: 200, body: { ok: true, controlPlane: true, events: 3 } });
    expect(h.logs.some((l) => /retrying in 1 s/u.test(l))).toBe(true);
    expect(h.logs.at(-1)).toMatch(/after 3 retries — control plane up/u);
  });

  it("an unreachable database reads as `database`, a migrate in flight as `starting`", async () => {
    const boot = new ControlPlaneBoot(true);
    boot.phase = "waiting";
    expect(boot.health(1).body).toEqual({ ok: false, reason: "database" });
    boot.phase = "rehydrating";
    expect(boot.controlPlane).toBe(true);
    expect(boot.settled).toBe(false);
    expect(boot.health(1).body).toEqual({ ok: false, reason: "starting" });
    boot.phase = "off";
    expect(boot.health(1).body).toEqual({ ok: false, reason: "database" });
  });

  it("a setup that drops mid-migrate is retried, not left half up", async () => {
    const h = harness({ setupFails: 2 });
    const boot = h.attach(new ControlPlaneBoot(true));
    await startControlPlane(boot, h.deps);
    expect(boot.phase).toBe("up");
    expect(h.sleeps).toEqual([1000, 2000]);
    expect(h.hosted).toEqual(["e1"]);
  });

  it("one event that won't rehydrate is logged and skipped; the rest are hosted", async () => {
    const h = harness({ rows: [{ id: "bad" }, { id: "e2" }], bad: "bad" });
    const boot = h.attach(new ControlPlaneBoot(true));
    await startControlPlane(boot, h.deps);
    expect(h.hosted).toEqual(["e2"]);
    expect(boot.phase).toBe("up");
    expect(h.logs.some((l) => /could not rehydrate event bad/u.test(l))).toBe(true);
    // Its phones and its door code hear "failed to load" (503), never the
    // 404 that signs a phone out; health says which row is down …
    expect(boot.missEvent("bad")).toEqual({ status: 503, body: { error: "event failed to load" }, retryAfter: 5 });
    expect(boot.missCode(" G-bad ")).toEqual({ status: 503, body: { error: "event failed to load" }, retryAfter: 5 });
    expect(boot.health(2)).toEqual({ status: 503, body: { ok: false, reason: "events", failed: ["bad"] } });
    // … until it is hosted again (a relaunch under the same id).
    expect(boot.health(3, (id) => id === "bad")).toEqual({ status: 200, body: { ok: true, controlPlane: true, events: 3 } });
    // Anything else is gone for good once the boot has settled.
    expect(boot.missEvent("nope")).toEqual({ status: 404, body: { error: "unknown event" } });
    expect(boot.missCode("WRONG")).toEqual({ status: 404, body: { error: "no event with that code" } });
  });

  it("the router's misses: 503 starting + retry-after 1 until the boot settles, then 404", async () => {
    const h = harness({ misses: 1 });
    const boot = h.attach(new ControlPlaneBoot(true));
    const starting = { status: 503, body: { error: "starting" }, retryAfter: 1 };
    expect(boot.missEvent("e1")).toEqual(starting);
    expect(boot.missCode("G-e1")).toEqual(starting);
    boot.phase = "waiting";
    expect(boot.missEvent("e1")).toEqual(starting);
    boot.phase = "rehydrating";
    expect(boot.missCode("anything")).toEqual(starting);
    await startControlPlane(boot, h.deps);
    expect(boot.missEvent("e9")).toEqual({ status: 404, body: { error: "unknown event" } });
    expect(boot.missCode("G-e9")).toEqual({ status: 404, body: { error: "no event with that code" } });
    // A LAN box that settled off answers 404 at once.
    const lan = new ControlPlaneBoot(false);
    lan.phase = "off";
    expect(lan.missEvent("e1").status).toBe(404);
  });


  it("a LAN box (no DATABASE_URL) probes once, settles off and stays healthy", async () => {
    const h = harness({ misses: 99 });
    const boot = h.attach(new ControlPlaneBoot(false));
    // Healthy from the first moment: the LAN event never waits on a database.
    expect(boot.health(1)).toEqual({ status: 200, body: { ok: true, controlPlane: false, events: 1 } });
    await startControlPlane(boot, h.deps);
    expect(h.probes).toBe(1);
    expect(h.sleeps).toEqual([]);
    expect(boot.phase).toBe("off");
    expect(boot.settled).toBe(true);
    expect(boot.controlPlane).toBe(false);
    expect(boot.health(1).status).toBe(200);
    expect(h.logs).toEqual(["  ⚠️  control plane disabled — database unreachable"]);
  });

  it("a LAN box with its dev database comes up the same as a deployment", async () => {
    const h = harness();
    const boot = h.attach(new ControlPlaneBoot(false));
    await startControlPlane(boot, h.deps);
    expect(boot.phase).toBe("up");
    expect(boot.health(2)).toEqual({ status: 200, body: { ok: true, controlPlane: true, events: 2 } });
  });
});
