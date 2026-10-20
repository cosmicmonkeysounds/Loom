//! The crawl's half of each session's stream handlers (wave 13), pulled out
//! of `useGuestSession` / `usePrimeSession` so the wiring is testable
//! without a DOM: every live `message` frame is offered to the crawl at
//! arrival with the viewer, and a history frame sets the crawl's baseline
//! (the backlog never crawls). The sessions spread these into the handler
//! object they give `useChatStream`.

import { maxSeqOf } from "../alerts.ts";
import type { ChatStreamHandlers } from "../client.ts";
import type { Crawl } from "../host.ts";
import type { ChatMessage } from "../types.ts";

/** Who is watching, as `Crawl.arrived` takes it. */
export interface CrawlViewer {
  id: string;
  name: string;
}

export type CrawlStreamHandlers = Required<Pick<ChatStreamHandlers, "onMessage" | "onHistory">>;

/** `onMessage` → `crawl.arrived(m, viewer)`; `onHistory` → `then(list)` and
 *  `crawl.loaded(max seq)`. */
export function crawlStreamHandlers(
  crawl: Crawl,
  viewer: CrawlViewer | null,
  then: (list: ChatMessage[]) => void,
): CrawlStreamHandlers {
  return {
    onMessage: (m) => crawl.arrived(m, viewer),
    onHistory: (list) => {
      then(list);
      crawl.loaded(maxSeqOf(list)); // the backlog never crawls; only what lands from now on
    },
  };
}

/** A guest watches as itself: its public id (never the token) and its name. */
export function guestStreamHandlers(
  crawl: Crawl,
  me: { id: string; name: string } | null,
  then: (list: ChatMessage[]) => void,
): CrawlStreamHandlers {
  return crawlStreamHandlers(crawl, me !== null ? { id: me.id, name: me.name } : null, then);
}

/** A booth watches as its character (id and name are both the character). */
export function primeStreamHandlers(
  crawl: Crawl,
  auth: { character: string } | null,
  then: (list: ChatMessage[]) => void,
): CrawlStreamHandlers {
  return crawlStreamHandlers(crawl, auth !== null ? { id: auth.character, name: auth.character } : null, then);
}
