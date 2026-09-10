//! Real-time collaborative editing for server projects (the SaaS path).
//!
//! Each open project file is a Yjs `Y.Doc` (one `Y.Text` under `"content"`),
//! authoritative on the server and seeded from the `project_file` row. Edits
//! flow over the server's usual transport — JSON `fetch` POSTs carrying
//! base64 Yjs updates, fanned out to the project's other editors over one
//! Server-Sent-Events stream per project (`/api/projects/:id/collab/stream`).
//! No WebSocket dependency, matching the event plane.
//!
//! Wire surface (all access-checked by the caller via `getProjectFor`):
//!   GET  …/collab/stream?cid=…      SSE: `update` / `awareness` / `files`
//!   POST …/collab/sync              {path, sv?}   → {update, sv} (b64)
//!   POST …/collab/update            {path, update, cid}
//!   POST …/collab/awareness         {path, update, cid}
//!
//! CRDT merge means concurrent edits from several authors converge without
//! clobbering; the merged text is persisted (debounced) back into
//! `project_file`, so `projectSource` / event launch / the plain files API
//! all see the live document. A direct `PUT /files` from a non-collab client
//! is adopted into the live doc (`adoptExternalWrite`) instead of being
//! overwritten by the next persist. Awareness (cursors, names) is relayed
//! blind — clients prune stale peers themselves (the awareness protocol's
//! 30s outdated timeout).

import type { ServerResponse } from "node:http";

import * as Y from "yjs";

import { sseSend } from "./http-util.ts";

/** Where the merged text is loaded from / persisted to. Injected so tests
 *  run against a memory map; production wires the `project_file` queries. */
export interface CollabStorage {
  load(projectId: string, path: string): Promise<string | null>;
  save(projectId: string, path: string, content: string): Promise<void>;
}

interface CollabClient {
  res: ServerResponse;
  /** Client-chosen stream id — its own updates aren't echoed back to it. */
  cid: string;
}

/** Origin attached to updates applied on behalf of a client POST. */
interface UpdateOrigin {
  cid: string | null;
}

interface ProjectCollab {
  docs: Map<string, Y.Doc>;
  clients: Set<CollabClient>;
  /** Paths whose merged text is newer than the stored row. */
  dirty: Set<string>;
  persistTimer: ReturnType<typeof setTimeout> | null;
  /** Drops the whole in-memory project a while after the last editor left. */
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const b64 = (u: Uint8Array): string => Buffer.from(u).toString("base64");
const unb64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64"));

/**
 * Replace a `Y.Text`'s content with `next` as a minimal single splice
 * (longest common prefix + suffix), so concurrent remote edits outside the
 * changed region merge instead of conflicting. Shared shape with the editor
 * client's store→doc bridge.
 */
export function replaceIntoYText(ytext: Y.Text, next: string, origin?: unknown): void {
  const prev = ytext.toString();
  if (prev === next) return;
  let start = 0;
  const minLen = Math.min(prev.length, next.length);
  while (start < minLen && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  ytext.doc!.transact(() => {
    if (endPrev > start) ytext.delete(start, endPrev - start);
    if (endNext > start) ytext.insert(start, next.slice(start, endNext));
  }, origin);
}

/** What `notifyEvent` fans out on the project's collab stream. */
export interface EventNotice {
  kind: "launched" | "golive" | "ended" | "reload" | "paused" | "resumed";
  /** Display name of the author who did it. */
  by: string;
  eventId: string;
  mode: "live" | "preview";
}

export class CollabHub {
  private readonly projects = new Map<string, ProjectCollab>();

  constructor(
    private readonly storage: CollabStorage,
    private readonly persistDelayMs = 800,
    private readonly idleDropMs = 5 * 60_000,
  ) {}

  private project(projectId: string): ProjectCollab {
    let p = this.projects.get(projectId);
    if (p === undefined) {
      p = { docs: new Map(), clients: new Set(), dirty: new Set(), persistTimer: null, idleTimer: null };
      this.projects.set(projectId, p);
    }
    return p;
  }

  /** The live doc for a file, seeded from storage on first touch. */
  async docFor(projectId: string, path: string): Promise<Y.Doc> {
    const p = this.project(projectId);
    let doc = p.docs.get(path);
    if (doc !== undefined) return doc;
    doc = new Y.Doc();
    const ytext = doc.getText("content");
    const stored = await this.storage.load(projectId, path);
    if (stored !== null && stored !== "") ytext.insert(0, stored);
    // Seeding must not count as an edit: attach the fan-out AFTER the seed.
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      const from = (origin as UpdateOrigin | null)?.cid ?? null;
      for (const c of p.clients) {
        if (from !== null && c.cid === from) continue;
        sseSend(c.res, "update", { path, update: b64(update) });
      }
      p.dirty.add(path);
      this.schedulePersist(projectId);
    });
    // Handle the race where two concurrent docFor calls both seeded.
    const existing = p.docs.get(path);
    if (existing !== undefined) return existing;
    p.docs.set(path, doc);
    return doc;
  }

  /** Sync handshake: everything the caller is missing, plus the server's
   *  state vector so the caller can push back what the server is missing. */
  async sync(projectId: string, path: string, svB64?: string): Promise<{ update: string; sv: string }> {
    const doc = await this.docFor(projectId, path);
    const sv = svB64 !== undefined && svB64 !== "" ? unb64(svB64) : undefined;
    return {
      update: b64(Y.encodeStateAsUpdate(doc, sv)),
      sv: b64(Y.encodeStateVector(doc)),
    };
  }

  /** Apply one client's incremental update (fan-out + persist ride the
   *  doc's update event). */
  async applyUpdate(projectId: string, path: string, updateB64: string, cid: string | null): Promise<void> {
    const doc = await this.docFor(projectId, path);
    Y.applyUpdate(doc, unb64(updateB64), { cid } satisfies UpdateOrigin);
  }

  /** Relay an awareness (cursor/presence) update to the other editors. */
  broadcastAwareness(projectId: string, path: string, updateB64: string, cid: string | null): void {
    const p = this.projects.get(projectId);
    if (p === undefined) return;
    for (const c of p.clients) {
      if (cid !== null && c.cid === cid) continue;
      sseSend(c.res, "awareness", { path, update: updateB64 });
    }
  }

  /** Tell every editor (including the actor — it's idempotent for them)
   *  that a file appeared / disappeared, so trees refresh live. */
  notifyFileChange(projectId: string, op: "put" | "delete", path: string): void {
    const p = this.projects.get(projectId);
    if (p === undefined) return;
    for (const c of p.clients) sseSend(c.res, "files", { op, path });
  }

  /**
   * A run transition on this project's event (launch / go live / end / pause /
   * resume / push draft): tell every open editor at once, so a co-writer's
   * console follows within a second instead of on its next status poll.
   * (`/api/mod/reset` is announced by the runtime's own `lifecycle` stream —
   * it doesn't know its project — so `reset` is deliberately absent here.)
   */
  notifyEvent(projectId: string, payload: EventNotice): void {
    const p = this.projects.get(projectId);
    if (p === undefined) return;
    for (const c of p.clients) sseSend(c.res, "event", payload);
  }

  /** A plain `PUT /files` landed while a live doc exists: fold the new text
   *  into the doc (broadcast rides the update event) instead of letting the
   *  next persist clobber it. No live doc → the row is already authoritative. */
  adoptExternalWrite(projectId: string, path: string, content: string): void {
    const doc = this.projects.get(projectId)?.docs.get(path);
    if (doc === undefined) return;
    replaceIntoYText(doc.getText("content"), content, { cid: null } satisfies UpdateOrigin);
    // The row was just written with exactly this text — nothing to persist.
    const p = this.projects.get(projectId);
    if (p !== undefined && doc.getText("content").toString() === content) p.dirty.delete(path);
  }

  /** Forget a deleted/renamed file's doc (do NOT persist it back). */
  dropDoc(projectId: string, path: string): void {
    const p = this.projects.get(projectId);
    if (p === undefined) return;
    p.docs.get(path)?.destroy();
    p.docs.delete(path);
    p.dirty.delete(path);
  }

  // -- SSE clients ---------------------------------------------------------

  addClient(projectId: string, res: ServerResponse, cid: string): () => void {
    const p = this.project(projectId);
    if (p.idleTimer !== null) {
      clearTimeout(p.idleTimer);
      p.idleTimer = null;
    }
    const client: CollabClient = { res, cid };
    p.clients.add(client);
    return () => {
      p.clients.delete(client);
      if (p.clients.size === 0) {
        // Last editor left: persist now, then drop the in-memory project
        // after an idle window (a returning editor reseeds from storage).
        void this.flush(projectId);
        p.idleTimer = setTimeout(() => {
          if (p.clients.size === 0) {
            void this.flush(projectId).then(() => {
              if (p.clients.size === 0) {
                for (const d of p.docs.values()) d.destroy();
                this.projects.delete(projectId);
              }
            });
          }
        }, this.idleDropMs);
        p.idleTimer.unref?.();
      }
    };
  }

  // -- persistence ---------------------------------------------------------

  private schedulePersist(projectId: string): void {
    const p = this.project(projectId);
    if (p.persistTimer !== null) return;
    p.persistTimer = setTimeout(() => {
      p.persistTimer = null;
      void this.flush(projectId);
    }, this.persistDelayMs);
    p.persistTimer.unref?.();
  }

  /** Persist every dirty doc's merged text now. Called on the debounce
   *  timer, on last-disconnect, and before an event launch snapshots the
   *  project (`projectSource` must see the live text). */
  async flush(projectId: string): Promise<void> {
    const p = this.projects.get(projectId);
    if (p === undefined) return;
    if (p.persistTimer !== null) {
      clearTimeout(p.persistTimer);
      p.persistTimer = null;
    }
    const paths = [...p.dirty];
    p.dirty.clear();
    for (const path of paths) {
      const doc = p.docs.get(path);
      if (doc === undefined) continue;
      try {
        await this.storage.save(projectId, path, doc.getText("content").toString());
      } catch (err) {
        p.dirty.add(path); // retry on the next update/flush
        console.error(`collab persist failed for ${projectId}/${path}:`, err);
      }
    }
  }
}

// -- the production hub ----------------------------------------------------

let hub: CollabHub | null = null;

/** The process-wide hub, storage-backed by the `project_file` table. */
export function collabHub(): CollabHub {
  if (hub === null) {
    hub = new CollabHub({
      async load(projectId, path) {
        const { getFile } = await import("./db/queries.ts");
        const row = await getFile(projectId, path);
        return row?.content ?? null;
      },
      async save(projectId, path, content) {
        const { upsertFile } = await import("./db/queries.ts");
        await upsertFile(projectId, path, content);
      },
    });
  }
  return hub;
}
