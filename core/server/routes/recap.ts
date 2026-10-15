//! K-26 — `GET /e/:id/api/mod/recap` (directors only; the auth check stays
//! in `EventRuntime`). JSON by default; `?format=text` returns just the
//! paste-ready block as `text/plain`, so a director can open the link in a
//! browser tab and copy it straight into the ceremony.

import type { ServerResponse } from "node:http";
import type { Sim } from "../../src/runtime/sim/index.ts";
import { sendJson } from "../http-util.ts";
import { computeRecap, type RecapOptions } from "../recap.ts";

export function sendRecap(res: ServerResponse, url: URL, sim: Sim | null, opts: RecapOptions): void {
  if (sim === null) {
    sendJson(res, 409, { error: "no scenario loaded" });
    return;
  }
  const recap = computeRecap(sim, opts);
  if (url.searchParams.get("format") === "text") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(recap.text);
    return;
  }
  sendJson(res, 200, recap);
}
