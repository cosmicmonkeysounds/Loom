//! CollabHub — the server side of SaaS live co-editing. Storage is injected
//! (a memory map here), and SSE clients are faked by capturing `res.write`,
//! so the CRDT merge/fan-out/persistence loop is tested without HTTP or a DB.

import type { ServerResponse } from "node:http";

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { CollabHub, replaceIntoYText, type CollabStorage } from "../server/collab.ts";

function memoryStorage(seed: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(seed).map(([k, v]) => [`p1/${k}`, v]));
  const storage: CollabStorage = {
    async load(projectId, path) {
      return files.get(`${projectId}/${path}`) ?? null;
    },
    async save(projectId, path, content) {
      files.set(`${projectId}/${path}`, content);
    },
  };
  return { storage, files };
}

/** A fake SSE client: captures events written by `sseSend`. */
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
        const ev = /event: (.*)/.exec(block)?.[1] ?? "message";
        const data = /data: (.*)/.exec(block)?.[1] ?? "{}";
        events.push({ event: ev, data: JSON.parse(data) as Record<string, unknown> });
        sep = buf.indexOf("\n\n");
      }
      return true;
    },
  } as unknown as ServerResponse;
  return { res, events };
}

/** A simulated editor: a local Y.Doc that talks to the hub like the client
 *  module does — sync handshake, then incremental updates both ways. */
async function joinEditor(hub: CollabHub, path: string, cid: string) {
  const { res, events } = fakeClient();
  const remove = hub.addClient("p1", res, cid);
  const doc = new Y.Doc();
  const ytext = doc.getText("content");
  const r = await hub.sync("p1", path, Buffer.from(Y.encodeStateVector(doc)).toString("base64"));
  Y.applyUpdate(doc, new Uint8Array(Buffer.from(r.update, "base64")), "remote");
  doc.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "remote") void hub.applyUpdate("p1", path, Buffer.from(u).toString("base64"), cid);
  });
  /** Apply every broadcast update the hub sent this client so far. */
  const drain = () => {
    for (const e of events.splice(0)) {
      if (e.event !== "update" || e.data.path !== path) continue;
      Y.applyUpdate(doc, new Uint8Array(Buffer.from(e.data.update as string, "base64")), "remote");
    }
  };
  return { doc, ytext, events, drain, remove };
}

describe("CollabHub — CRDT co-editing", () => {
  it("seeds a doc from storage and hands full state to a fresh client", async () => {
    const { storage } = memoryStorage({ "main.loom": "# Title\n\n== start\n" });
    const hub = new CollabHub(storage, 10);
    const a = await joinEditor(hub, "main.loom", "a");
    expect(a.ytext.toString()).toBe("# Title\n\n== start\n");
  });

  it("fans an edit out to the other editors (never echoing to the sender)", async () => {
    const { storage } = memoryStorage({ "main.loom": "hello\n" });
    const hub = new CollabHub(storage, 10);
    const a = await joinEditor(hub, "main.loom", "a");
    const b = await joinEditor(hub, "main.loom", "b");

    a.ytext.insert(0, "# heading\n");
    await Promise.resolve(); // let the update POST settle
    b.drain();
    expect(b.ytext.toString()).toBe("# heading\nhello\n");
    // The sender got nothing back for its own edit.
    expect(a.events.filter((e) => e.event === "update")).toHaveLength(0);
  });

  it("merges concurrent edits from two editors into the same text", async () => {
    const { storage } = memoryStorage({ "main.loom": "alpha\nomega\n" });
    const hub = new CollabHub(storage, 10);
    const a = await joinEditor(hub, "main.loom", "a");
    const b = await joinEditor(hub, "main.loom", "b");

    // Both type "at the same time" in different places.
    a.ytext.insert(0, "A writes here\n");
    b.ytext.insert(b.ytext.length, "B writes here\n");
    await Promise.resolve();
    a.drain();
    b.drain();
    await Promise.resolve();
    a.drain();
    b.drain();

    expect(a.ytext.toString()).toBe(b.ytext.toString());
    expect(a.ytext.toString()).toContain("A writes here");
    expect(a.ytext.toString()).toContain("B writes here");
    expect(a.ytext.toString()).toContain("alpha\nomega");
  });

  it("persists the merged text back to storage on flush", async () => {
    const { storage, files } = memoryStorage({ "main.loom": "x\n" });
    const hub = new CollabHub(storage, 10);
    const a = await joinEditor(hub, "main.loom", "a");
    a.ytext.insert(0, "edited ");
    await Promise.resolve();
    await hub.flush("p1");
    expect(files.get("p1/main.loom")).toBe("edited x\n");
  });

  it("adopts a plain files-API write into the live doc instead of clobbering", async () => {
    const { storage, files } = memoryStorage({ "main.loom": "one\ntwo\n" });
    const hub = new CollabHub(storage, 10);
    const a = await joinEditor(hub, "main.loom", "a");

    // A legacy client PUT the whole file with a middle line added…
    files.set("p1/main.loom", "one\nmiddle\ntwo\n");
    hub.adoptExternalWrite("p1", "main.loom", "one\nmiddle\ntwo\n");
    a.drain();
    expect(a.ytext.toString()).toBe("one\nmiddle\ntwo\n");

    // …and a live edit landing after still merges with it.
    a.ytext.insert(0, "# t\n");
    await Promise.resolve();
    await hub.flush("p1");
    expect(files.get("p1/main.loom")).toBe("# t\none\nmiddle\ntwo\n");
  });

  it("notifyEvent fans a run transition to every open editor of the project", async () => {
    const { storage } = memoryStorage({ "main.loom": "x\n" });
    const hub = new CollabHub(storage, 10);
    const a = await joinEditor(hub, "main.loom", "a");
    const b = await joinEditor(hub, "main.loom", "b");
    hub.notifyEvent("p1", { kind: "launched", by: "Ada", eventId: "evt-1", mode: "preview" });
    hub.notifyEvent("p2", { kind: "ended", by: "Bo", eventId: "evt-2", mode: "live" }); // another project — silent here
    for (const c of [a, b]) {
      const frames = c.events.filter((e) => e.event === "event").map((e) => e.data);
      expect(frames).toEqual([{ kind: "launched", by: "Ada", eventId: "evt-1", mode: "preview" }]);
    }
  });

  it("drops a deleted file's doc without persisting it back", async () => {
    const { storage, files } = memoryStorage({ "gone.loom": "bye\n" });
    const hub = new CollabHub(storage, 10);
    const a = await joinEditor(hub, "gone.loom", "a");
    a.ytext.insert(0, "unsaved ");
    files.delete("p1/gone.loom"); // the DELETE route removed the row
    hub.dropDoc("p1", "gone.loom");
    await hub.flush("p1");
    expect(files.has("p1/gone.loom")).toBe(false);
  });

  it("replaceIntoYText splices minimally so out-of-region edits survive", () => {
    const doc1 = new Y.Doc();
    const t1 = doc1.getText("content");
    t1.insert(0, "line one\nline two\nline three\n");
    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
    const t2 = doc2.getText("content");

    // Doc1 replaces the middle line wholesale (a graph-edit style write);
    // doc2 concurrently edits the last line.
    replaceIntoYText(t1, "line one\nline 2\nline three\n");
    t2.insert(t2.toString().indexOf("three"), "number ");
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1, Y.encodeStateVector(doc2)));
    Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2, Y.encodeStateVector(doc1)));

    expect(t1.toString()).toBe("line one\nline 2\nline number three\n");
    expect(t2.toString()).toBe(t1.toString());
  });
});
