//! Profile pictures, served same-origin.
//!
//! The participant app's Content-Security-Policy is `img-src 'self'`, so
//! a picture from Wikipedia (or an author's `avatar:` link) can't be
//! loaded straight from the phone. Instead the server keeps an
//! `AvatarBook` per event — *who* has *which* picture, as an opaque key —
//! and serves the bytes itself at `/e/:id/api/avatar/<key>` through a
//! process-wide `ImageCache`. Only URLs the server chose (a Wikipedia
//! thumbnail it found, a link the author wrote) ever enter the book, so
//! the route is never an open proxy: a key that isn't in the book is a
//! 404, and there is no way to ask it for an arbitrary address.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { foldName } from "../src/parser/names.ts";
import { fileUrl } from "./wiki.ts";

/** A persisted book entry: `[subject, url]`, plus `"chosen"` when a guest
 *  picked that picture themselves (a re-seed from the story keeps it). */
export type AvatarEntry = [string, string] | [string, string, "chosen"];

/** Turn a picture URL into its stable, opaque serving key. */
export function avatarKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

/** An authored `avatar:` reference as a fetchable URL: a URL stays one,
 *  a `File:…` name becomes its Wikipedia thumbnail. */
export function avatarRefUrl(ref: string): string {
  return /^File:/iu.test(ref) ? fileUrl(ref) : ref;
}

/**
 * Who has which picture, in one event. Subjects are display names
 * (a character's declared name, a guest's registered name), folded the
 * way the story folds names — so "MS Paint" and "ms_paint" are one
 * subject, matching how a guest's name lands in chat.
 *
 * The book also holds *offered* pictures — the options a picker is
 * showing, servable by key but nobody's yet — so a guest can see every
 * choice before they make one.
 */
export class AvatarBook {
  private readonly bySubject = new Map<string, string>();
  private readonly chosen = new Set<string>();
  private readonly byKey = new Map<string, string>();

  /** Record `url` as `subject`'s picture; returns its serving key.
   *  `chosen`: the guest picked it themselves. */
  assign(subject: string, url: string, chosen = false): string {
    const key = this.offer(url);
    const s = foldName(subject);
    this.bySubject.set(s, url);
    if (chosen) this.chosen.add(s);
    else this.chosen.delete(s);
    return key;
  }

  /** Make `url` servable (a picker's option) without giving it to anyone. */
  offer(url: string): string {
    const key = avatarKey(url);
    this.byKey.set(key, url);
    return key;
  }

  /** Does the book hold a picture for this subject? */
  has(subject: string): boolean {
    return this.bySubject.has(foldName(subject));
  }

  /** Did a guest choose this subject's picture themselves? */
  isChosen(subject: string): boolean {
    return this.chosen.has(foldName(subject));
  }

  /** The serving key for a subject's picture, or null when they have none. */
  keyFor(subject: string): string | null {
    const url = this.bySubject.get(foldName(subject));
    return url === undefined ? null : avatarKey(url);
  }

  /** The upstream URL a serving key stands for (null: not in the book). */
  urlFor(key: string): string | null {
    return this.byKey.get(key) ?? null;
  }

  /** `subject → key` for every subject that has a picture (the views' map). */
  keys(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [subject, url] of this.bySubject) out[subject] = avatarKey(url);
    return out;
  }

  entries(): AvatarEntry[] {
    return [...this.bySubject.entries()].map(([s, url]): AvatarEntry => (this.chosen.has(s) ? [s, url, "chosen"] : [s, url]));
  }

  load(entries: unknown): void {
    if (!Array.isArray(entries)) return;
    for (const e of entries) {
      if (Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "string") this.assign(e[0], e[1], e[2] === "chosen");
    }
  }

  clear(): void {
    this.bySubject.clear();
    this.chosen.clear();
    this.byKey.clear();
  }
}

/** The fetch shape the cache needs (injectable for tests). */
export type ImageFetch = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface CachedImage {
  bytes: Uint8Array;
  contentType: string;
}

const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|svg\+xml|avif)$/iu;
const USER_AGENT = "LoomPlay/1.0 (https://github.com/loom; live-event participant app)";

/**
 * Picture bytes by URL, bounded by total size (LRU). One per process —
 * every event shares it, so two events with the same Clippy fetch him once.
 *
 * With a `dir`, every picture fetched is also kept on disk
 * (`<sha>.img` + `<sha>.type`), so the cast's pictures are downloaded
 * once — when the story loads — and a restarted server, or one whose
 * internet went away mid-party, still serves them.
 */
export class ImageCache {
  private readonly images = new Map<string, CachedImage>();
  private readonly inflight = new Map<string, Promise<CachedImage | null>>();
  private readonly fetchFn: ImageFetch;
  private readonly maxBytes: number;
  private readonly maxImageBytes: number;
  private readonly timeoutMs: number;
  private readonly dir: string | null;
  private size = 0;

  constructor(opts: { fetch?: ImageFetch; maxBytes?: number; maxImageBytes?: number; timeoutMs?: number; dir?: string | null } = {}) {
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
    this.dir = opts.dir ?? null;
    this.maxBytes = opts.maxBytes ?? 32 * 1024 * 1024;
    this.maxImageBytes = opts.maxImageBytes ?? 2 * 1024 * 1024;
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  /** The picture at `url` (cached), or null when it can't be fetched or isn't an image. */
  get(url: string): Promise<CachedImage | null> {
    const hit = this.images.get(url);
    if (hit !== undefined) {
      // refresh recency
      this.images.delete(url);
      this.images.set(url, hit);
      return Promise.resolve(hit);
    }
    const pending = this.inflight.get(url);
    if (pending !== undefined) return pending;
    const run = this.load(url)
      .catch(() => null)
      .finally(() => this.inflight.delete(url));
    this.inflight.set(url, run);
    return run;
  }

  private async load(url: string): Promise<CachedImage | null> {
    if (!/^https?:\/\//u.test(url)) return null;
    const disk = this.fromDisk(url);
    if (disk !== null) return this.keep(url, disk);
    const res = await this.fetchFn(url, {
      headers: { "user-agent": USER_AGENT, accept: "image/*" },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!IMAGE_TYPES.test(contentType)) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > this.maxImageBytes) return null;
    const img = { bytes, contentType };
    this.toDisk(url, img);
    return this.keep(url, img);
  }

  /** Is this picture held on disk already? (No fetch.) */
  onDisk(url: string): boolean {
    return this.dir !== null && existsSync(this.diskPath(url, "img"));
  }

  private diskPath(url: string, ext: "img" | "type"): string {
    return join(this.dir!, `${createHash("sha256").update(url).digest("hex")}.${ext}`);
  }

  private fromDisk(url: string): CachedImage | null {
    if (this.dir === null) return null;
    try {
      const contentType = readFileSync(this.diskPath(url, "type"), "utf8").trim();
      if (!IMAGE_TYPES.test(contentType)) return null;
      const bytes = new Uint8Array(readFileSync(this.diskPath(url, "img")));
      return bytes.byteLength === 0 ? null : { bytes, contentType };
    } catch {
      return null;
    }
  }

  private toDisk(url: string, img: CachedImage): void {
    if (this.dir === null) return;
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(this.diskPath(url, "img"), img.bytes);
      writeFileSync(this.diskPath(url, "type"), img.contentType);
    } catch {
      // a full / read-only disk only costs the offline copy
    }
  }

  private keep(url: string, img: CachedImage): CachedImage {
    this.images.set(url, img);
    this.size += img.bytes.byteLength;
    while (this.size > this.maxBytes && this.images.size > 1) {
      const oldest = this.images.keys().next().value as string;
      this.size -= this.images.get(oldest)!.bytes.byteLength;
      this.images.delete(oldest);
    }
    return img;
  }

  /** How many pictures are held (tests). */
  get count(): number {
    return this.images.size;
  }
}
