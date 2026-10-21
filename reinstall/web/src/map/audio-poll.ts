//! The map page's long poll on the speaker config (`GET /api/mod/audio
//! ?after=&tests=&wait=`), transport-free so its pacing is tested.
//!
//! `after` is the **newest version the server reported**, not the one the
//! page holds: a page that declines another director's save (it has speaker
//! edits of its own, or is saving) still holds the old version, and asking
//! `after=<old>` again would be answered at once, forever. The page only
//! adopts that version on a Reload. And an answer the page adopted nothing
//! from waits `idleMs` before the next ask, so nothing can spin.

import type { AudioFetch, AudioView } from "./audio-api.ts";

export interface AudioPollDeps {
  /** One GET: no `after` = the plain load. */
  fetch: (q: { after?: string; tests?: number; wait?: number }) => Promise<AudioFetch>;
  /** Hand the page an answer; true when it took something from it (a new config, a new test). */
  onView: (v: AudioView) => boolean;
  /** The server has no speaker routes (a server before wave 17): the poll ends. */
  onMissing: () => void;
  /** The server is away (not a refusal): the poll retries on its backoff. */
  onError: (r: { status: number | null; error: string }) => void;
  /** The newest test seq the page has seen. */
  testSeq: () => number;
  stopped: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  /** The pause after an answer that changed nothing for the page (ms). */
  idleMs?: number;
  wait?: number;
}

const realSleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

/** Run the poll until `stopped()` (or a refusal, or a server without the routes). */
export async function runAudioPoll(d: AudioPollDeps): Promise<void> {
  const sleep = d.sleep ?? realSleep;
  const idleMs = d.idleMs ?? 1000;
  let seen: string | null = null;
  let backoff = 1000;
  while (!d.stopped()) {
    const r = await d.fetch(seen === null ? {} : { after: seen, tests: d.testSeq(), wait: d.wait ?? 25 });
    if (d.stopped()) return;
    if (r.kind === "ok") {
      backoff = 1000;
      const took = d.onView(r.view);
      seen = r.view.version;
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
