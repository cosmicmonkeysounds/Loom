//! The photo routes (wave 59p, `docs/loom-w59-photos-contract.md`). **Pictures of
//! people**: every route is behind the moderator check, and none is in a guest's
//! reach.
//!
//! | Route | Who |
//! |---|---|
//! | `GET /api/mod/photos` (the panel) | a director or a host |
//! | `GET /api/mod/photos/thumb?spot=` (one spot's latest) | a director or a host |
//! | `POST /api/mod/photos/arm {armed}` | a director or a host |
//! | `POST /api/mod/photos/shot {spot, jpeg, w, h}` (a terminal's still) | a mod token |
//! | `GET /api/mod/photos/download` (a tar, streamed) | a director |
//! | `POST /api/mod/photos/delete {confirm: "delete"}` | a director |
//!
//! The allowlist (`routes/host.ts`) keeps a host-only token off the last three
//! before it gets here; the checks below keep everyone else off all of them.

import type { IncomingMessage, ServerResponse } from "node:http";

import { queryTokenOf, readBody, sendJson, tokenOf } from "../http-util.ts";
import { parseCamUpload } from "../spatial-cams.ts";
import { PHOTO_BODY_LIMIT, PHOTO_MAX_BYTES, photosViewFor, streamTar, type PhotoBook, type PhotoPoll, type PhotoSpot } from "../photos.ts";

export const PHOTOS_ROUTE = "/api/mod/photos";
export const PHOTO_THUMB_ROUTE = "/api/mod/photos/thumb";
export const PHOTO_ARM_ROUTE = "/api/mod/photos/arm";
export const PHOTO_SHOT_ROUTE = "/api/mod/photos/shot";
export const PHOTO_DOWNLOAD_ROUTE = "/api/mod/photos/download";
export const PHOTO_DELETE_ROUTE = "/api/mod/photos/delete";

/** What the routes need from the runtime. */
export interface PhotoRoutes {
  book: PhotoBook;
  /** The map's terminals that take stills: never the tent's or the TV's. */
  spots: () => PhotoSpot[];
  /** The heartbeat, newest first. */
  polls: () => readonly PhotoPoll[];
  now: () => number;
  silentMs: number;
  /** May this token read the panel and arm it (a director or a host)? */
  host: (token: string | undefined) => boolean;
  /** May it hold the mod capability (a director, a terminal)? */
  moderator: (token: string | undefined) => boolean;
}

function viewOf(r: PhotoRoutes): ReturnType<typeof photosViewFor> {
  return photosViewFor(r.book, r.spots(), r.polls(), r.now(), r.silentMs);
}

/** The GETs. False: not a photo route. */
export async function handlePhotosGet(r: PhotoRoutes, req: IncomingMessage, res: ServerResponse, path: string, url: URL): Promise<boolean> {
  const token = queryTokenOf(req, url);
  if (path === PHOTOS_ROUTE || path === PHOTO_THUMB_ROUTE) {
    if (!r.host(token)) {
      sendJson(res, 403, { error: "moderators only" });
      return true;
    }
    res.setHeader?.("cache-control", "no-store");
    if (path === PHOTOS_ROUTE) {
      sendJson(res, 200, viewOf(r));
      return true;
    }
    const jpeg = await r.book.latest(url.searchParams.get("spot") ?? "");
    if (jpeg === null) {
      sendJson(res, 404, { error: "no photo" });
      return true;
    }
    res.writeHead(200, { "content-type": "image/jpeg", "content-length": jpeg.length, "x-content-type-options": "nosniff" });
    res.end(jpeg);
    return true;
  }
  if (path === PHOTO_DOWNLOAD_ROUTE) {
    if (!r.moderator(token)) {
      sendJson(res, 403, { error: "moderators only" });
      return true;
    }
    const day = new Date(r.now()).toISOString().slice(0, 10);
    res.writeHead(200, { "content-type": "application/x-tar", "content-disposition": `attachment; filename="photos-${day}.tar"`, "cache-control": "no-store", "x-content-type-options": "nosniff" });
    await streamTar(res, r.book.files(), r.now);
    res.end();
    return true;
  }
  return false;
}

/**
 * A terminal's still, read under its own cap before the generic parse. The
 * token is read off the header first, so a refused caller never gets a body
 * buffered.
 */
export async function handlePhotoShot(r: PhotoRoutes, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (!r.moderator(req.headers["x-loom-token"] as string | undefined)) {
    sendJson(res, 403, { error: "moderators only" });
    return true;
  }
  const up = parseCamUpload(await readBody(req, PHOTO_BODY_LIMIT), PHOTO_MAX_BYTES);
  if (!up.ok) {
    sendJson(res, up.status, { error: up.error });
    return true;
  }
  if (!r.spots().some((s) => s.id === up.spot)) {
    sendJson(res, 404, { error: "no such spot" });
    return true;
  }
  const out = await r.book.put(up.spot, up.jpeg);
  if (out.ok) sendJson(res, 200, { ok: true, at: out.at });
  else sendJson(res, out.status, { error: out.error });
  return true;
}

/** The POSTs past the generic parse. False: not a photo route. */
export function handlePhotosPost(r: PhotoRoutes, req: IncomingMessage, res: ServerResponse, path: string, body: Record<string, unknown>): boolean {
  const token = tokenOf(req, body);
  if (path === PHOTO_ARM_ROUTE) {
    if (!r.host(token)) {
      sendJson(res, 403, { error: "moderators only" });
      return true;
    }
    if (typeof body["armed"] !== "boolean") {
      sendJson(res, 400, { error: "armed is true or false" });
      return true;
    }
    r.book.arm(body["armed"]);
    sendJson(res, 200, viewOf(r));
    return true;
  }
  if (path === PHOTO_DELETE_ROUTE) {
    if (!r.moderator(token)) {
      sendJson(res, 403, { error: "moderators only" });
      return true;
    }
    if (body["confirm"] !== "delete") {
      sendJson(res, 400, { error: 'confirm is "delete"' });
      return true;
    }
    sendJson(res, 200, { deleted: r.book.deleteAll(), view: viewOf(r) });
    return true;
  }
  return false;
}
