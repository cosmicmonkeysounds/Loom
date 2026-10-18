//! W9 O1-01 (C7): a full director console that opts into keyed patches
//! (`/events?role=mod&delta=1`) gets a keyframe `snapshot` (with `_frame`),
//! then `snapshotPatch {base, frame, patch}` frames that rebuild exactly the
//! view a plain console gets in the same round — and a keyframe again after
//! a restart, after being owed a view, and once a minute. A plain console's
//! stream is what it was: whole snapshots, no `_frame`.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventRuntime, MOD_KEYFRAME_MS, MOD_SNAPSHOT_MS } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { scenarioSource } from "../examples/load.ts";
import { applyModPatch, type ModPatchFrame } from "../server/mod-patch.ts";
import type { ModView } from "../server/views.ts";

const SHOW = "trapped-in-the-internet";
const CODES = { event: "EVT444", prime: "PRM444", mod: "MOD444" };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

function runtime(): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-delta-"));
  dirs.push(d);
  return new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: SHOW, scenarioSource: scenarioSource(SHOW), joinBase: () => "http://localhost", modSnapshotMs: 0, snapshotMs: 0 });
}

interface Frame {
  event: string;
  data: unknown;
}

/** A director's stream: every `event:` + `data:` pair it was written. */
function streamRes() {
  let pending: string | null = null;
  const res = {
    statusCode: 0,
    body: "",
    writableLength: 0,
    writableEnded: false,
    destroyed: false,
    frames: [] as Frame[],
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    write(chunk: string) {
      if (chunk.startsWith("event: ")) pending = chunk.slice(7).trim();
      else if (pending !== null && chunk.startsWith("data: ")) {
        res.frames.push({ event: pending, data: JSON.parse(chunk.slice(6)) });
        pending = null;
      }
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      res.writableEnded = true;
      return res;
    },
    on() {
      return res;
    },
    destroy() {
      res.destroyed = true;
      return res;
    },
  };
  return res;
}

function fakeReq(body: unknown): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
  } as unknown as IncomingMessage;
}

async function open(rt: EventRuntime, query: string) {
  const res = streamRes();
  const url = new URL(`http://x/events?role=mod${query}`);
  await rt.handle(fakeReq({}), res as unknown as ServerResponse, "GET", "/events", url, { moderator: true, moderatorName: "Ada" });
  return res;
}

async function post(rt: EventRuntime, path: string, body: unknown) {
  const res = streamRes();
  await rt.handle(fakeReq(body), res as unknown as ServerResponse, "POST", path, new URL(`http://x${path}`), { moderator: true, moderatorName: "Ada" });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}

const views = (frames: Frame[]) => frames.filter((f) => f.event === "snapshot" || f.event === "snapshotPatch");

/** Replay a delta console's frames: each step's whole view, plus which
 *  kind of frame carried it. */
function replay(frames: Frame[]): Array<{ kind: string; view: ModView; frame: number }> {
  const out: Array<{ kind: string; view: ModView; frame: number }> = [];
  let last: { view: ModView; frame: number } | null = null;
  for (const f of views(frames)) {
    if (f.event === "snapshot") {
      const { _frame, ...view } = f.data as ModView & { _frame: number };
      expect(typeof _frame).toBe("number");
      last = { view: view as ModView, frame: _frame };
    } else {
      const p = f.data as ModPatchFrame;
      expect(last).not.toBeNull();
      expect(p.base).toBe(last!.frame);
      expect(p.frame).toBeGreaterThan(p.base);
      last = { view: applyModPatch(last!.view, p.patch), frame: p.frame };
    }
    out.push({ kind: f.event, ...last });
  }
  return out;
}

/** A round of director work: personas, edits, codex, lines, cues. */
async function steps(rt: EventRuntime, n: number, from = 0) {
  for (let i = from; i < from + n; i++) {
    const p = await post(rt, "/api/mod/persona", { name: `Bot ${i}` });
    const id = (p.json.guest as { id: string }).id;
    await post(rt, "/api/mod/set", { id, field: "score", value: 10 + i });
    await post(rt, "/api/mod/say", { channel: "lobby", text: `line ${i}`, as: "" });
    await post(rt, "/api/mod/codex", { who: id, entry: "The LiveJournal" });
  }
}

describe("the delta mod stream", () => {
  it("patches rebuild exactly the plain console's views; a plain console still gets only whole snapshots", async () => {
    const rt = runtime();
    rt.openDoors();
    const delta = await open(rt, "&delta=1");
    const plain = await open(rt, "");
    await steps(rt, 6);

    const got = replay(delta.frames);
    const whole = views(plain.frames);
    expect(whole.every((f) => f.event === "snapshot")).toBe(true);
    expect(whole.every((f) => !("_frame" in (f.data as object)))).toBe(true);
    // The delta console connected first: one frame more, then round for round.
    expect(got.length).toBe(whole.length + 1);
    got.slice(1).forEach((g, i) => expect(g.view, `round ${i}`).toEqual(whole[i]!.data));
    // A keyframe first, then patches only.
    expect(got[0]!.kind).toBe("snapshot");
    expect(got.slice(1).every((g) => g.kind === "snapshotPatch")).toBe(true);
    // …and much smaller ones.
    const bytes = (fs: Frame[]) => fs.reduce((n, f) => n + JSON.stringify(f.data).length, 0);
    expect(bytes(views(delta.frames).slice(1)) * 10).toBeLessThan(bytes(whole));
  });

  it("a restart, a minute and an owed view each bring a keyframe", async () => {
    const rt = runtime();
    rt.openDoors();
    const delta = await open(rt, "&delta=1");
    const plain = await open(rt, "");
    await steps(rt, 2);
    const kinds = () => replay(delta.frames).map((g) => g.kind);
    const lastIsWhole = () => expect(kinds().at(-1)).toBe("snapshot");
    expect(kinds().at(-1)).toBe("snapshotPatch");

    // A restart: the timeline was cut. The first view after the `lifecycle`
    // notice is whole, and so is the first after the fresh `history`.
    const n0 = delta.frames.length;
    await post(rt, "/api/mod/reset", {});
    const cut = delta.frames.slice(n0).map((f) => f.event).filter((e) => e !== "sim" && e !== "message");
    expect(cut[0]).toBe("lifecycle");
    expect(cut[1]).toBe("snapshot");
    expect(cut.at(-1)).toBe("history");
    await post(rt, "/api/mod/say", { channel: "lobby", text: "after the cut", as: "" });
    lastIsWhole();
    await steps(rt, 1, 10);
    expect(kinds().at(-1)).toBe("snapshotPatch");

    // A minute without one.
    vi.setSystemTime(Date.now() + MOD_KEYFRAME_MS);
    await post(rt, "/api/mod/say", { channel: "lobby", text: "a minute on", as: "" });
    lastIsWhole();
    await post(rt, "/api/mod/say", { channel: "lobby", text: "and again", as: "" });
    expect(kinds().at(-1)).toBe("snapshotPatch");

    // Behind by a whole view: skipped (owed), then whole once it reads.
    delta.writableLength = 10_000_000;
    const before = views(delta.frames).length;
    await post(rt, "/api/mod/say", { channel: "lobby", text: "while it lags", as: "" });
    expect(views(delta.frames).length).toBe(before);
    delta.writableLength = 0;
    await new Promise((r) => setTimeout(r, MOD_SNAPSHOT_MS + 50)); // the owed round
    lastIsWhole();
    await post(rt, "/api/mod/say", { channel: "lobby", text: "caught up", as: "" });
    expect(kinds().at(-1)).toBe("snapshotPatch");

    // Every view it rebuilt is a view the plain console was sent.
    const plainViews = views(plain.frames).map((f) => JSON.stringify(f.data));
    for (const g of replay(delta.frames).slice(1)) expect(plainViews).toContain(JSON.stringify(g.view));
  });
});
