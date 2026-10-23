//! The map page's long poll on the lights config (`GET /api/mod/lights
//! ?after=&tests=&pairs=&devicesAt=&wait=`), transport-free so its pacing is
//! tested. `runAudioPoll`'s rules: `after` is the newest version the server
//! reported (a page that declines another director's save still holds the
//! old one, and asking after it again would answer at once forever), an
//! answer the page took nothing from waits `idleMs`, an away server backs
//! off, a refusal or a server without the routes ends the poll. The other
//! cursors are the newest test / pair seq the page has seen and the last
//! view's `devicesAt` (a device list posted between two polls answers at
//! once, so a newly paired bulb shows up without a wait).

import type { LightsFetch, LightsQuery, LightsView } from "./lights-api.ts";

export interface LightsPollDeps {
  fetch: (q: LightsQuery) => Promise<LightsFetch>;
  /** Hand the page an answer; true when it took something (a config, a test, a pair, new devices). */
  onView: (v: LightsView) => boolean;
  /** The server has no lights routes (a server before wave 20): the poll ends. */
  onMissing: () => void;
  /** The server is away (not a refusal): the poll retries on its backoff. */
  onError: (r: { status: number | null; error: string }) => void;
  testSeq: () => number;
  pairSeq: () => number;
  stopped: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  idleMs?: number;
  wait?: number;
}

const realSleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

export async function runLightsPoll(d: LightsPollDeps): Promise<void> {
  const sleep = d.sleep ?? realSleep;
  const idleMs = d.idleMs ?? 1000;
  let seen: string | null = null;
  let devicesAt: number | null = null;
  let backoff = 1000;
  while (!d.stopped()) {
    const q: LightsQuery = seen === null ? {} : { after: seen, tests: d.testSeq(), pairs: d.pairSeq(), ...(devicesAt !== null ? { devicesAt } : {}), wait: d.wait ?? 25 };
    const r = await d.fetch(q);
    if (d.stopped()) return;
    if (r.kind === "ok") {
      backoff = 1000;
      const took = d.onView(r.view);
      seen = r.view.version;
      if (r.view.devicesAt !== null) devicesAt = r.view.devicesAt;
      if (!took) await sleep(idleMs);
      continue;
    }
    if (r.kind === "missing") return d.onMissing();
    if (r.status === 401 || r.status === 403) return;
    d.onError(r);
    await sleep(backoff);
    backoff = Math.min(backoff * 2, 15_000);
  }
}
