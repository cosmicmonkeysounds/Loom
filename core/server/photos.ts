//! The terminals' photos on disk (wave 59p, `docs/loom-w59-photos-contract.md`).
//!
//! `<state dir>/photos/<event>/<spot>/<ISO time>.jpg`, plus `arm.json` beside
//! them, so the arm survives a restart and a story reload and only a press
//! changes it. **These are pictures of people.** Not in the journal, not in
//! memory (the latest thumbnail is read off the disk too), not under `/media/`,
//! and never in a log with a path. `deploy/backup.sh` leaves the folder out of
//! every backup: 48 copies a night of them would fill the disk this cap guards.
//!
//! Colons in the time are dashes (`2026-10-31T21-15-03.123Z.jpg`), so a tar
//! unpacks on Windows too. The time is the server's, on receipt.
//!
//! `PHOTO_CAP_BYTES` stops one event; the free-space floor stops all of them,
//! so no number of events can fill the disk. Transport-free apart from
//! `streamTar`; a clock and the free space are injected.

import { existsSync, mkdirSync, readdirSync, renameSync, readFileSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { PHOTO_CAP_BYTES, type PhotoReport, type PhotoTerminal, type PhotosStop, type PhotosView } from "../src/photos.ts";

/** The largest decoded still (640 × 480 at 0.7 is 40–120 KB). */
export const PHOTO_MAX_BYTES = 400 * 1024;
/** The upload's JSON body cap: base64 of that, plus the envelope. */
export const PHOTO_BODY_LIMIT = Math.ceil((PHOTO_MAX_BYTES * 4) / 3) + 1024;
/** Two stills from one spot closer than this: the second is refused 429. */
export const PHOTO_MIN_GAP_MS = 10_000;
/** The disk keeps at least this free, whatever the cap says. */
export const PHOTO_MIN_FREE_BYTES = 2 * 1024 ** 3;
/** How often the free space is looked at. */
const DISK_LOOK_MS = 60_000;
/** A spot's folder name is at most this long, so a tar name always fits. */
const SPOT_DIR_MAX = 64;
const ARM_FILE = "arm.json";

/** A map terminal that takes stills. */
export interface PhotoSpot {
  id: string;
  name: string;
}

/** The heartbeat, as much of it as a note reads. */
export interface PhotoPoll {
  spot: string;
  at: number;
  visible?: boolean;
  photo?: PhotoReport;
}

interface SpotTally {
  count: number;
  bytes: number;
  lastAt: number | null;
  lastFile: string | null;
}

export type PhotoPut = { ok: true; at: number } | { ok: false; status: 404 | 409 | 429 | 507; error: string };

/** One file for the tar. */
export interface PhotoFile {
  /** `<spot>/<ISO time>.jpg`. */
  name: string;
  path: string;
}

/** A spot's folder: no slash can survive, and neither can a bare `..`. Null: no folder for this id. */
export function spotDir(spot: string): string | null {
  const dir = encodeURIComponent(spot);
  return dir === "" || /^\.+$/u.test(dir) || dir.length > SPOT_DIR_MAX ? null : dir;
}

/** The spot a folder holds. */
function spotOfDir(dir: string): string {
  try {
    return decodeURIComponent(dir);
  } catch {
    return dir;
  }
}

/** A still's file name. */
export function photoFileName(at: number): string {
  return `${new Date(at).toISOString().replace(/:/gu, "-")}.jpg`;
}

/** The time back off a file name; null for anything else. */
export function photoTimeOf(name: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2}\.\d{3}Z)\.jpg$/u.exec(name);
  if (m === null) return null;
  const at = Date.parse(`${m[1]}:${m[2]}:${m[3]}`);
  return Number.isFinite(at) ? at : null;
}

/** The free bytes on the disk that holds `dir`; null: can't tell. */
function diskFree(dir: string): number | null {
  try {
    const s = statfsSync(existsSync(dir) ? dir : dirname(dirname(dir)));
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

/** The arm and the event's stills, on disk. */
export class PhotoBook {
  private readonly dir: string;
  private readonly now: () => number;
  private readonly free: () => number | null;
  private readonly capBytes: number;
  private armState: { armed: boolean; since: number | null };
  private tally: Map<string, SpotTally> | null = null;
  /** Bytes being written now, which already count against the cap. */
  private writing = 0;
  private lookedAt = -Infinity;
  private lastFree: number | null = null;

  constructor(o: { dir: string; now?: () => number; free?: () => number | null; capBytes?: number }) {
    this.dir = o.dir;
    this.now = o.now ?? Date.now;
    this.free = o.free ?? (() => diskFree(o.dir));
    this.capBytes = o.capBytes ?? PHOTO_CAP_BYTES;
    this.armState = this.loadArm();
  }

  private loadArm(): { armed: boolean; since: number | null } {
    try {
      const raw = JSON.parse(readFileSync(join(this.dir, ARM_FILE), "utf8")) as Record<string, unknown>;
      return { armed: raw["armed"] === true, since: typeof raw["since"] === "number" ? raw["since"] : null };
    } catch {
      return { armed: false, since: null };
    }
  }

  get armed(): boolean {
    return this.armState.armed;
  }

  /** A press. Written first, so a press the server took survives a crash. */
  arm(armed: boolean): void {
    if (armed === this.armState.armed) return;
    this.armState = { armed, since: this.now() };
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const tmp = join(this.dir, `${ARM_FILE}.tmp`);
      writeFileSync(tmp, JSON.stringify(this.armState), { mode: 0o600 });
      renameSync(tmp, join(this.dir, ARM_FILE));
    } catch (e) {
      // Armed in memory is what was asked; a restart forgets it, and says so here.
      process.stderr.write(`  📷 the photos' arm could not be saved: ${(e as Error).message}\n`);
    }
  }

  /** The tally, read off the disk the first time it's asked for. A half-written still from a crash goes. */
  private tallies(): Map<string, SpotTally> {
    if (this.tally !== null) return this.tally;
    const tally = new Map<string, SpotTally>();
    for (const dir of this.spotFolders()) {
      const row: SpotTally = { count: 0, bytes: 0, lastAt: null, lastFile: null };
      for (const file of readdirSync(join(this.dir, dir))) {
        const path = join(this.dir, dir, file);
        const at = photoTimeOf(file);
        if (at === null) {
          if (file.endsWith(".tmp")) rmSync(path, { force: true });
          continue;
        }
        row.count++;
        row.bytes += statSync(path).size;
        if (row.lastAt === null || at > row.lastAt) {
          row.lastAt = at;
          row.lastFile = file;
        }
      }
      tally.set(spotOfDir(dir), row);
    }
    this.tally = tally;
    return tally;
  }

  private spotFolders(): string[] {
    try {
      return readdirSync(this.dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
    } catch {
      return [];
    }
  }

  private usedBytes(): number {
    let total = this.writing;
    for (const row of this.tallies().values()) total += row.bytes;
    return total;
  }

  /** Why nothing is being kept now, or null. */
  stopped(): PhotosStop | null {
    if (this.usedBytes() >= this.capBytes) return "cap";
    const now = this.now();
    if (now - this.lookedAt >= DISK_LOOK_MS) {
      this.lookedAt = now;
      this.lastFree = this.free();
    }
    return this.lastFree !== null && this.lastFree < PHOTO_MIN_FREE_BYTES ? "disk" : null;
  }

  /** Keep one still. */
  async put(spot: string, jpeg: Buffer): Promise<PhotoPut> {
    if (!this.armed) return { ok: false, status: 409, error: "disarmed" };
    const dir = spotDir(spot);
    if (dir === null) return { ok: false, status: 404, error: "no such spot" };
    const tally = this.tallies();
    const at = this.now();
    let row = tally.get(spot);
    if (row?.lastAt !== null && row?.lastAt !== undefined && at - row.lastAt >= 0 && at - row.lastAt < PHOTO_MIN_GAP_MS) return { ok: false, status: 429, error: "too soon" };
    const stop = this.stopped();
    if (stop !== null) return { ok: false, status: 507, error: stop === "cap" ? "the cap is reached" : "the disk is nearly full" };
    if (row === undefined) tally.set(spot, (row = { count: 0, bytes: 0, lastAt: null, lastFile: null }));
    const before = row.lastAt;
    // Claimed before the write, so a burst can't land two.
    row.lastAt = at;
    const file = photoFileName(at);
    const folder = join(this.dir, dir);
    const tmp = join(folder, `${file}.tmp`);
    this.writing += jpeg.length;
    try {
      await mkdir(folder, { recursive: true, mode: 0o700 });
      await writeFile(tmp, jpeg, { mode: 0o600 });
      await rename(tmp, join(folder, file));
      row.count++;
      row.bytes += jpeg.length;
      row.lastFile = file;
      return { ok: true, at };
    } catch {
      row.lastAt = before;
      await rm(tmp, { force: true }).catch(() => {});
      return { ok: false, status: 507, error: "the disk refused it" };
    } finally {
      this.writing -= jpeg.length;
    }
  }

  /** The latest still of a spot, off the disk; null: none. */
  async latest(spot: string): Promise<Buffer | null> {
    const row = this.tallies().get(spot);
    const dir = spotDir(spot);
    if (row?.lastFile === null || row?.lastFile === undefined || dir === null) return null;
    return readFile(join(this.dir, dir, row.lastFile)).catch(() => null);
  }

  /** Every still as it stands on the disk now, oldest first in each spot. */
  files(): PhotoFile[] {
    const out: PhotoFile[] = [];
    for (const dir of this.spotFolders()) {
      for (const file of readdirSync(join(this.dir, dir)).sort()) {
        if (photoTimeOf(file) !== null) out.push({ name: `${dir}/${file}`, path: join(this.dir, dir, file) });
      }
    }
    return out;
  }

  /** Delete every still; the arm stays as it is. Answers how many went. */
  deleteAll(): number {
    let count = 0;
    for (const row of this.tallies().values()) count += row.count;
    for (const dir of this.spotFolders()) rmSync(join(this.dir, dir), { recursive: true, force: true });
    this.tally = new Map();
    return count;
  }

  summary(): { armed: boolean; since: number | null; count: number; bytes: number; capBytes: number; stopped: PhotosStop | null; spots: ReadonlyMap<string, Readonly<SpotTally>> } {
    const spots = this.tallies();
    let count = 0;
    let bytes = 0;
    for (const row of spots.values()) {
      count += row.count;
      bytes += row.bytes;
    }
    return { ...this.armState, count, bytes, capBytes: this.capBytes, stopped: this.stopped(), spots };
  }
}

/** A quiet spell this long after arming owes no note: the first shot takes a poll and a beat. */
export const PHOTO_NOTE_GRACE_MS = 20_000;
/** A terminal reporting fine with no still for this long is one that isn't shooting. */
export const PHOTO_LATE_MS = 45_000;

/**
 * Why a terminal that should be shooting isn't, for the panel; null: fine, or
 * too early to say. Pure. `silentMs`: the heartbeat's own threshold.
 *
 * Words: DRAFT w59p.
 */
export function photoNote(o: { armed: boolean; since: number | null; lastAt: number | null; poll: PhotoPoll | undefined; now: number; silentMs: number }): string | null {
  if (!o.armed || (o.since !== null && o.now - o.since < PHOTO_NOTE_GRACE_MS)) return null;
  const p = o.poll;
  if (p === undefined || o.now - p.at > o.silentMs) return "Not heard from: is it on?";
  if (p.visible === false || p.photo === "hidden") return "Its page is hidden: the screen is off, or another app is up.";
  switch (p.photo) {
    case "camera":
      return "No camera: it's off in ⚙, refused, or missing.";
    case "picture":
      return "Camera on, but no picture yet.";
    case "upload":
      return "Its photos aren't getting through.";
    case "ok":
      return o.lastAt === null || o.now - o.lastAt > PHOTO_LATE_MS ? "Reports fine, but no recent photo." : null;
    default:
      return "Not reporting: reload it (an old build).";
  }
}

/** The panel's view. Pure. Spots that left the map keep their count. */
export function photosViewFor(book: Pick<PhotoBook, "summary">, spots: readonly PhotoSpot[], polls: readonly PhotoPoll[], now: number, silentMs: number): PhotosView {
  const s = book.summary();
  const terminals: PhotoTerminal[] = [];
  const row = (spot: string, name: string): PhotoTerminal => {
    const t = s.spots.get(spot);
    const lastAt = t?.lastAt ?? null;
    return { spot, name, count: t?.count ?? 0, bytes: t?.bytes ?? 0, lastAt, note: photoNote({ armed: s.armed, since: s.since, lastAt, poll: polls.find((p) => p.spot === spot), now, silentMs }) };
  };
  for (const t of spots) terminals.push(row(t.id, t.name));
  const known = new Set(spots.map((t) => t.id));
  for (const spot of s.spots.keys()) if (!known.has(spot)) terminals.push({ ...row(spot, spot), note: null });
  return { armed: s.armed, since: s.since, now, count: s.count, bytes: s.bytes, capBytes: s.capBytes, stopped: s.stopped, terminals };
}

// --- the tar -----------------------------------------------------------------

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width, "0");
}

/** One file's ustar header. */
export function tarHeader(name: string, size: number, mtimeS: number): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8");
  h.write(`${octal(0o600, 7)}\0`, 100, "ascii");
  h.write(`${octal(0, 7)}\0`, 108, "ascii");
  h.write(`${octal(0, 7)}\0`, 116, "ascii");
  h.write(`${octal(size, 11)}\0`, 124, "ascii");
  h.write(`${octal(mtimeS, 11)}\0`, 136, "ascii");
  h.write("        ", 148, "ascii");
  h.write("0", 156, "ascii");
  h.write("ustar\0" + "00", 257, "ascii");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${octal(sum, 6)}\0 `, 148, "ascii");
  return h;
}

/** What `streamTar` writes to: a `ServerResponse`, in practice. */
export interface TarSink {
  write(chunk: Buffer): boolean;
  once(event: "drain" | "close", fn: () => void): unknown;
  off(event: "drain" | "close", fn: () => void): unknown;
  readonly destroyed: boolean;
}

function drained(out: TarSink): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      out.off("drain", done);
      out.off("close", done);
      resolve();
    };
    out.once("drain", done);
    out.once("close", done);
  });
}

/**
 * Write a tar of `files`, one file in memory at a time, waiting whenever the
 * reader falls behind, and stopping if it goes away. A file deleted since the
 * listing is left out. Answers how many went in.
 */
export async function streamTar(out: TarSink, files: readonly PhotoFile[], now: () => number = Date.now): Promise<number> {
  let sent = 0;
  const put = async (chunk: Buffer): Promise<void> => {
    if (!out.destroyed && !out.write(chunk) && !out.destroyed) await drained(out);
  };
  for (const f of files) {
    if (out.destroyed) return sent;
    const data = await readFile(f.path).catch(() => null);
    if (data === null) continue;
    const time = photoTimeOf(f.name.slice(f.name.lastIndexOf("/") + 1)) ?? now();
    await put(tarHeader(f.name, data.length, Math.floor(time / 1000)));
    await put(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad > 0) await put(Buffer.alloc(pad));
    sent++;
  }
  if (!out.destroyed) await put(Buffer.alloc(1024));
  return sent;
}
