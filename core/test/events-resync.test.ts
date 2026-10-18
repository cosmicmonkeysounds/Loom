//! T4-04 against a real Postgres: `sync-show` / `sync-example` rewrite
//! `project_file` from another process, and the event's ProjectLink
//! (`events-api.ts` `projectLink`) `resyncFiles` folds the rewritten rows
//! into the project's open co-editing docs and refreshes every editor's
//! tree — so the next keystroke merges on top of the synced story instead
//! of persisting the pre-sync doc over it. Gated on DB connectivity like
//! `db.test.ts` (every case skips with no database).

import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";

import { collabHub } from "../server/collab.ts";
import { dbReady, initSchema, pool } from "../server/db/index.ts";
import { createProject, getFile, upsertFile } from "../server/db/queries.ts";
import { projectLink } from "../server/events-api.ts";

const OWNER = `test-resync-${randomUUID()}`;
let hasDb = false;

beforeAll(async () => {
  hasDb = await dbReady();
  if (hasDb) await initSchema();
});

afterAll(async () => {
  if (hasDb) {
    await pool().query("delete from project where owner_id = $1", [OWNER]);
    await pool().end();
  }
});

/** A fake SSE client: the events `sseSend` wrote to it. */
function fakeClient() {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  let buf = "";
  const res = {
    write(chunk: string) {
      buf += chunk;
      let sep = buf.indexOf("\n\n");
      while (sep !== -1) {
        const block = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        events.push({ event: /event: (.*)/.exec(block)?.[1] ?? "message", data: JSON.parse(/data: (.*)/.exec(block)?.[1] ?? "{}") as Record<string, unknown> });
        sep = buf.indexOf("\n\n");
      }
      return true;
    },
  } as unknown as ServerResponse;
  return { res, events };
}

const textOf = async (projectId: string, path: string): Promise<string> => {
  const d = new Y.Doc();
  Y.applyUpdate(d, new Uint8Array(Buffer.from((await collabHub().sync(projectId, path)).update, "base64")));
  return d.getText("content").toString();
};

describe("ProjectLink.resyncFiles (T4-04)", () => {
  it("folds a row sync-show rewrote into the open doc, announces every file, and a later edit lands on the synced text", async (ctx) => {
    if (!hasDb) ctx.skip();
    const project = await createProject(OWNER, "Resync");
    await upsertFile(project.id, "main.loom", "# Old\n");
    await upsertFile(project.id, "notes.loom", "notes\n");
    const hub = collabHub();
    const client = fakeClient();
    const remove = hub.addClient(project.id, client.res, "a");
    try {
      expect(await textOf(project.id, "main.loom")).toBe("# Old\n");

      // sync-example writes project_file directly…
      await upsertFile(project.id, "main.loom", "# Synced\n");
      expect(await textOf(project.id, "main.loom")).toBe("# Old\n"); // the stale doc
      // …and the reload's resync folds it in.
      await projectLink(project.id, "evt").resyncFiles!();
      expect(await textOf(project.id, "main.loom")).toBe("# Synced\n");
      expect(client.events.filter((e) => e.event === "update").length).toBeGreaterThan(0);
      expect(client.events.filter((e) => e.event === "files").map((e) => e.data).sort((a, b) => String(a.path).localeCompare(String(b.path)))).toEqual([
        { op: "put", path: "main.loom" },
        { op: "put", path: "notes.loom" },
      ]);

      // One keystroke after the sync persists on top of the synced text.
      const doc = new Y.Doc();
      Y.applyUpdate(doc, new Uint8Array(Buffer.from((await hub.sync(project.id, "main.loom")).update, "base64")));
      const sv = Y.encodeStateVector(doc);
      doc.getText("content").insert(0, "// hi\n");
      await hub.applyUpdate(project.id, "main.loom", Buffer.from(Y.encodeStateAsUpdate(doc, sv)).toString("base64"), "a");
      await hub.flush(project.id);
      expect((await getFile(project.id, "main.loom"))?.content).toBe("// hi\n# Synced\n");
    } finally {
      remove();
    }
  });
});
