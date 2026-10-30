//! Wave 44 (`docs/loom-w44-contract.md` C6): who opted out of the video.
//!
//! `GET /api/mod/video` (directors only, never on the host allowlist) reads
//! every guest's `video` slot (the story's upload card and ⊞ Start buttons
//! set it: `"ok"` / `"out"`; anything else is not answered yet) and answers
//! `VideoConsentView`; `?format=csv` answers the same rows as a download,
//! the opted-out first. Pure over the sim: the answers are in the journal.

import type { ServerResponse } from "node:http";
import type { Sim } from "../../src/runtime/sim/index.ts";
import { display } from "../../src/runtime/expr.ts";
import { sendJson } from "../http-util.ts";

export const VIDEO_ROUTE = "/api/mod/video";
/** The story's slot (`ROLE Program` `video`). */
export const VIDEO_SLOT = "video";

export type VideoAnswer = "ok" | "out" | "unasked";

export interface VideoConsentRow {
  id: string;
  name: string;
  video: VideoAnswer;
  /** ModView.avatars' serving key for this guest, or null. */
  avatar: string | null;
  /** `<id>.featured` when not "none". */
  featured?: string;
  /** Wave 53: a performer's part, asked at its own upload. */
  staff?: true;
}

export interface VideoConsentView {
  rows: VideoConsentRow[];
  counts: { ok: number; out: number; unasked: number };
}

const text = (sim: Sim, path: string): string | null => {
  const v = sim.world.get(path);
  if (v === undefined) return null;
  return display(v).replace(/^"|"$/gu, "");
};

/** Every guest but a director's persona, then every part that declares the
 *  slot (the story's staff, wave 53), by name. */
export function videoConsentView(sim: Sim, opts: { isPersona: (id: string) => boolean; avatarOf: (name: string) => string | null }): VideoConsentView {
  const rows: VideoConsentRow[] = [];
  const counts = { ok: 0, out: 0, unasked: 0 };
  for (const p of sim.persons.values()) {
    if (opts.isPersona(p.id)) continue;
    const raw = text(sim, `${p.id}.${VIDEO_SLOT}`);
    const video: VideoAnswer = raw === "ok" || raw === "out" ? raw : "unasked";
    counts[video] += 1;
    const featured = text(sim, `${p.id}.featured`);
    rows.push({ id: p.id, name: p.name, video, avatar: opts.avatarOf(p.name), ...(featured !== null && featured !== "none" && featured !== "" ? { featured } : {}) });
  }
  for (const c of sim.model.characters.values()) {
    // `peek`: only a slot the part declares (`get` reads ROLE's default too).
    if (sim.world.peek(`${c.id}.${VIDEO_SLOT}`) === null) continue;
    const raw = text(sim, `${c.id}.${VIDEO_SLOT}`);
    const video: VideoAnswer = raw === "ok" || raw === "out" ? raw : "unasked";
    counts[video] += 1;
    rows.push({ id: c.id, name: c.id, video, avatar: opts.avatarOf(c.id), staff: true });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { rows, counts };
}

/** A CSV field, quoted when it must be (and never read as a formula). */
function field(s: string): string {
  const safe = /^[=+\-@]/u.test(s) ? `'${s}` : s;
  return /[",\n\r]/u.test(safe) ? `"${safe.replace(/"/gu, '""')}"` : safe;
}

const ORDER: Record<VideoAnswer, number> = { out: 0, unasked: 1, ok: 2 };

/** `program,video,id`, the opted-out first, then by name. */
export function videoConsentCsv(view: VideoConsentView): string {
  const rows = [...view.rows].sort((a, b) => ORDER[a.video] - ORDER[b.video] || a.name.localeCompare(b.name));
  return ["program,video,id", ...rows.map((r) => [r.name, r.video, r.id].map(field).join(","))].join("\n") + "\n";
}

/** Answer `GET /api/mod/video[?format=csv]` (the caller is checked first). */
export function sendVideoConsent(res: ServerResponse, url: URL, view: VideoConsentView): void {
  if (url.searchParams.get("format") === "csv") {
    res.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="video-consent.csv"', "cache-control": "no-store" });
    res.end(videoConsentCsv(view));
    return;
  }
  sendJson(res, 200, view);
}
