//! Control-plane HTTP for real-time co-editing: `/api/projects/:id/collab/*`.
//!
//! Thin routing over `CollabHub` (see `collab.ts` for the protocol). Access
//! is the same as the files API — any signed-in owner or invited member of
//! the project; a project the caller can't access reads as 404.

import type { IncomingMessage, ServerResponse } from "node:http";

import { collabHub } from "./collab.ts";
import { readBody, sendJson, sseSend, str } from "./http-util.ts";
import { getProjectFor } from "./db/queries.ts";
import type { AuthUser } from "./projects.ts";

/** Reject path traversal / absurd paths before they key a doc. */
function safePath(path: string): boolean {
  return path !== "" && !path.includes("..") && !path.startsWith("/") && path.length < 512;
}

/**
 * Handle `/api/projects/:id/collab/{stream,sync,update,awareness}`.
 * `segs` is the split path (`["api","projects",id,"collab",action]`).
 */
export async function handleCollab(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  segs: string[],
  url: URL,
  user: AuthUser,
): Promise<boolean> {
  const projectId = segs[2]!;
  const action = segs[4];
  const hub = collabHub();

  const project = await getProjectFor(user.id, projectId);
  if (project === null) {
    sendJson(res, 404, { error: "no such project" });
    return true;
  }

  // GET …/collab/stream?cid=… — the project's live-update stream.
  if (action === "stream" && method === "GET") {
    const cid = (url.searchParams.get("cid") ?? "").slice(0, 64);
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(":ok\n\n");
    sseSend(res, "hello", { projectId });
    const remove = hub.addClient(projectId, res, cid);
    req.on("close", remove);
    return true;
  }

  // POST …/collab/sync {path, sv?} — initial/reconnect handshake.
  if (action === "sync" && method === "POST") {
    const body = await readBody(req);
    const path = str(body, "path");
    if (!safePath(path)) {
      sendJson(res, 400, { error: "bad file path" });
      return true;
    }
    sendJson(res, 200, await hub.sync(projectId, path, str(body, "sv")));
    return true;
  }

  // POST …/collab/update {path, update, cid} — one incremental Yjs update.
  if (action === "update" && method === "POST") {
    const body = await readBody(req);
    const path = str(body, "path");
    if (!safePath(path)) {
      sendJson(res, 400, { error: "bad file path" });
      return true;
    }
    try {
      await hub.applyUpdate(projectId, path, str(body, "update"), str(body, "cid") || null);
    } catch {
      sendJson(res, 400, { error: "malformed update" });
      return true;
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  // POST …/collab/awareness {path, update, cid} — cursor/presence relay.
  if (action === "awareness" && method === "POST") {
    const body = await readBody(req);
    const path = str(body, "path");
    if (!safePath(path)) {
      sendJson(res, 400, { error: "bad file path" });
      return true;
    }
    hub.broadcastAwareness(projectId, path, str(body, "update"), str(body, "cid") || null);
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
