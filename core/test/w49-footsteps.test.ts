//! Wave 49 (docs/loom-w49-contract.md C3.1): the house hears a program walk.
//! `SpatialHub` measures each session's speed and runs `walkersOf` on every
//! flush; `AudioHub` keeps the frames and the router's stream; `GET
//! /api/mod/audio/walkers` carries them, `POST /api/mod/audio/walkers/test`
//! plays a test walker.

import { createServer, get, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  FOOTSTEP_MAX_MPS,
  FOOTSTEP_MEASURE_MS,
  FOOTSTEP_TEST_MS,
  FOOTSTEPS_KEEP_MS,
  FOOTSTEPS_MIN_MS,
  defaultAudio,
  validateHouse,
  type AudioConfig,
  type HouseMap,
  type Vec3,
  type Walker,
  type WalkersFrame,
} from "@loom/house";

import { AudioHub, WALKER_TEST_ID, WALKER_TEST_MPS, type WalkerTimers } from "../server/audio.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { isHostRoute } from "../server/routes/host.ts";
import { SpatialHub, WALK_STILL_MS } from "../server/spatial.ts";
import { Store } from "../server/store.ts";

const FIX = join(import.meta.dirname, "..", "..", "house", "test", "fixtures");
const HOUSE_FILE = join(FIX, "lights-house.json");
const HOUSE = ((): HouseMap => {
  const v = validateHouse(JSON.parse(readFileSync(HOUSE_FILE, "utf8")));
  if (!v.ok || v.house === undefined) throw new Error(v.problems.join("\n"));
  return v.house;
})();

/** Two speakers on the main floor, each side of the `living-hall` door. */
const AUDIO: AudioConfig = {
  ...defaultAudio(),
  speakers: [
    { id: "desk", name: "Desk", room: "desktop", pos: { x: 3, y: 0, z: 2 }, yaw: 0, out: [1] },
    { id: "hall", name: "Hall", room: "hall", pos: { x: 3, y: 0, z: 5 }, yaw: 0, out: [2] },
  ],
};

const CODES = { event: "EVTW49", prime: "PRMW49", mod: "MODW49" };
const STORY = `# T\n\nLOCATION The Desktop\n\nCHARACTER Task Manager\n  admin: true\n  when scanned by guest:\n    reply ok\n\nCHARACTER Clippy\n  when scanned by guest:\n    reply hi\n\n== Boot\n  setting: The Desktop\nHello.\n`;

const pose = (p: Vec3, yaw = 0) => ({ p, yaw, pitch: 0 });
const at = (x: number, z = 2): Vec3 => [x, 0, z];

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-w49-"));
  dirs.push(d);
  return d;
}

// ---------------------------------------------------------------------------
// SpatialHub
// ---------------------------------------------------------------------------

function rig(o: { audio?: AudioConfig | null; read?: () => AudioConfig } = {}) {
  let t = 1_000_000;
  let ids = 0;
  const told: Array<{ at: number; walkers: Walker[] }> = [];
  const audio = o.audio === undefined ? AUDIO : o.audio;
  const getAudio = o.read ?? (audio === null ? undefined : () => audio);
  const hub = new SpatialHub({
    eventId: "evt",
    now: () => t,
    newSessionId: () => `s-${++ids}`,
    newToken: () => `tok-${ids}`,
    ...(getAudio !== undefined ? { audio: getAudio } : {}),
    onWalkers: (walkers) => told.push({ at: t, walkers }),
  });
  hub.setHouse(HOUSE, "show", false);
  const begin = (guest: string) => hub.begin({ guest, name: guest, world: "web", device: "Tent", station: null, captured: false })!;
  /** One 100 ms tick: a pose (if any) lands, then the flush loop runs. */
  const tick = (token: string | null, p: Vec3 | null) => {
    t += 100;
    if (token !== null && p !== null) hub.pose(token, pose(p));
    hub.flush();
  };
  /** Walk along x at `mps`, a pose + flush every 100 ms; ends at the last x. */
  const walk = (token: string, fromX: number, mps: number, ms: number, z = 2): number => {
    let x = fromX;
    for (let i = 0; i < ms / 100; i++) {
      x += mps / 10;
      tick(token, at(x, z));
    }
    return x;
  };
  return { hub, told, begin, tick, walk, wait: (ms: number) => (t += ms), now: () => t, last: () => told.at(-1)?.walkers };
}

describe("SpatialHub: the footsteps (C3.1)", () => {
  it("measures a walking speed, to the step the wire carries, from the poses alone", () => {
    const r = rig();
    const a = r.begin("ann");
    r.walk(a.token, 2, 1.4, 1000);
    const w = r.last()!;
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ id: a.session, speed: 1.5, surface: "floor" });
    // A stroll reads slower; a shuffle under FOOTSTEP_MOVING_MPS is standing.
    const s = rig();
    const b = s.begin("bob");
    s.walk(b.token, 2, 0.7, 1000);
    expect(s.last()![0]!.speed).toBe(0.75);
    const f = rig();
    const c = f.begin("cat");
    f.walk(c.token, 2, 0.1, 1000);
    expect(f.told).toEqual([]);
  });

  it("the network's jitter barely moves the pace: walking windows are averaged", () => {
    // A steady 1.4 m/s, sent every 100 ms, each pose landing up to 80 ms late
    // (a seeded walk: the same one every run).
    let seed = 12345;
    const late = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const speeds = new Set<number>();
    for (let walk = 0; walk < 8; walk++) {
      const r = rig();
      const a = r.begin("ann");
      let clock = 0;
      for (let k = 1; k <= 40; k++) {
        const lands = Math.max(clock, k * 100 + late() * 80);
        r.wait(lands - clock);
        clock = lands;
        r.hub.pose(a.token, pose([2 + (1.4 * k) / 10, 0, 2]));
        r.hub.flush();
      }
      // Past the first window or two, which have nothing to average with.
      for (const c of r.told.slice(2)) speeds.add(c.walkers[0]!.speed);
    }
    expect([...speeds].sort()).toEqual([1.25, 1.5]);
  });

  it("the speakers are judged by the presence room, not the raw one", () => {
    const r = rig();
    const a = r.begin("ann");
    // Across the door at (2, 4): still the desktop within the hysteresis.
    let z = 3.2;
    for (let i = 0; i < 9; i++) {
      z += 0.1;
      r.tick(a.token, [2, 0, z]);
    }
    expect(r.hub.players()[0]!.room).toBe("hall");
    const to = r.last()![0]!.to;
    expect(to.find((o) => o.speaker === "desk")).toMatchObject({ muffled: false });
    expect(to.find((o) => o.speaker === "hall")).toMatchObject({ muffled: true });
  });

  it("nothing is heard before a whole measuring window has passed", () => {
    const r = rig();
    const a = r.begin("ann");
    r.walk(a.token, 2, 1.4, 100);
    expect(r.told).toEqual([]);
    r.walk(a.token, 2.14, 1.4, FOOTSTEP_MEASURE_MS);
    expect(r.told).toHaveLength(1);
  });

  it("a head turning on the spot is no walk", () => {
    const r = rig();
    const a = r.begin("ann");
    for (let i = 0; i < 20; i++) {
      r.wait(100);
      r.hub.pose(a.token, pose([2, 0, 2], i * 5));
      r.hub.flush();
    }
    expect(r.told).toEqual([]);
  });

  it("an escape's teleport never reads as a walk, nor does a jump in the poses", () => {
    const r = rig();
    const a = r.begin("ann");
    const out: Vec3 = [-9, 0, 2];
    // Far out in the void, walking there.
    r.hub.pose(a.token, pose(out));
    r.wait(FOOTSTEP_MEASURE_MS);
    r.hub.flush();
    expect(r.hub.moment(a.token, { kind: "escape" }, () => [])).toMatchObject({ kind: "ok" });
    for (let i = 0; i < 6; i++) r.tick(null, null);
    expect(r.told).toEqual([]);

    // A walk cut by the escape is heard stopping at once, and a late pose
    // from out there, then the re-seat, is no walk either.
    const w = rig();
    const b = w.begin("bob");
    w.walk(b.token, 2, 1.4, 600);
    expect(w.last()).toHaveLength(1);
    w.hub.pose(b.token, pose(out));
    w.wait(FOOTSTEP_MEASURE_MS);
    w.hub.moment(b.token, { kind: "escape" }, () => []);
    w.tick(null, null);
    expect(w.last()).toEqual([]);
    const heard = w.told.length;
    w.wait(FOOTSTEP_MEASURE_MS);
    w.tick(b.token, out);
    w.wait(FOOTSTEP_MEASURE_MS);
    w.tick(b.token, [2, 0, 2]);
    expect(w.told).toHaveLength(heard);

    // A game's own jump: far past the fastest walk.
    const j = rig();
    const c = j.begin("cat");
    expect(((8 - 1) * 1000) / (FOOTSTEP_MEASURE_MS + 100)).toBeGreaterThan(FOOTSTEP_MAX_MPS);
    j.hub.pose(c.token, pose(at(1)));
    j.wait(FOOTSTEP_MEASURE_MS + 100);
    j.hub.pose(c.token, pose(at(8)));
    j.hub.flush();
    expect(j.told).toEqual([]);
  });

  it("a map swap that re-seats a player is no walk", () => {
    const r = rig();
    const a = r.begin("ann");
    r.walk(a.token, 2, 1.4, 600);
    const moved = structuredClone(HOUSE);
    moved.rooms = moved.rooms.filter((x) => x.id !== "desktop");
    moved.doors = moved.doors.filter((d) => d.a !== "desktop" && d.b !== "desktop");
    moved.stairs = moved.stairs.filter((st) => st.from !== "desktop" && st.to !== "desktop");
    moved.terminals = moved.terminals.filter((x) => x.room !== "desktop");
    moved.duck.spots = [{ id: "hall-duck", room: "hall", pos: [8, 0, 5] }];
    moved.props = moved.props.filter((p) => p.room !== "desktop");
    moved.spawn = { room: "hall", pos: [4.5, 0, 5], yaw: 0 };
    r.hub.setHouse(moved, "event");
    r.tick(null, null);
    expect(r.last()).toEqual([]);
  });

  it("a held walk goes silent, and is heard again once it walks on", () => {
    const r = rig();
    const a = r.begin("ann");
    const x = r.walk(a.token, 2, 1.4, 600);
    expect(r.last()).toHaveLength(1);
    expect(r.hub.suspend(a.token)).toBe("ok");
    r.tick(null, null);
    expect(r.last()).toEqual([]);
    r.walk(a.token, x, 1.4, 600);
    expect(r.last()).toHaveLength(1);
  });

  it("a found session goes silent while it lingers", () => {
    const r = rig();
    const a = r.begin("ann");
    const duck = a.duck.pos;
    // Walking up to the duck at (1, 0, 1).
    for (let i = 0; i < 6; i++) r.tick(a.token, [duck[0] + 0.14 * (6 - i), 0, duck[2]]);
    expect(r.last()).toHaveLength(1);
    expect(r.hub.found(a.token, () => true)).toMatchObject({ kind: "found" });
    r.tick(null, null);
    expect(r.last()).toEqual([]);
    expect(r.hub.sessionCount).toBe(1);
  });

  it("a parked assignment no pose has claimed is never a walker", () => {
    const r = rig();
    r.hub.begin({ guest: "ann", name: "ann", world: "vr", device: "Quest", station: "q", captured: false });
    r.tick(null, null);
    expect(r.told).toEqual([]);
  });

  it("frames are at most every FOOTSTEPS_MIN_MS, with the trailing edge kept", () => {
    const r = rig();
    const a = r.begin("ann");
    let x = 1;
    // The level moves with the distance on nearly every tick.
    for (let i = 0; i < 40; i++) {
      x += 0.16;
      r.tick(a.token, at(x, 1));
    }
    expect(r.told.length).toBeGreaterThan(4);
    for (let i = 1; i < r.told.length; i++) expect(r.told[i]!.at - r.told[i - 1]!.at).toBeGreaterThanOrEqual(FOOTSTEPS_MIN_MS);
    // A change inside the window: held back, then told on the first tick past it.
    const q = rig();
    const b = q.begin("bob");
    const stop = q.walk(b.token, 1, 1.4, 500, 1);
    const n = q.told.length;
    const toldAt = q.told.at(-1)!.at;
    const before = JSON.stringify(q.last());
    let y = stop;
    while (JSON.stringify(q.last()) === before) {
      y += 0.14;
      q.tick(b.token, at(y, 1));
    }
    expect(q.told).toHaveLength(n + 1);
    expect(q.told.at(-1)!.at - toldAt).toBeGreaterThanOrEqual(FOOTSTEPS_MIN_MS);
  });

  it("stops when the last walker stops: at once, past the rate limit, and only then", () => {
    const r = rig();
    const a = r.begin("ann");
    const b = r.begin("bob");
    let x = 1;
    let y = 1;
    for (let i = 0; i < 8; i++) {
      x += 0.14;
      y += 0.14;
      r.wait(100);
      r.hub.pose(a.token, pose(at(x, 1)));
      r.hub.pose(b.token, pose(at(y, 3)));
      r.hub.flush();
    }
    expect(r.last()).toHaveLength(2);
    // Ann stops (a game sends no pose while its player stands); Bob walks on.
    const stopped = r.now();
    for (let i = 0; i < WALK_STILL_MS / 100 + 2; i++) {
      y += 0.14;
      r.tick(b.token, at(y, 3));
    }
    expect(r.last()!.map((w) => w.id)).toEqual([b.session]);
    expect(r.told.find((c) => c.walkers.length === 1)!.at - stopped).toBeLessThanOrEqual(WALK_STILL_MS + 200);
    // Bob stops: told nobody, and then never again.
    for (let i = 0; i < WALK_STILL_MS / 100 + 1; i++) r.tick(null, null);
    expect(r.last()).toEqual([]);
    const n = r.told.length;
    for (let i = 0; i < 10; i++) r.tick(null, null);
    expect(r.told).toHaveLength(n);
  });

  it("walks on after a stop at its true speed, not a window that spans the stop", () => {
    const r = rig();
    const a = r.begin("ann");
    const x = r.walk(a.token, 1, 1.4, 500, 1);
    for (let i = 0; i < WALK_STILL_MS / 100 + 3; i++) r.tick(null, null);
    expect(r.last()).toEqual([]);
    r.walk(a.token, x, 1.4, 400, 1);
    expect(r.last()![0]!.speed).toBe(1.5);
  });

  it("`active` holds until the walkers are empty, so the loop tells the stop", () => {
    const r = rig();
    const a = r.begin("ann");
    r.walk(a.token, 2, 1.4, 600);
    r.hub.endByToken(a.token);
    expect(r.hub.sessionCount).toBe(0);
    expect(r.hub.active).toBe(true);
    r.hub.flush();
    expect(r.last()).toEqual([]);
    expect(r.hub.active).toBe(false);
  });

  it("a story reset is a cut: told nobody at once", () => {
    const r = rig();
    const a = r.begin("ann");
    r.walk(a.token, 2, 1.4, 600);
    r.hub.reset("reset");
    expect(r.last()).toEqual([]);
    expect(r.hub.active).toBe(false);
  });

  it("footsteps off, no audio getter, or a getter that throws: nobody, and no crash", () => {
    const off = rig({ audio: { ...AUDIO, footsteps: { enabled: false } } });
    off.walk(off.begin("ann").token, 2, 1.4, 600);
    expect(off.told).toEqual([]);
    const none = rig({ audio: null });
    none.walk(none.begin("ann").token, 2, 1.4, 600);
    expect(none.told).toEqual([]);
    const bad = rig({
      read: () => {
        throw new Error("no config");
      },
    });
    bad.walk(bad.begin("ann").token, 2, 1.4, 600);
    expect(bad.told).toEqual([]);
  });

  it("a house standing still never reads the audio config", () => {
    let reads = 0;
    const r = rig({
      read: () => {
        reads++;
        return AUDIO;
      },
    });
    const a = r.begin("ann");
    for (let i = 0; i < 30; i++) r.tick(null, null);
    expect(reads).toBe(0);
    r.walk(a.token, 2, 1.4, 500);
    expect(reads).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AudioHub
// ---------------------------------------------------------------------------

function audioRig() {
  let t = 2_000_000;
  const pending: Array<{ fn: () => void; at: number }> = [];
  const timers: WalkerTimers = {
    set: (fn, ms) => {
      const entry = { fn, at: t + ms };
      pending.push(entry);
      return entry;
    },
    clear: (h) => {
      const i = pending.indexOf(h as { fn: () => void; at: number });
      if (i >= 0) pending.splice(i, 1);
    },
  };
  const hub = new AudioHub({ store: new Store(freshDir()), projectText: JSON.stringify(AUDIO), envFile: null, now: () => t, walkerTimers: timers });
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const next = pending.filter((p) => p.at <= end).sort((a, b) => a.at - b.at)[0];
      if (next === undefined) break;
      t = Math.max(t, next.at);
      pending.splice(pending.indexOf(next), 1);
      next.fn();
    }
    t = end;
  };
  return { hub, pending, advance, now: () => t };
}
const walker = (id: string): Walker => ({ id, speed: 1.5, surface: "floor", to: [{ speaker: "desk", db: -2, muffled: false }] });

describe("AudioHub: the walkers (C3.1)", () => {
  it("a subscriber hears the frame on connect, then every change with a new seq", () => {
    const r = audioRig();
    const frames: WalkersFrame[] = [];
    r.hub.onWalkers((f) => frames.push(f));
    expect(frames).toEqual([{ seq: 0, at: r.now(), walkers: [] }]);
    r.hub.setWalkers([walker("s-1")]);
    expect(frames.at(-1)).toEqual({ seq: 1, at: r.now(), walkers: [walker("s-1")] });
    r.hub.setWalkers([]);
    expect(frames.at(-1)).toMatchObject({ seq: 2, walkers: [] });
    expect(frames).toHaveLength(3);
  });

  it("a frame every FOOTSTEPS_KEEP_MS while anyone walks, each with a new seq; none in a quiet house", () => {
    const r = audioRig();
    const frames: WalkersFrame[] = [];
    const off = r.hub.onWalkers((f) => frames.push(f));
    r.advance(FOOTSTEPS_KEEP_MS * 3);
    expect(frames).toHaveLength(1);
    r.hub.setWalkers([walker("s-1")]);
    r.advance(FOOTSTEPS_KEEP_MS * 3);
    expect(frames).toHaveLength(5);
    expect(frames.map((f) => f.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(frames.at(-1)!.walkers).toEqual([walker("s-1")]);
    // A change pushes the keepalive back.
    r.advance(FOOTSTEPS_KEEP_MS - 1);
    r.hub.setWalkers([walker("s-2")]);
    r.advance(FOOTSTEPS_KEEP_MS - 1);
    expect(frames).toHaveLength(6);
    r.advance(1);
    expect(frames).toHaveLength(7);
    // The last one stops: the timer goes with it.
    r.hub.setWalkers([]);
    expect(r.pending).toHaveLength(0);
    // Nobody listening: no timer, and a late subscriber still starts one.
    r.hub.setWalkers([walker("s-3")]);
    off();
    expect(r.pending).toHaveLength(0);
    expect(r.hub.walkerListeners).toBe(0);
    const late: WalkersFrame[] = [];
    r.hub.onWalkers((f) => late.push(f));
    expect(late[0]!.walkers).toEqual([walker("s-3")]);
    expect(r.pending).toHaveLength(1);
    r.hub.endWalkers();
    expect(r.pending).toHaveLength(0);
  });

  it("the test walker: one speaker, 0 dB, merged with the real ones, gone with a frame at its end", () => {
    const r = audioRig();
    const frames: WalkersFrame[] = [];
    r.hub.onWalkers((f) => frames.push(f));
    r.hub.setWalkers([walker("s-1")]);
    r.hub.testWalker("hall");
    const test: Walker = { id: WALKER_TEST_ID, speed: WALKER_TEST_MPS, surface: "floor", to: [{ speaker: "hall", db: 0, muffled: false }] };
    expect(frames.at(-1)!.walkers).toEqual([walker("s-1"), test]);
    // A real walker's change keeps the test.
    r.hub.setWalkers([]);
    expect(frames.at(-1)!.walkers).toEqual([test]);
    r.advance(FOOTSTEP_TEST_MS - 1);
    expect(frames.at(-1)!.walkers).toEqual([test]);
    const n = frames.length;
    r.advance(1);
    expect(frames).toHaveLength(n + 1);
    expect(frames.at(-1)!.walkers).toEqual([]);
    expect(r.pending).toHaveLength(0);
    // A second test restarts the clock on its own speaker.
    r.hub.testWalker("desk");
    r.advance(FOOTSTEP_TEST_MS / 2);
    r.hub.testWalker("hall");
    r.advance(FOOTSTEP_TEST_MS - 1);
    expect(frames.at(-1)!.walkers[0]!.to[0]!.speaker).toBe("hall");
    r.advance(1);
    expect(frames.at(-1)!.walkers).toEqual([]);
  });

  it("with no stream open the frame still drops the test once it is over", () => {
    const r = audioRig();
    r.hub.testWalker("hall");
    expect(r.hub.walkersFrame().walkers).toHaveLength(1);
    r.advance(FOOTSTEP_TEST_MS);
    expect(r.hub.walkersFrame().walkers).toEqual([]);
  });

  it("config() is the config in force", () => {
    const r = audioRig();
    expect(r.hub.config()).toEqual(r.hub.current().audio);
  });
});

// ---------------------------------------------------------------------------
// The routes, on a real socket
// ---------------------------------------------------------------------------

interface Stream {
  status: number;
  headers: IncomingHttpHeaders;
  frames: Array<{ at: number; frame: WalkersFrame }>;
  text: () => string;
  close: () => void;
  until: (ok: (f: WalkersFrame) => boolean, ms?: number) => Promise<WalkersFrame>;
}

async function serve(rt: EventRuntime): Promise<{ base: string; stop: () => Promise<void>; server: Server }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://x");
    void rt.handle(req, res, req.method ?? "GET", url.pathname, url, {}).then((hit) => {
      if (!hit) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    base: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

function open(base: string, path: string, headers: Record<string, string> = {}): Promise<Stream> {
  return new Promise((resolve, reject) => {
    let raw = "";
    const frames: Stream["frames"] = [];
    const wants: Array<() => void> = [];
    const req = get(`${base}${path}`, { headers }, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        raw += chunk;
        for (;;) {
          const end = raw.indexOf("\n\n");
          if (end < 0) break;
          const block = raw.slice(0, end);
          raw = raw.slice(end + 2);
          all += `${block}\n\n`;
          const data = /^event: walkers\ndata: (.*)$/mu.exec(block);
          if (data !== null) frames.push({ at: Date.now(), frame: JSON.parse(data[1]!) as WalkersFrame });
        }
        for (const w of [...wants]) w();
      });
      res.on("error", () => {});
      resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        frames,
        text: () => all,
        close: () => req.destroy(),
        until: (ok, ms = 4000) =>
          new Promise<WalkersFrame>((yes, no) => {
            const check = (): boolean => {
              const hit = frames.find((f) => ok(f.frame));
              if (hit === undefined) return false;
              clearTimeout(timer);
              wants.splice(wants.indexOf(check), 1);
              yes(hit.frame);
              return true;
            };
            const timer = setTimeout(() => no(new Error(`no such frame in ${JSON.stringify(frames.map((f) => f.frame))}`)), ms);
            wants.push(check);
            check();
          }),
      });
    });
    let all = "";
    req.on("error", (err) => {
      if (!req.destroyed) reject(err);
    });
  });
}

function runtime(): EventRuntime {
  return new EventRuntime({
    eventId: "evt",
    store: new Store(freshDir()),
    codes: CODES,
    scenarioName: "t",
    scenarioSource: STORY,
    joinBase: () => "http://localhost",
    houseFile: HOUSE_FILE,
    audio: JSON.stringify(AUDIO),
    audioFile: null,
    lightsFile: null,
  });
}

async function post(base: string, path: string, body: unknown, token?: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token !== undefined ? { "x-loom-token": token } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
}

async function modToken(base: string): Promise<string> {
  return (await post(base, "/api/mod/login", { passcode: CODES.mod })).json["token"] as string;
}

describe("the routes (C3.1)", () => {
  it("GET /api/mod/audio/walkers: a mod token in the query or the header; nobody else", async () => {
    const rt = runtime();
    const s = await serve(rt);
    const mod = await modToken(s.base);
    const none = await fetch(`${s.base}/api/mod/audio/walkers`);
    expect(none.status).toBe(403);
    const wrong = await fetch(`${s.base}/api/mod/audio/walkers?token=nope`);
    expect(wrong.status).toBe(403);
    // A performer, a host's booth, a guest and a game session are all refused.
    const perf = (await post(s.base, "/api/prime/login", { character: "Clippy", passcode: CODES.prime })).json["token"] as string;
    expect((await fetch(`${s.base}/api/mod/audio/walkers?token=${perf}`)).status).toBe(403);
    const host = (await post(s.base, "/api/prime/login", { character: "Task Manager", passcode: CODES.prime })).json["token"] as string;
    const refused = await fetch(`${s.base}/api/mod/audio/walkers?token=${host}`);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "not from a booth" });
    expect((await post(s.base, "/api/mod/audio/walkers/test", { speaker: "desk" }, perf)).status).toBe(403);
    rt.spatial.setHouse(HOUSE, "show", false);
    const session = rt.spatial.begin({ guest: "ann", name: "ann", world: "web", device: "Tent", station: null, captured: false })!;
    expect((await fetch(`${s.base}/api/mod/audio/walkers?token=${session.token}`)).status).toBe(403);

    const query = await open(s.base, `/api/mod/audio/walkers?token=${mod}`);
    const header = await open(s.base, "/api/mod/audio/walkers", { "x-loom-token": mod });
    expect(query.status).toBe(200);
    expect(header.status).toBe(200);
    expect(query.headers["content-type"]).toBe("text/event-stream");
    await query.until(() => true);
    await header.until(() => true);
    expect(query.frames[0]!.frame).toMatchObject({ seq: 0, walkers: [] });
    expect(rt.audio.walkerListeners).toBe(2);
    query.close();
    header.close();
    rt.dispose();
    await s.stop();
  });

  it("the stream tells a compressing proxy to leave it alone (the router asks for gzip)", async () => {
    const rt = runtime();
    const s = await serve(rt);
    const st = await open(s.base, `/api/mod/audio/walkers?token=${await modToken(s.base)}`, { "accept-encoding": "gzip" });
    expect(st.headers["cache-control"]).toContain("no-transform");
    expect(st.headers["content-encoding"]).toBeUndefined();
    st.close();
    rt.dispose();
    await s.stop();
  });

  it("never on the host allowlist", () => {
    const ctx = { alertsPath: "", isAgent: () => false };
    expect(isHostRoute("GET", "/api/mod/audio/walkers", {}, ctx)).toBe(false);
    expect(isHostRoute("POST", "/api/mod/audio/walkers/test", { speaker: "desk" }, ctx)).toBe(false);
  });

  it("a walk reaches the stream, and the stop ends it; the stream closing unsubscribes", async () => {
    const rt = runtime();
    const s = await serve(rt);
    rt.spatial.setHouse(HOUSE, "show", false);
    const st = await open(s.base, `/api/mod/audio/walkers?token=${await modToken(s.base)}`);
    await st.until(() => true);
    const a = rt.spatial.begin({ guest: "ann", name: "ann", world: "web", device: "Tent", station: null, captured: false })!;
    let x = 2;
    for (let i = 0; i < 5; i++) {
      x += 0.14;
      await new Promise((r) => setTimeout(r, 70));
      rt.spatial.pose(a.token, pose(at(x)));
      rt.spatial.flush();
    }
    const walking = await st.until((f) => f.walkers.length === 1);
    expect(walking.walkers[0]).toMatchObject({ id: a.session, surface: "floor" });
    expect(walking.seq).toBe(1);
    rt.spatial.endByToken(a.token);
    rt.spatial.flush();
    await st.until((f) => f.seq > walking.seq && f.walkers.length === 0);
    st.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(rt.audio.walkerListeners).toBe(0);
    rt.dispose();
    await s.stop();
  });

  it("POST /api/mod/audio/walkers/test: a mod's; 404 an unknown speaker; a frame, the keepalive, then its end", async () => {
    const rt = runtime();
    const s = await serve(rt);
    const mod = await modToken(s.base);
    expect((await post(s.base, "/api/mod/audio/walkers/test", { speaker: "desk" })).status).toBe(403);
    expect((await post(s.base, "/api/mod/audio/walkers/test", {}, mod)).status).toBe(400);
    expect((await post(s.base, "/api/mod/audio/walkers/test", { speaker: "nope" }, mod))).toEqual({ status: 404, json: { error: "no such speaker" } });
    expect((await post(s.base, "/api/mod/audio/walkers/test", { speaker: 7 }, mod)).status).toBe(404);
    const host = (await post(s.base, "/api/prime/login", { character: "Task Manager", passcode: CODES.prime })).json["token"] as string;
    expect(await post(s.base, "/api/mod/audio/walkers/test", { speaker: "desk" }, host)).toEqual({ status: 403, json: { error: "not from a booth" } });

    const st = await open(s.base, `/api/mod/audio/walkers?token=${mod}`);
    await st.until(() => true);
    expect(await post(s.base, "/api/mod/audio/walkers/test", { speaker: "hall" }, mod)).toEqual({ status: 200, json: { ok: true } });
    const test = await st.until((f) => f.walkers.length === 1);
    expect(test.walkers).toEqual([{ id: WALKER_TEST_ID, speed: WALKER_TEST_MPS, surface: "floor", to: [{ speaker: "hall", db: 0, muffled: false }] }]);
    await st.until((f) => f.walkers.length === 0 && f.seq > test.seq, FOOTSTEP_TEST_MS + 1000);
    // The real clock: one keepalive on the way, and the end on time.
    const rows = st.frames.slice(1);
    expect(rows.map((r) => r.frame.walkers.length)).toEqual([1, 1, 0]);
    const ms = (i: number) => rows[i]!.at - rows[0]!.at;
    expect(ms(1)).toBeGreaterThanOrEqual(FOOTSTEPS_KEEP_MS - 50);
    expect(ms(1)).toBeLessThan(FOOTSTEPS_KEEP_MS + 500);
    expect(ms(2)).toBeGreaterThanOrEqual(FOOTSTEP_TEST_MS - 50);
    expect(ms(2)).toBeLessThan(FOOTSTEP_TEST_MS + 500);
    st.close();
    rt.dispose();
    await s.stop();
  }, 10_000);

  it("dispose ends the stream", async () => {
    const rt = runtime();
    const s = await serve(rt);
    const st = await open(s.base, `/api/mod/audio/walkers?token=${await modToken(s.base)}`);
    await st.until(() => true);
    rt.dispose();
    expect(rt.audio.walkerListeners).toBe(0);
    st.close();
    await s.stop();
  });
});
