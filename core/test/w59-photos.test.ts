//! The terminals' photos (wave 59p, docs/loom-w59-photos-contract.md): the book
//! on disk (the arm, the tally, the gap, the cap, the disk floor), the tar, the
//! notes, and every route on a real `EventRuntime`, a guest refused from all of them.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { EventRuntime } from "../server/event-runtime.ts";
import { PHOTO_MAX_BYTES, PHOTO_MIN_FREE_BYTES, PHOTO_MIN_GAP_MS, PhotoBook, photoFileName, photoNote, photoTimeOf, photosViewFor, spotDir, streamTar, tarHeader } from "../server/photos.ts";
import { isHostRoute, isModSurface } from "../server/routes/host.ts";
import { Store } from "../server/store.ts";
import { scenarioSource } from "../examples/load.ts";
import { PHOTO_CAP_BYTES, PHOTO_EVERY_MS, formatBytes, photoAgo, photosStopLine, photosSummary, photosViewOf } from "../src/photos.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function fresh(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-photos-"));
  dirs.push(d);
  return d;
}

function jpeg(n = 64, fill = 7): Buffer {
  const b = Buffer.alloc(n, fill);
  b[0] = 0xff;
  b[1] = 0xd8;
  return b;
}
const T0 = Date.parse("2026-10-31T21:15:03.123Z");

describe("the book", () => {
  it("names a file by the time, with no colon, and reads the time back", () => {
    expect(photoFileName(T0)).toBe("2026-10-31T21-15-03.123Z.jpg");
    expect(photoTimeOf(photoFileName(T0))).toBe(T0);
    expect(photoTimeOf("notes.txt")).toBeNull();
    expect(photoTimeOf(`${photoFileName(T0)}.tmp`)).toBeNull();
  });

  it("gives no spot a folder outside the book", () => {
    expect(spotDir("hall")).toBe("hall");
    expect(spotDir("a/b")).toBe("a%2Fb");
    expect(spotDir("..")).toBeNull();
    expect(spotDir(".")).toBeNull();
    expect(spotDir("")).toBeNull();
    expect(spotDir("x".repeat(65))).toBeNull();
  });

  it("is safe until a press, and the press survives a new book", () => {
    const dir = join(fresh(), "photos", "evt");
    const clock = { t: T0 };
    const a = new PhotoBook({ dir, now: () => clock.t });
    expect(a.armed).toBe(false);
    a.arm(true);
    expect(a.armed).toBe(true);
    expect(new PhotoBook({ dir }).armed).toBe(true);
    expect(new PhotoBook({ dir }).summary().since).toBe(T0);
    clock.t += 1000;
    a.arm(true);
    expect(new PhotoBook({ dir }).summary().since).toBe(T0);
    a.arm(false);
    expect(new PhotoBook({ dir }).armed).toBe(false);
  });

  it("refuses a still while disarmed, keeps one armed, and writes it where it says", async () => {
    const dir = fresh();
    const clock = { t: T0 };
    const b = new PhotoBook({ dir, now: () => clock.t, free: () => null });
    expect(await b.put("hall", jpeg())).toEqual({ ok: false, status: 409, error: "disarmed" });
    expect(readdirSync(dir)).toEqual([]);
    b.arm(true);
    expect(await b.put("hall", jpeg())).toEqual({ ok: true, at: T0 });
    const file = join(dir, "hall", photoFileName(T0));
    expect(readFileSync(file).equals(jpeg())).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(b.summary()).toMatchObject({ count: 1, bytes: 64 });
    expect((await b.latest("hall"))!.equals(jpeg())).toBe(true);
    expect(await b.latest("cpu")).toBeNull();
  });

  it("takes one still a spot in the gap, each spot its own, and never two from a burst", async () => {
    const clock = { t: T0 };
    const b = new PhotoBook({ dir: fresh(), now: () => clock.t, free: () => null });
    b.arm(true);
    const burst = await Promise.all([b.put("hall", jpeg()), b.put("hall", jpeg())]);
    expect(burst.map((o) => o.ok).sort()).toEqual([false, true]);
    expect(await b.put("cpu", jpeg())).toMatchObject({ ok: true });
    clock.t += PHOTO_MIN_GAP_MS - 1;
    expect(await b.put("hall", jpeg())).toEqual({ ok: false, status: 429, error: "too soon" });
    clock.t += 1;
    expect(await b.put("hall", jpeg())).toMatchObject({ ok: true });
    expect(PHOTO_MIN_GAP_MS).toBeLessThan(PHOTO_EVERY_MS);
    expect(b.summary().count).toBe(3);
  });

  it("reads its tally back off the disk, and drops a half-written still", async () => {
    const dir = fresh();
    const clock = { t: T0 };
    const a = new PhotoBook({ dir, now: () => clock.t, free: () => null });
    a.arm(true);
    await a.put("hall", jpeg(100));
    clock.t += PHOTO_MIN_GAP_MS;
    await a.put("hall", jpeg(200));
    await a.put("a/b", jpeg(50));
    writeFileSync(join(dir, "hall", "2026-10-31T21-15-13.123Z.jpg.tmp"), "half");
    const b = new PhotoBook({ dir, now: () => clock.t, free: () => null });
    const s = b.summary();
    expect(s).toMatchObject({ armed: true, count: 3, bytes: 350 });
    expect(s.spots.get("hall")!.lastAt).toBe(clock.t);
    expect(s.spots.get("a/b")!.count).toBe(1);
    expect(existsSync(join(dir, "hall", "2026-10-31T21-15-13.123Z.jpg.tmp"))).toBe(false);
    expect((await b.latest("hall"))!.length).toBe(200);
    // The gap survives too: a restart can't double a shot.
    expect(await b.put("hall", jpeg())).toMatchObject({ status: 429 });
  });

  it("stops at the cap and says so, and a delete lets it carry on, still armed", async () => {
    const clock = { t: T0 };
    const dir = fresh();
    const b = new PhotoBook({ dir, now: () => clock.t, free: () => null, capBytes: 100 });
    b.arm(true);
    expect(await b.put("hall", jpeg(60))).toMatchObject({ ok: true });
    expect(b.stopped()).toBeNull();
    expect(await b.put("cpu", jpeg(60))).toMatchObject({ ok: true });
    expect(b.stopped()).toBe("cap");
    expect(await b.put("ram", jpeg(1))).toEqual({ ok: false, status: 507, error: "the cap is reached" });
    expect(b.summary().count).toBe(2);
    expect(b.deleteAll()).toBe(2);
    expect(readdirSync(dir)).toEqual(["arm.json"]);
    expect(b.armed).toBe(true);
    expect(b.stopped()).toBeNull();
    expect(b.summary()).toMatchObject({ count: 0, bytes: 0 });
    clock.t += PHOTO_MIN_GAP_MS;
    expect(await b.put("hall", jpeg(10))).toMatchObject({ ok: true });
  });

  it("never lets the disk fill, whatever the cap says, and looks once a minute", async () => {
    const clock = { t: T0 };
    let free: number | null = PHOTO_MIN_FREE_BYTES;
    let looks = 0;
    const b = new PhotoBook({ dir: fresh(), now: () => clock.t, free: () => (looks++, free) });
    b.arm(true);
    expect(await b.put("hall", jpeg())).toMatchObject({ ok: true });
    free = PHOTO_MIN_FREE_BYTES - 1;
    b.stopped();
    expect(looks).toBe(1);
    clock.t += 60_000;
    expect(await b.put("hall", jpeg())).toEqual({ ok: false, status: 507, error: "the disk is nearly full" });
    expect(b.stopped()).toBe("disk");
    expect(looks).toBe(2);
    free = null;
    clock.t += 60_000;
    expect(b.stopped()).toBeNull();
  });

  it("answers the disk's own refusal, with nothing left behind and nothing thrown", async () => {
    const dir = fresh();
    writeFileSync(join(dir, "hall"), "in the way");
    const b = new PhotoBook({ dir, now: () => T0, free: () => null });
    b.arm(true);
    expect(await b.put("hall", jpeg())).toEqual({ ok: false, status: 507, error: "the disk refused it" });
    expect(b.summary().spots.get("hall")).toMatchObject({ count: 0, lastAt: null });
  });
});

describe("the tar", () => {
  it("writes a header tar reads, and system tar unpacks the whole set", async () => {
    expect(tarHeader("a/b.jpg", 10, 1).length).toBe(512);
    const clock = { t: T0 };
    const dir = fresh();
    const b = new PhotoBook({ dir, now: () => clock.t, free: () => null });
    b.arm(true);
    await b.put("hall", jpeg(700, 1));
    clock.t += PHOTO_MIN_GAP_MS;
    await b.put("hall", jpeg(512, 2));
    await b.put("a/b", jpeg(1, 3));
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on("data", (c: Buffer) => chunks.push(c));
    const sent = await streamTar(out as never, b.files());
    expect(sent).toBe(3);
    const where = fresh();
    writeFileSync(join(where, "x.tar"), Buffer.concat(chunks));
    execFileSync("tar", ["xf", "x.tar"], { cwd: where });
    expect(readdirSync(join(where, "hall")).sort()).toEqual([photoFileName(T0), photoFileName(clock.t)].sort());
    expect(readFileSync(join(where, "hall", photoFileName(T0))).equals(jpeg(700, 1))).toBe(true);
    expect(readFileSync(join(where, "hall", photoFileName(clock.t))).equals(jpeg(512, 2))).toBe(true);
    expect(readdirSync(join(where, "a%2Fb")).length).toBe(1);
  });

  it("waits for a slow reader, and stops when it goes", async () => {
    const dir = fresh();
    mkdirSync(join(dir, "hall"));
    const files = [0, 1, 2].map((i) => {
      const name = photoFileName(T0 + i * 15_000);
      writeFileSync(join(dir, "hall", name), jpeg(600));
      return { name: `hall/${name}`, path: join(dir, "hall", name) };
    });
    const events = new Map<string, Set<() => void>>();
    let wrote = 0;
    const sink = {
      destroyed: false,
      write: () => {
        wrote++;
        return false;
      },
      once: (e: string, fn: () => void) => void (events.get(e) ?? events.set(e, new Set()).get(e)!).add(fn),
      off: (e: string, fn: () => void) => void events.get(e)?.delete(fn),
    };
    const fire = (e: string) => [...(events.get(e) ?? [])].forEach((fn) => fn());
    const run = streamTar(sink as never, files);
    await new Promise((r) => setTimeout(r, 20));
    expect(wrote).toBe(1);
    fire("drain");
    await new Promise((r) => setTimeout(r, 20));
    expect(wrote).toBe(2);
    sink.destroyed = true;
    fire("close");
    await new Promise((r) => setTimeout(r, 20));
    fire("close");
    expect(await run).toBeLessThan(3);
  });

  it("leaves out a file deleted since the listing", async () => {
    const dir = fresh();
    writeFileSync(join(dir, photoFileName(T0)), jpeg());
    const out = new PassThrough();
    out.resume();
    expect(await streamTar(out as never, [{ name: `hall/${photoFileName(T0)}`, path: join(dir, photoFileName(T0)) }, { name: "hall/x", path: join(dir, "gone") }])).toBe(1);
  });
});

describe("the notes", () => {
  const base = { armed: true, since: 0, lastAt: 90_000, now: 100_000, silentMs: 20_000 };
  const poll = (o: object) => ({ spot: "hall", at: 99_000, ...o });
  it("says nothing while safe, or just after arming, or while it shoots", () => {
    expect(photoNote({ ...base, armed: false, poll: undefined })).toBeNull();
    expect(photoNote({ ...base, since: 90_000, poll: undefined })).toBeNull();
    expect(photoNote({ ...base, poll: poll({ photo: "ok" }) })).toBeNull();
  });
  it("names why a terminal isn't shooting", () => {
    expect(photoNote({ ...base, poll: undefined })).toContain("Not heard");
    expect(photoNote({ ...base, poll: poll({ at: 1000, photo: "ok" }) })).toContain("Not heard");
    expect(photoNote({ ...base, poll: poll({ visible: false, photo: "ok" }) })).toContain("hidden");
    expect(photoNote({ ...base, poll: poll({ photo: "hidden" }) })).toContain("hidden");
    expect(photoNote({ ...base, poll: poll({ photo: "camera" }) })).toContain("No camera");
    expect(photoNote({ ...base, poll: poll({ photo: "picture" }) })).toContain("no picture");
    expect(photoNote({ ...base, poll: poll({ photo: "upload" }) })).toContain("getting through");
    expect(photoNote({ ...base, poll: poll({}) })).toContain("reload");
    expect(photoNote({ ...base, lastAt: 1000, poll: poll({ photo: "ok" }) })).toContain("no recent");
  });
  it("keeps a spot that left the map, with no note", async () => {
    const clock = { t: T0 };
    const b = new PhotoBook({ dir: fresh(), now: () => clock.t, free: () => null });
    b.arm(true);
    await b.put("gone", jpeg());
    clock.t += 60_000;
    const v = photosViewFor(b, [{ id: "hall", name: "Hall" }], [], clock.t, 20_000);
    expect(v.terminals.map((t) => [t.spot, t.count, t.note === null])).toEqual([["hall", 0, false], ["gone", 1, true]]);
    expect(v.capBytes).toBe(PHOTO_CAP_BYTES);
  });
});

describe("the words", () => {
  it("reads a view off the wire, and nothing else", () => {
    expect(photosViewOf({ error: "not found" })).toBeNull();
    expect(photosViewOf(null)).toBeNull();
    expect(photosViewOf({ armed: true, now: 5, terminals: [{ spot: "hall" }, 7], stopped: "cap" })).toMatchObject({ armed: true, stopped: "cap", terminals: [{ spot: "hall", name: "hall", count: 0, lastAt: null, note: null }] });
  });
  it("says it plainly", () => {
    expect(formatBytes(2 * 1024 ** 3)).toBe("2.0 GB");
    expect(formatBytes(340 * 1024 ** 2)).toBe("340 MB");
    expect(photoAgo(100_000, 88_000)).toBe("12 s ago");
    expect(photoAgo(1000, null)).toBe("never");
    expect(photosSummary({ count: 1, bytes: 1024, capBytes: 3 * 1024 ** 3 })).toBe("1 photo · 1 KB of 3.0 GB");
    expect(photosStopLine({ stopped: null, capBytes: 1 })).toBeNull();
    expect(photosStopLine({ stopped: "cap", capBytes: PHOTO_CAP_BYTES })).toContain("3.0 GB");
    expect(photosStopLine({ stopped: "disk", capBytes: 1 })).toContain("disk");
  });
});

// ---------------------------------------------------------------------------

const SCENARIO = scenarioSource("trapped-in-the-internet");
const CODES = { event: "EVTPHO", prime: "PRMPHO", mod: "MODPHO" };

function runtime(clock: { t: number }, dir: string = fresh()): EventRuntime {
  return new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: "trapped-in-the-internet", scenarioSource: SCENARIO, joinBase: () => "http://localhost", now: () => clock.t });
}

function fakeReq(body: unknown, headers: Record<string, string>): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers,
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
    destroy() {},
  } as unknown as IncomingMessage;
}

type Auth = { moderator?: boolean; token?: string };
async function call(rt: EventRuntime, method: "GET" | "POST", path: string, body: unknown = {}, auth: Auth = {}) {
  let status = 0;
  let head: Record<string, string> = {};
  const parts: Buffer[] = [];
  const res = {
    destroyed: false,
    setHeader() {},
    writeHead(s: number, h?: Record<string, string>) {
      status = s;
      head = h ?? {};
      return res;
    },
    write(b: Buffer) {
      parts.push(b);
      return true;
    },
    once() {},
    off() {},
    end(b?: string | Buffer) {
      if (b !== undefined) parts.push(Buffer.isBuffer(b) ? b : Buffer.from(b));
      return res;
    },
  } as unknown as ServerResponse;
  const url = new URL(`http://x${path}`);
  const headers: Record<string, string> = auth.token !== undefined ? { "x-loom-token": auth.token } : {};
  const handled = await rt.handle(fakeReq(body, headers), res, method, url.pathname, url, auth.moderator === true ? { moderator: true, moderatorName: "Ada" } : {});
  const raw = Buffer.concat(parts);
  return { handled, status, head, raw, json: (head["content-type"] ?? "application/json").includes("json") && raw.length > 0 ? (JSON.parse(raw.toString("utf8")) as Record<string, unknown>) : {} };
}

const still = (spot: string, b = jpeg()) => ({ spot, jpeg: b.toString("base64"), w: 640, h: 480 });

async function tokens(rt: EventRuntime) {
  const mod = (await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod })).json.token as string;
  rt.openDoors();
  const host = (await call(rt, "POST", "/api/prime/login", { character: "Task Manager", passcode: CODES.prime })).json.token as string;
  const booth = (await call(rt, "POST", "/api/prime/login", { character: "Clippy", passcode: CODES.prime })).json.token as string;
  const guest = (await call(rt, "POST", "/api/guest/register", { name: "Winamp", passcode: CODES.event })).json.token as string;
  return { mod, host, booth, guest };
}

const screen = async (rt: EventRuntime, token: string, spot: string, view = "auto") => (await call(rt, "GET", `/api/screen/state?name=T&spot=${spot}&view=${view}&character=Trabolta`, {}, { token })).json;

describe("the routes", () => {
  it("arms by a press, tells only the terminals that may shoot, and stops at the disarm", async () => {
    const clock = { t: T0 };
    const rt = runtime(clock);
    const t = await tokens(rt);
    expect("photos" in (await screen(rt, t.mod, "hall"))).toBe(false);
    expect((await call(rt, "POST", "/api/mod/photos/shot", still("hall"), { token: t.mod })).status).toBe(409);
    const armed = await call(rt, "POST", "/api/mod/photos/arm", { armed: true }, { token: t.host });
    expect(armed.status).toBe(200);
    expect(armed.json).toMatchObject({ armed: true, count: 0 });
    expect((await screen(rt, t.mod, "hall")).photos).toBe(true);
    expect((await screen(rt, t.mod, "server-room")).photos).toBe(true);
    for (const spot of ["tent", "desktop-tv", "nowhere", ""]) expect("photos" in (await screen(rt, t.mod, spot))).toBe(false);
    expect((await call(rt, "POST", "/api/mod/photos/shot", still("hall"), { token: t.mod })).json).toEqual({ ok: true, at: T0 });
    await call(rt, "POST", "/api/mod/photos/arm", { armed: false }, { moderator: true });
    expect("photos" in (await screen(rt, t.mod, "hall"))).toBe(false);
    clock.t += PHOTO_EVERY_MS;
    expect((await call(rt, "POST", "/api/mod/photos/shot", still("hall"), { token: t.mod })).status).toBe(409);
    expect((await call(rt, "POST", "/api/mod/photos/arm", { armed: "yes" }, { token: t.host })).status).toBe(400);
  });

  it("takes no still from the tent, the TV or a spot off the map", async () => {
    const clock = { t: T0 };
    const rt = runtime(clock);
    const t = await tokens(rt);
    await call(rt, "POST", "/api/mod/photos/arm", { armed: true }, { token: t.mod });
    for (const spot of ["tent", "desktop-tv", "nowhere", "../../etc"]) expect((await call(rt, "POST", "/api/mod/photos/shot", still(spot), { token: t.mod })).status).toBe(404);
    const v = (await call(rt, "GET", "/api/mod/photos", {}, { token: t.mod })).json as { terminals: Array<{ spot: string }>; count: number };
    expect(v.count).toBe(0);
    expect(v.terminals.map((r) => r.spot)).not.toContain("tent");
    expect(v.terminals.map((r) => r.spot)).not.toContain("desktop-tv");
    expect(v.terminals.map((r) => r.spot)).toContain("server-room");
  });

  it("refuses a body that isn't a still, and one too big", async () => {
    const clock = { t: T0 };
    const rt = runtime(clock);
    const t = await tokens(rt);
    await call(rt, "POST", "/api/mod/photos/arm", { armed: true }, { token: t.mod });
    expect((await call(rt, "POST", "/api/mod/photos/shot", { spot: "hall" }, { token: t.mod })).status).toBe(400);
    expect((await call(rt, "POST", "/api/mod/photos/shot", still("hall", Buffer.from("not a jpeg")), { token: t.mod })).status).toBe(400);
    expect((await call(rt, "POST", "/api/mod/photos/shot", still("hall", jpeg(PHOTO_MAX_BYTES + 1)), { token: t.mod })).status).toBe(413);
    expect((await call(rt, "POST", "/api/mod/photos/shot", still("hall", jpeg(PHOTO_MAX_BYTES)), { token: t.mod })).status).toBe(200);
  });

  it("counts per terminal, with its last shot and its thumbnail", async () => {
    const clock = { t: T0 };
    const rt = runtime(clock);
    const t = await tokens(rt);
    await call(rt, "POST", "/api/mod/photos/arm", { armed: true }, { token: t.host });
    await call(rt, "POST", "/api/mod/photos/shot", still("hall", jpeg(100, 1)), { token: t.mod });
    clock.t += PHOTO_EVERY_MS;
    await call(rt, "POST", "/api/mod/photos/shot", still("hall", jpeg(100, 2)), { token: t.mod });
    const v = (await call(rt, "GET", "/api/mod/photos", {}, { token: t.host })).json as { count: number; terminals: Array<{ spot: string; name: string; count: number; lastAt: number | null }> };
    expect(v.count).toBe(2);
    expect(v.terminals.find((r) => r.spot === "hall")).toMatchObject({ name: "Hall", count: 2, lastAt: clock.t });
    const thumb = await call(rt, "GET", "/api/mod/photos/thumb?spot=hall", {}, { token: t.host });
    expect(thumb.head["content-type"]).toBe("image/jpeg");
    expect(thumb.raw.equals(jpeg(100, 2))).toBe(true);
    expect((await call(rt, "GET", "/api/mod/photos/thumb?spot=cpu", {}, { token: t.host })).status).toBe(404);
    expect((await call(rt, "GET", "/api/mod/photos/thumb?spot=..%2F..%2Farm.json", {}, { token: t.host })).status).toBe(404);
  });

  it("carries a note from the heartbeat", async () => {
    const clock = { t: T0 };
    const rt = runtime(clock);
    const t = await tokens(rt);
    await call(rt, "POST", "/api/mod/photos/arm", { armed: true }, { token: t.mod });
    clock.t += 30_000;
    await call(rt, "GET", "/api/screen/state?name=Hall&spot=hall&view=auto&character=Trabolta&ph=camera&vis=v", {}, { token: t.mod });
    await call(rt, "GET", "/api/screen/state?name=CPU&spot=cpu&view=auto&character=Trabolta&ph=hidden&vis=h", {}, { token: t.mod });
    await call(rt, "GET", "/api/screen/state?name=RAM&spot=ram&view=auto&character=Trabolta&ph=nonsense&vis=v", {}, { token: t.mod });
    const v = (await call(rt, "GET", "/api/mod/photos", {}, { token: t.mod })).json as { terminals: Array<{ spot: string; note: string | null }> };
    const note = (spot: string) => v.terminals.find((r) => r.spot === spot)!.note;
    expect(note("hall")).toContain("No camera");
    expect(note("cpu")).toContain("hidden");
    expect(note("ram")).toContain("reload");
    expect(note("start-bar")).toContain("Not heard");
  });

  it("gives a director the tar and Delete all, and never a host", async () => {
    const clock = { t: T0 };
    const rt = runtime(clock);
    const t = await tokens(rt);
    await call(rt, "POST", "/api/mod/photos/arm", { armed: true }, { token: t.mod });
    await call(rt, "POST", "/api/mod/photos/shot", still("hall", jpeg(700)), { token: t.mod });
    const tar = await call(rt, "GET", "/api/mod/photos/download", {}, { token: t.mod });
    expect(tar.head["content-type"]).toBe("application/x-tar");
    expect(tar.head["content-disposition"]).toContain("photos-2026-10-31.tar");
    expect(tar.raw.length).toBe(512 + 1024 + 1024);
    expect((await call(rt, "GET", "/api/mod/photos/download", {}, { moderator: true })).status).toBe(200);
    expect((await call(rt, "GET", "/api/mod/photos/download", {}, { token: t.host })).status).toBe(403);
    expect((await call(rt, "POST", "/api/mod/photos/delete", { confirm: "delete" }, { token: t.host })).status).toBe(403);
    expect((await call(rt, "POST", "/api/mod/photos/delete", {}, { token: t.mod })).status).toBe(400);
    const gone = await call(rt, "POST", "/api/mod/photos/delete", { confirm: "delete" }, { token: t.mod });
    expect(gone.json).toMatchObject({ deleted: 1, view: { count: 0, armed: true } });
  });

  it("refuses a guest, a booth and nobody from every photo route", async () => {
    const clock = { t: T0 };
    const rt = runtime(clock);
    const t = await tokens(rt);
    await call(rt, "POST", "/api/mod/photos/arm", { armed: true }, { token: t.mod });
    await call(rt, "POST", "/api/mod/photos/shot", still("hall"), { token: t.mod });
    const routes: Array<["GET" | "POST", string, unknown]> = [
      ["GET", "/api/mod/photos", {}],
      ["GET", "/api/mod/photos/thumb?spot=hall", {}],
      ["GET", "/api/mod/photos/download", {}],
      ["POST", "/api/mod/photos/arm", { armed: false }],
      ["POST", "/api/mod/photos/shot", still("cpu")],
      ["POST", "/api/mod/photos/delete", { confirm: "delete" }],
    ];
    for (const who of [{ token: t.guest }, { token: t.booth }, {}, { token: "nonsense" }]) {
      for (const [method, path, body] of routes) {
        const out = await call(rt, method, path, body, who);
        expect([method, path, out.status]).toEqual([method, path, 403]);
        expect(out.raw.toString("utf8")).not.toContain("hall");
      }
    }
    // A body token is no way in for the still, and nothing moved.
    expect((await call(rt, "POST", "/api/mod/photos/shot", { ...still("cpu"), token: t.mod })).status).toBe(403);
    const v = (await call(rt, "GET", "/api/mod/photos", {}, { token: t.mod })).json;
    expect(v).toMatchObject({ armed: true, count: 1 });
  });

  it("keeps a host to the panel, the thumbnail and the arm (the allowlist)", () => {
    const ctx = { alertsPath: "Night.alerts", isAgent: () => false };
    expect(isHostRoute("GET", "/api/mod/photos", {}, ctx)).toBe(true);
    expect(isHostRoute("GET", "/api/mod/photos/thumb", {}, ctx)).toBe(true);
    expect(isHostRoute("POST", "/api/mod/photos/arm", {}, ctx)).toBe(true);
    expect(isHostRoute("POST", "/api/mod/photos/shot", {}, ctx)).toBe(false);
    expect(isHostRoute("POST", "/api/mod/photos/delete", {}, ctx)).toBe(false);
    expect(isHostRoute("GET", "/api/mod/photos/download", {}, ctx)).toBe(false);
    expect(isModSurface("GET", "/api/mod/photos/download", {})).toBe(true);
  });

  it("survives a restart and a story reload, armed, with its count", async () => {
    const clock = { t: T0 };
    const dir = fresh();
    const rt = runtime(clock, dir);
    const t = await tokens(rt);
    await call(rt, "POST", "/api/mod/photos/arm", { armed: true }, { token: t.mod });
    await call(rt, "POST", "/api/mod/photos/shot", still("hall"), { token: t.mod });
    expect((await call(rt, "POST", "/api/mod/reset", {}, { moderator: true })).status).toBe(200);
    expect((await call(rt, "GET", "/api/mod/photos", {}, { token: t.mod })).json).toMatchObject({ armed: true, count: 1 });
    rt.dispose();
    const next = runtime(clock, dir);
    next.restore();
    const mod = (await call(next, "POST", "/api/mod/login", { passcode: CODES.mod })).json.token as string;
    expect((await call(next, "GET", "/api/mod/photos", {}, { token: mod })).json).toMatchObject({ armed: true, count: 1 });
    expect((await screen(next, mod, "hall")).photos).toBe(true);
    next.dispose();
  });

  it("puts nothing in the journal or the screen state but the arm", async () => {
    const clock = { t: T0 };
    const dir = fresh();
    const rt = runtime(clock, dir);
    const t = await tokens(rt);
    await call(rt, "POST", "/api/mod/photos/arm", { armed: true }, { token: t.mod });
    await call(rt, "POST", "/api/mod/photos/shot", still("hall", jpeg(64, 9)), { token: t.mod });
    const journal = readFileSync(join(dir, "journal.ndjson"), "utf8");
    expect(journal).not.toContain("photo");
    expect(JSON.stringify(await screen(rt, t.mod, "hall"))).not.toContain(jpeg(64, 9).toString("base64"));
    rt.dispose();
  });
});
