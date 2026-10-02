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

import { foldName } from "../src/parser/names.ts";

/** A persisted book: `[subject, url]` pairs, subject = folded display name. */
export type AvatarEntry = [string, string];

/** Turn a picture URL into its stable, opaque serving key. */
export function avatarKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

/**
 * Who has which picture, in one event. Subjects are display names
 * (a character's declared name, a guest's registered name), folded the
 * way the story folds names — so "MS Paint" and "ms_paint" are one
 * subject, matching how a guest's name lands in chat.
 */
export class AvatarBook {
  private readonly bySubject = new Map<string, string>();
  private readonly byKey = new Map<string, string>();

  /** Record `url` as `subject`'s picture; returns its serving key. */
  assign(subject: string, url: string): string {
    const key = avatarKey(url);
    this.bySubject.set(foldName(subject), url);
    this.byKey.set(key, url);
    return key;
  }

  /** Does the book hold a picture for this subject? */
  has(subject: string): boolean {
    return this.bySubject.has(foldName(subject));
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
    return [...this.bySubject.entries()];
  }

  load(entries: unknown): void {
    if (!Array.isArray(entries)) return;
    for (const e of entries) {
      if (Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "string") this.assign(e[0], e[1]);
    }
  }

  clear(): void {
    this.bySubject.clear();
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
 */
export class ImageCache {
  private readonly images = new Map<string, CachedImage>();
  private readonly inflight = new Map<string, Promise<CachedImage | null>>();
  private readonly fetchFn: ImageFetch;
  private readonly maxBytes: number;
  private readonly maxImageBytes: number;
  private readonly timeoutMs: number;
  private size = 0;

  constructor(opts: { fetch?: ImageFetch; maxBytes?: number; maxImageBytes?: number; timeoutMs?: number } = {}) {
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
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
    this.images.set(url, img);
    this.size += bytes.byteLength;
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
