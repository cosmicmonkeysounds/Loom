//! The speaker config's routes (wave 17, `core/server/audio.ts`), as the map
//! page calls them with the device's moderator token:
//! `GET /api/mod/audio` (the config in force + the story's sound names and
//! LOCATIONs + the recent tests; with `after` a long poll), `POST
//! /api/mod/audio {audio, base?}` (409 on a stale base), `POST
//! /api/mod/audio/project` and `POST /api/mod/audio/test {speaker} | {out}`.
//! Every write's outcome is a value (`MapReply`, like the map's).

import type { AudioConfig } from "@loom/house";
import type { MapReply } from "../api.ts";
import { normalizeAudio } from "./audio.ts";

/** One speaker / output test the router was asked to play. */
export interface AudioTestRow {
  seq: number;
  at: number;
  speaker: string | null;
  out: number | null;
}

/** `GET /api/mod/audio`. `source`: a director's save, the project's file,
 *  `LOOM_AUDIO`, or the default (nothing configured). */
/** Is the house Mac's router listening (LA-4)? An older server says nothing: null. */
export interface AudioRouter {
  online: boolean;
  lastSeen: number | null;
  name: string | null;
}

export interface AudioView {
  audio: AudioConfig;
  version: string;
  source: "director" | "project" | "env" | "default";
  sounds: string[];
  locations: string[];
  tests: AudioTestRow[];
  router: AudioRouter | null;
  problems: string[];
  warnings: string[];
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** A GET answer → a view (anything missing read as empty: an older shape never throws). */
export function audioViewOf(data: Record<string, unknown>): AudioView {
  const source = data["source"];
  return {
    audio: normalizeAudio(data["audio"]),
    version: typeof data["version"] === "string" ? data["version"] : "",
    source: source === "director" || source === "project" || source === "env" ? source : "default",
    sounds: strings(data["sounds"]),
    locations: strings(data["locations"]),
    tests: Array.isArray(data["tests"])
      ? (data["tests"] as unknown[]).flatMap((t) => {
          if (typeof t !== "object" || t === null) return [];
          const r = t as Record<string, unknown>;
          if (typeof r["seq"] !== "number" || typeof r["at"] !== "number") return [];
          return [{ seq: r["seq"], at: r["at"], speaker: typeof r["speaker"] === "string" ? r["speaker"] : null, out: typeof r["out"] === "number" ? r["out"] : null }];
        })
      : [],
    router: routerOf(data["router"]),
    problems: strings(data["problems"]),
    warnings: strings(data["warnings"]),
  };
}

/** A `router` block off an answer, or null (an older server). */
export function routerOf(v: unknown): AudioRouter | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r["online"] !== "boolean") return null;
  return { online: r["online"], lastSeen: typeof r["lastSeen"] === "number" ? r["lastSeen"] : null, name: typeof r["name"] === "string" ? r["name"] : null };
}

/** What a sent Test says, given whether a router is listening. */
export function testSentText(seq: number, what: string, router: AudioRouter | null, now: number): string {
  if (router === null) return `🔈 Test #${seq} sent: the router plays a tone and says “${what}” there (if it is running on the house Mac).`;
  if (router.online) return `🔈 Test #${seq} sent: the router${router.name !== null ? ` (${router.name})` : ""} plays a tone and says “${what}” there.`;
  const ago = router.lastSeen === null ? "no router has polled since the server started" : `no router has polled in ${testAge(router.lastSeen, now).replace(" ago", "")}`;
  return `🔈 Test #${seq} queued, but ${ago}: is the stagehand audio module running on the house Mac?`;
}

/** The Audio tab's router badge. */
export function routerBadge(router: AudioRouter | null, now: number): { text: string; ok: boolean } | null {
  if (router === null) return null;
  if (router.online) return { text: `router online${router.name !== null ? ` · ${router.name}` : ""}`, ok: true };
  return { text: router.lastSeen === null ? "no router yet" : `router last seen ${testAge(router.lastSeen, now)}`, ok: false };
}

/** The GET's outcome: the view; `missing` = a server with no speaker routes (404); `error` = away / refused. */
export type AudioFetch = { kind: "ok"; view: AudioView } | { kind: "missing" } | { kind: "error"; status: number | null; error: string };

/**
 * The event's speaker config. With `after` (the version the page holds) it
 * is the long poll: the server answers when the version moves on, a test
 * newer than `tests` lands, or `wait` seconds pass.
 */
export async function fetchAudio(
  base: string,
  token: string,
  opts: { after?: string; tests?: number; wait?: number; signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<AudioFetch> {
  const q = new URLSearchParams();
  if (opts.after !== undefined) q.set("after", opts.after);
  if (opts.tests !== undefined) q.set("tests", String(opts.tests));
  if (opts.wait !== undefined) q.set("wait", String(opts.wait));
  const qs = q.toString();
  try {
    const res = await (opts.fetcher ?? fetch)(`${base}/api/mod/audio${qs !== "" ? `?${qs}` : ""}`, {
      headers: { "x-loom-token": token },
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 404) return { kind: "missing" };
    if (!res.ok) return { kind: "error", status: res.status, error: typeof data["error"] === "string" ? data["error"] : `HTTP ${res.status}` };
    return { kind: "ok", view: audioViewOf(data) };
  } catch (e) {
    return { kind: "error", status: null, error: (e as Error).message };
  }
}

async function post<T>(url: string, token: string, body: Record<string, unknown>, fetcher: typeof fetch): Promise<MapReply<T>> {
  try {
    const res = await fetcher(url, { method: "POST", headers: { "content-type": "application/json", "x-loom-token": token }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, result: data as unknown as T };
    const version = typeof data["version"] === "string" ? data["version"] : null;
    return {
      ok: false,
      status: res.status,
      error: typeof data["error"] === "string" ? data["error"] : `HTTP ${res.status}`,
      problems: strings(data["problems"]),
      conflict: res.status === 409 && version !== null,
      version,
    };
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message, problems: [], conflict: false, version: null };
  }
}

export interface SaveAudioResult {
  version: string;
  warnings: string[];
}

/** A director's save of the speakers, based on the version the page loaded (null: no check). */
export function saveAudio(base: string, token: string, audio: AudioConfig, baseVersion: string | null, fetcher: typeof fetch = fetch): Promise<MapReply<SaveAudioResult>> {
  return post<SaveAudioResult>(`${base}/api/mod/audio`, token, baseVersion !== null ? { audio, base: baseVersion } : { audio }, fetcher);
}

/** The config in force becomes the project's `audio.json`. */
export function saveAudioToProject(base: string, token: string, fetcher: typeof fetch = fetch): Promise<MapReply<{ file: string; version: string }>> {
  return post<{ file: string; version: string }>(`${base}/api/mod/audio/project`, token, {}, fetcher);
}

/** Ask the router to play its identifying tone + label on a speaker or an output. */
export function testAudio(base: string, token: string, target: { speaker: string } | { out: number }, fetcher: typeof fetch = fetch): Promise<MapReply<{ ok: true; seq: number; router?: unknown }>> {
  return post<{ ok: true; seq: number; router?: unknown }>(`${base}/api/mod/audio/test`, token, target, fetcher);
}

/** (wave 49) 👣 Test: a program's steps on this speaker alone, for a few seconds (the router synthesises them). */
export function testFootsteps(base: string, token: string, speaker: string, fetcher: typeof fetch = fetch): Promise<MapReply<{ ok: true }>> {
  return post<{ ok: true }>(`${base}/api/mod/audio/walkers/test`, token, { speaker }, fetcher);
}

/** What a test's refusal tells the director (a speaker the server hasn't got is an unsaved one). */
export function testRefusal(r: { status: number; error: string }, target: { speaker: string } | { out: number }): string {
  if (r.status === 404 && "speaker" in target) return `“${target.speaker}” isn't saved yet — save the speakers, then test it.`;
  if (r.status === 401 || r.status === 403) return "This device's moderator access was refused.";
  if (r.status === 0) return `Couldn't reach the server (${r.error}).`;
  return `Not tested — ${r.error}.`;
}

/** "Sent 4 s ago" for a test row, against `now`. */
export function testAge(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
}

/** The speaker save's line: a 409 (another director, or a Save to project) offers the reload. */
export function audioConflictText(version: string | null): string {
  return `Speakers not saved — they changed since you loaded them${version !== null ? ` (now v${version})` : ""}. Reload the speakers, then redo your edits.`;
}
