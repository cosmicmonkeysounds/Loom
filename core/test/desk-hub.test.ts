//! Wave 25: the house desk's hub (`server/desk.ts`), transport-free with a
//! fake clock and fake timers: series and parallel groups, router acks
//! (lengths, ends), timeouts, the speech wait, stop, one run per cue, the
//! playhead and `moved`, the story's `cue X`, the marks and the config chain.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { DESK_ACK_MS, DESK_SPEECH_GRACE_MS, DESK_STOP_MS, type DeskConfig, type DeskLightState } from "../src/house-desk.ts";
import { DESK_BY, DESK_CHAIN_MAX, DeskHub, type DeskDeps, type DeskSpeechWatch, type DeskTimers, lookMsOf, parseDeskText } from "../server/desk.ts";
import type { AudioPlayRequest } from "../server/audio.ts";
import { Store } from "../server/store.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-desk-"));
  dirs.push(d);
  return d;
}

/** A clock + timers you advance by hand. */
function fakeTime(start = 1_000_000) {
  let now = start;
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: DeskTimers = {
    set(fn, ms) {
      const id = next++;
      pending.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clear(h) {
      pending.delete(h as number);
    },
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      let first: [number, { at: number; fn: () => void }] | null = null;
      for (const e of pending) if (e[1].at <= until && (first === null || e[1].at < first[1].at || (e[1].at === first[1].at && e[0] < first[0]))) first = e;
      if (first === null) break;
      pending.delete(first[0]);
      now = Math.max(now, first[1].at);
      first[1].fn();
    }
    now = until;
  };
  return { now: () => now, timers, advance, pending };
}

interface Fake {
  deps: DeskDeps;
  plays: Array<{ seq: number; p: AudioPlayRequest; by: string }>;
  looks: string[];
  lights: Array<{ to: readonly string[]; set: DeskLightState }>;
  stops: boolean[];
  fired: string[];
  speech: { done: string | null; none: boolean };
  refuse: Set<string>;
  router: boolean;
}
function fakeDeps(o: { onFire?: (e: string) => void } = {}): Fake {
  const f: Fake = { plays: [], looks: [], lights: [], stops: [], fired: [], speech: { done: null, none: false }, refuse: new Set(), router: true } as unknown as Fake;
  let seq = 0;
  f.deps = {
    play: (p, by) => {
      f.plays.push({ seq: ++seq, p, by });
      return seq;
    },
    routerOnline: () => f.router,
    stopAudio: (announce) => void f.stops.push(announce),
    look: (look) => {
      if (look === "nope") return false;
      f.looks.push(look);
      return true;
    },
    lookMs: (look) => (look === "flash" ? 1000 : look === "loop" ? 0 : null),
    light: (to, set) => {
      f.lights.push({ to, set });
      return 1;
    },
    lightsOnline: () => true,
    fire: (e) => {
      f.fired.push(e);
      o.onFire?.(e);
      return f.refuse.has(e) ? "refused" : "fired";
    },
    speech: (): DeskSpeechWatch | null => (f.speech.none ? null : { done: () => f.speech.done }),
  };
  return f;
}

function hub(desk: DeskConfig, f: Fake, t: ReturnType<typeof fakeTime>, dir = freshDir()): DeskHub {
  return new DeskHub({ store: new Store(dir), projectText: JSON.stringify(desk), now: t.now, timers: t.timers, deps: f.deps });
}

const D = (cues: DeskConfig["cues"]): DeskConfig => ({ version: 1, cues });

describe("DeskHub runs", () => {
  it("runs groups in series and steps in parallel, waits included", () => {
    const t = fakeTime();
    const f = fakeDeps();
    const h = hub(D([{ id: "a", name: "A", done: "a_done", steps: [{ kind: "look", look: "flash" }, { kind: "wait", ms: 300, start: "with", wait: 200 }, { kind: "event", event: "ev" }, { kind: "wait", ms: 100 }] }]), f, t);
    const r = h.go({}, "Ada");
    expect(r.status).toBe(200);
    expect(f.looks).toEqual(["flash"]);
    expect(f.fired).toEqual([]);
    t.advance(999);
    expect(f.fired).toEqual([]); // the flash lasts 1 s; the wait ends at 500 ms
    t.advance(1);
    expect(f.fired).toEqual(["ev"]);
    t.advance(99);
    expect(h.runs()[0]!.state).toBe("running");
    t.advance(1);
    const run = h.runs()[0]!;
    expect(run.state).toBe("done");
    expect(f.fired).toEqual(["ev", "a_done"]);
    expect(run.steps.map((s) => s.state)).toEqual(["ended", "ended", "ended", "ended"]);
    expect(run.steps[2]!.result).toBe("fired");
  });

  it("a sound waits on the router: its ack's length, an end on no-file, else DESK_ACK_MS", () => {
    const t = fakeTime();
    const f = fakeDeps();
    const h = hub(D([{ id: "s", name: "S", steps: [{ kind: "sound", sound: "hum" }, { kind: "event", event: "after" }] }]), f, t);
    h.go({ cue: "s" }, "Ada");
    expect(f.plays[0]!.p).toEqual({ sound: "hum" });
    h.ack({ seq: f.plays[0]!.seq, kind: "play", result: "played", ms: 2000 });
    t.advance(1999);
    expect(f.fired).toEqual([]);
    t.advance(1);
    expect(f.fired).toEqual(["after"]);
    expect(h.runs()[0]!.steps[0]!.result).toBe("played");

    h.go({ cue: "s" }, "Ada");
    h.ack({ seq: f.plays[1]!.seq, kind: "play", result: "no-file" });
    expect(f.fired).toEqual(["after", "after"]);
    expect(h.runs()[0]!.steps[0]!.result).toBe("no-file");

    h.go({ cue: "s" }, "Ada"); // no answer at all (an old router)
    t.advance(DESK_ACK_MS - 1);
    expect(f.fired.length).toBe(2);
    t.advance(1);
    expect(f.fired.length).toBe(3);
    expect(h.runs()[0]!.steps[0]!.result).toBe("timeout");
  });

  it("a `dur` overrides the router's length; a say carries chime and to", () => {
    const t = fakeTime();
    const f = fakeDeps();
    const h = hub(D([{ id: "p", name: "PA", steps: [{ kind: "say", text: "Testing the house speakers.", to: ["Hall"], chime: false, dur: 500 }, { kind: "stop", announce: true }] }]), f, t);
    h.go({}, "Ada");
    expect(f.plays[0]!.p).toEqual({ say: "Testing the house speakers.", to: ["Hall"], chime: false });
    h.ack({ seq: f.plays[0]!.seq, kind: "play", result: "played", ms: 9000 });
    t.advance(500);
    expect(f.stops).toEqual([true]);
    t.advance(DESK_STOP_MS);
    expect(h.runs()[0]!.state).toBe("done");
  });

  it("a speech step ends once the terminals say so (after the grace), no terminal at once, else at max", () => {
    const t = fakeTime();
    const f = fakeDeps();
    const h = hub(D([{ id: "h", name: "Heart", steps: [{ kind: "speech", room: "The Server Room", max: 10_000 }, { kind: "event", event: "quiet" }] }]), f, t);
    h.go({}, "Ada");
    f.speech.done = "said";
    h.poke(); // inside the grace: not yet
    expect(f.fired).toEqual([]);
    t.advance(DESK_SPEECH_GRACE_MS);
    expect(f.fired).toEqual(["quiet"]);
    expect(h.runs()[0]!.steps[0]!.result).toBe("said");

    f.speech.done = null;
    h.go({ cue: "h" }, "Ada");
    t.advance(5000);
    f.speech.done = "said";
    h.poke();
    expect(f.fired).toEqual(["quiet", "quiet"]);

    f.speech.done = null;
    h.go({ cue: "h" }, "Ada");
    t.advance(10_000);
    expect(h.runs()[0]!.steps[0]!.result).toBe("timeout");

    f.speech.none = true;
    h.go({ cue: "h" }, "Ada");
    expect(h.runs()[0]!.steps[0]!.result).toBe("no terminal");
    expect(f.fired.length).toBe(4);
  });

  it("stop: nothing more starts, done never fires; a new GO of a running cue stops the old run", () => {
    const t = fakeTime();
    const f = fakeDeps();
    const h = hub(D([{ id: "a", name: "A", done: "a_done", steps: [{ kind: "wait", ms: 1000 }, { kind: "event", event: "ev" }] }]), f, t);
    const r1 = h.go({}, "Ada");
    if (r1.status !== 200) throw new Error("go");
    const r2 = h.go({ cue: "a" }, "Bo");
    if (r2.status !== 200) throw new Error("go");
    const runs = h.runs();
    expect(runs.filter((r) => r.state === "running").map((r) => r.run)).toEqual([r2.run.run]);
    expect(runs.find((r) => r.run === r1.run.run)!.state).toBe("stopped");
    expect(h.stop(r2.run.run)).toBe(1);
    expect(h.stop(r2.run.run)).toBe(0);
    t.advance(5000);
    expect(f.fired).toEqual([]);
    const r3 = h.go({ cue: "a" }, "Ada");
    expect(r3.status).toBe(200);
    expect(h.stopAll(true, "Ada")).toBe(1);
    expect(f.stops).toEqual([true]);
    t.advance(5000);
    expect(f.fired).toEqual([]);
  });

  it("refused events show in the run; a look the lights lack ends the step", () => {
    const t = fakeTime();
    const f = fakeDeps();
    f.refuse.add("nah");
    const h = hub(D([{ id: "a", name: "A", steps: [{ kind: "look", look: "nope" }, { kind: "event", event: "nah", start: "with" }] }]), f, t);
    h.go({}, "Ada");
    const run = h.runs()[0]!;
    expect(run.state).toBe("done");
    expect(run.steps.map((s) => s.result)).toEqual(["no such look", "refused"]);
  });
});

describe("DeskHub playhead", () => {
  const desk = D([
    { id: "one", name: "One", steps: [] },
    { id: "two", name: "Two", steps: [] },
  ]);
  it("GO fires the playhead's cue and moves it on; a stale console gets 409 moved; the end is 409 end", () => {
    const t = fakeTime();
    const h = hub(desk, fakeDeps(), t);
    expect(h.standby()).toBe("one");
    const a = h.go({ standby: "one" }, "Ada");
    expect(a).toMatchObject({ status: 200, standby: "two" });
    expect(h.go({ standby: "one" }, "Bo")).toEqual({ status: 409, body: { error: "moved", standby: "two" } });
    expect(h.go({ standby: "two" }, "Ada")).toMatchObject({ status: 200, standby: null });
    expect(h.go({}, "Ada")).toEqual({ status: 409, body: { error: "end", standby: null } });
    expect(h.go({ cue: "zzz" }, "Ada")).toMatchObject({ status: 404 });
    expect(h.setStandby("two")).toEqual({ status: 200, standby: "two" });
    expect(h.setStandby("zzz")).toMatchObject({ status: 404 });
    expect(h.setStandby(null)).toEqual({ status: 200, standby: null });
  });

  it("every change bumps rev", () => {
    const t = fakeTime();
    const h = hub(desk, fakeDeps(), t);
    const r = h.rev;
    h.setStandby("two");
    expect(h.rev).toBeGreaterThan(r);
    expect(h.moved(r)).toBe(true);
    expect(h.moved(h.rev)).toBe(false);
  });
});

describe("DeskHub and the story", () => {
  it("a story `cue X` starts next turn as the story; a desk event's cue chain stops at DESK_CHAIN_MAX", () => {
    const t = fakeTime();
    let h!: DeskHub;
    const f = fakeDeps({ onFire: (e) => void (e === "loop_ev" && h.storyCue("loop")) });
    h = hub(D([{ id: "loop", name: "Loop", steps: [{ kind: "event", event: "loop_ev" }] }]), f, t);
    expect(h.storyCue("not_a_desk_cue")).toBe(false);
    expect(h.storyCue("loop")).toBe(true);
    expect(f.fired).toEqual([]); // the next turn
    t.advance(0);
    t.advance(0);
    expect(f.fired.length).toBe(DESK_CHAIN_MAX);
    expect(h.runs().every((r) => r.by === "the story" && r.source === "story")).toBe(true);
    expect(h.recent().some((a) => a.kind === "go" && a.result === "refused" && a.text.includes("deep"))).toBe(true);
  });
});

describe("DeskHub marks and the config chain", () => {
  it("marks persist in the state dir; reset clears; unknown keys 404", () => {
    const t = fakeTime();
    const dir = freshDir();
    const h = hub(D([]), fakeDeps(), t, dir);
    const keys = new Set(["speaker:a"]);
    expect(h.mark("speaker:a", "ok", "loud", "Ada", keys)).toEqual({ status: 200 });
    expect(h.mark("speaker:b", "ok", undefined, "Ada", keys)).toMatchObject({ status: 404 });
    expect(h.mark("speaker:a", "meh", undefined, "Ada", keys)).toMatchObject({ status: 400 });
    const again = hub(D([]), fakeDeps(), t, dir);
    expect(again.allMarks()).toEqual({ "speaker:a": { mark: "ok", by: "Ada", at: t.now(), note: "loud" } });
    again.resetMarks();
    expect(hub(D([]), fakeDeps(), t, dir).allMarks()).toEqual({});
  });

  it("director save > project > LOOM_DESK > default; a stale base is 409; Save to project drops the save", () => {
    const t = fakeTime();
    const dir = freshDir();
    const env = join(dir, "env-desk.json");
    writeFileSync(env, JSON.stringify(D([{ id: "env", name: "Env", steps: [] }])));
    const store = new Store(dir);
    const h = new DeskHub({ store, projectText: null, envFile: env, now: t.now, timers: t.timers, deps: fakeDeps().deps });
    expect(h.current().source).toBe("env");
    h.setProjectText(JSON.stringify(D([{ id: "proj", name: "P", steps: [] }])));
    expect(h.current().source).toBe("project");
    const base = h.current().version;
    const saved = h.save(D([{ id: "mine", name: "M", steps: [] }]), base, {});
    expect(saved.status).toBe(200);
    expect(h.current().source).toBe("director");
    expect(h.save(D([]), base, {})).toMatchObject({ status: 409, body: { error: "stale" } });
    expect(h.save({ version: 2 }, "", {})).toMatchObject({ status: 400 });
    // A restart keeps the director's save.
    expect(new DeskHub({ store: new Store(dir), now: t.now, timers: t.timers, deps: fakeDeps().deps }).current().source).toBe("director");
    h.savedToProject(JSON.stringify(D([{ id: "mine", name: "M", steps: [] }])));
    expect(h.current().source).toBe("project");
    expect(parseDeskText("{").desk).toBeNull();
  });

  it("the desk's event label is House desk", () => {
    expect(DESK_BY).toBe("House desk");
  });
});

describe("lookMsOf", () => {
  it("plans a look's length: a loop 0, steps + repeats + the fade", () => {
    const lights = {
      version: 1 as const,
      fixtures: [{ id: "bulb", name: "Bulb", room: "r", pos: { x: 0, y: 0, z: 0 }, kind: "zigbee" as const, device: "b", caps: { color: true, ct: true, dim: true } }],
      zones: [],
      looks: {
        flash: { to: ["bulb"], steps: [{ at: 0, set: { state: "ON" as const } }, { at: 500, set: { state: "OFF" as const, transition: 1 } }] },
        twice: { to: ["bulb"], steps: [{ at: 0, set: { state: "ON" as const } }], repeat: 2, period: 1000 },
        spin: { to: ["bulb"], set: { state: "ON" as const }, loop: true },
      },
    };
    expect(lookMsOf(lights, null, "flash")).toBe(1500);
    expect(lookMsOf(lights, null, "twice")).toBe(1000);
    expect(lookMsOf(lights, null, "spin")).toBe(0);
    expect(lookMsOf(lights, null, "none")).toBeNull();
  });
});
