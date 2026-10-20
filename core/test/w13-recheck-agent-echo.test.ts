//! Wave 13 recheck review — item 3: after a restart, a worker's reply
//! answers the thread whatever it says. A reply that happens to repeat a
//! line the story posted in his name ("The last facts, Calculator.") is
//! still him answering: live the hub settled it, so the restore must not
//! re-ask it (a second answer).

import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import type { EventRuntime } from "../server/event-runtime.ts";
import { call, cleanup, freshDir, guest, mod, post, runtime } from "./w13-fix-harness.ts";
import { STORY, waitingOf } from "./w13-recheck-story.ts";

afterAll(cleanup);

/** A worker stream voicing Trabolta; `requests()` reads its request frames. */
function workerStream(rt: EventRuntime) {
  let buf = "";
  const res = {
    statusCode: 0,
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    setHeader() {},
    write(c: unknown) {
      buf += String(c);
      return true;
    },
    end() {
      return res;
    },
    on() {},
    once() {},
  };
  const req = { headers: {}, on() {}, once() {}, [Symbol.asyncIterator]: async function* () {} } as unknown as IncomingMessage;
  void rt.handle(req, res as unknown as ServerResponse, "GET", "/api/agent/stream", new URL("http://x/api/agent/stream?characters=Trabolta&name=laptop"), { moderator: true });
  return {
    requests: () =>
      buf
        .split("\n\n")
        .filter((f) => f.startsWith("event: request\n"))
        .map((f) => JSON.parse(f.slice(f.indexOf("data: ") + 6)) as { id: string; thread: { audience: string[] } }),
  };
}

describe("3: a worker's reply that repeats a story line still answers", () => {
  it("no re-ask after a restart", async () => {
    const d = freshDir();
    const rt = runtime({ hostViewMs: 0 }, d, STORY);
    rt.openDoors();
    const a = await guest(rt, "Calculator");
    // The story's line in his name first, then the guest asks.
    expect((await mod(rt, "/api/mod/signal", { name: "poke", subject: a.id })).status).toBe(200);
    const w = workerStream(rt);
    expect((await post(rt, "/api/guest/say", { token: a.token, channel: "dm:Trabolta", text: "what facts?" })).status).toBe(200);
    const r = w.requests().find((q) => q.thread.audience[0] === a.id);
    expect(r).toBeDefined();
    // The worker answers with exactly the story's earlier text.
    const reply = await call(rt, "POST", "/api/agent/reply", { id: r!.id, say: "The last facts, Calculator." }, { moderator: true });
    expect(reply.status).toBe(200);
    expect(await waitingOf(rt)).toEqual([]);
    rt.dispose();
    const rt2 = runtime({ hostViewMs: 0 }, d, STORY);
    rt2.restore();
    expect(await waitingOf(rt2)).toEqual([]);
    rt2.dispose();
  });
});
