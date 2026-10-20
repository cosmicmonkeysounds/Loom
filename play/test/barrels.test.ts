//! Wave 13 Stage A turned the hub files into barrels: every name they
//! exported before (dd83e13) still resolves from them, to the very same
//! value the concrete module exports. (Types are checked by `tsc`.)

import { describe, expect, it } from "vitest";

const OLD: Record<string, string[]> = {
  "../src/chat.tsx": [
    "ActionRow", "AlertBanner", "Avatar", "Badge", "CHAT_TEXT_MAX", "CardActionsProvider", "ChannelRow", "ChannelView", "Composer", "ConnDot",
    "DecisionTray", "GroupPill", "InviteSheet", "MessageBubble", "MessageGroup", "MessageList", "MessageThread", "PersonAvatar", "PickerSheet",
    "PinnedRail", "PresenceStrip", "RESTRICTED_ROOM_NOTE", "STICK_SLACK", "SessionEnded", "Sheet", "Shell", "SpaceList", "WIDE", "WakeLockToggle",
    "atBottom", "cantPostNote", "colorFor", "connLabel", "initialsOf", "plural", "sendFromComposer", "useMediaQuery", "useStickToBottom", "useWide",
  ],
  "../src/session.ts": [
    "INBOX", "RESERVED_POLL_MS", "SAY_TIMEOUT_MS", "actFeedback", "buildGuestChannels", "buildPrimeChannels", "choiceEcho", "codeFromUrl",
    "defectTargets", "fetchIdentities", "fetchLanding", "fetchPictures", "hasPendingCard", "isListedRoom", "isPinnedRoom", "landingBrand",
    "pendingWidget", "perSessionUpdate", "perSessionValue", "personalStream", "reaskReason", "registerBody", "requiredDecision", "resolveCode",
    "retryDelay", "sayRefusalText", "searchPrograms", "useDocumentTitle", "useGuestSession", "useIdentities", "useLandingBrand", "usePrimeSession",
    "useTheme", "withAgents", "withEchoes",
  ],
  "../src/threads.ts": [
    "prettyName", "withThe", "channelHead", "STORY_SPACE", "PINNED_SPACE", "CODEX_ROOM", "QUEST_LOG", "WALLET_ROOM", "SPACES", "spaceTitle",
    "groupBySpace", "RUN_WINDOW_MS", "groupRuns", "rootsOf", "repliesFor", "replyCountFor", "questStatusOf", "questSummary", "groupByChannel",
    "advanceMarks", "useThreads",
  ],
  "../src/guest.tsx": ["GuestApp", "homeChannel", "useCutscene"],
  "../src/performer.tsx": ["PerformerApp", "boothHome", "splitInteractions"],
  "../src/presence.ts": ["occupantsByLocation", "locationOfRoom", "roomOrder", "occupancyLabel"],
  "../src/host.ts": ["createCrawl", "memoryStore", "browserHost", "PlayHostContext", "usePlayHost"],
};

/** Where each moved name lives now. */
const HOME: Record<string, string> = {
  PersonAvatar: "../src/ui/primitives.tsx",
  Sheet: "../src/ui/primitives.tsx",
  AlertBanner: "../src/moments/banner.tsx",
  PinnedRail: "../src/moments/pins-rail.tsx",
  SpaceList: "../src/rooms/list.tsx",
  MessageBubble: "../src/stream/bubble.tsx",
  MessageList: "../src/stream/list.tsx",
  Composer: "../src/stream/composer.tsx",
  ChannelView: "../src/stream/channel-view.tsx",
  roomOrder: "../src/rooms/order.ts",
  groupBySpace: "../src/rooms/spaces.ts",
  groupRuns: "../src/stream/runs.ts",
  useThreads: "../src/rooms/threads-state.ts",
  createCrawl: "../src/crawl.ts",
  buildGuestChannels: "../src/session/channels.ts",
  useGuestSession: "../src/session/guest.ts",
  usePrimeSession: "../src/session/prime.ts",
  useTheme: "../src/session/shared.ts",
  GuestApp: "../src/guest/app.tsx",
  PerformerApp: "../src/booth/app.tsx",
  splitInteractions: "../src/booth/card.tsx",
};

describe("the barrels", () => {
  for (const [path, names] of Object.entries(OLD)) {
    it(`${path.slice(7)} still exports every old name`, async () => {
      const mod = (await import(path)) as Record<string, unknown>;
      for (const n of names) expect(mod[n], `${path} ${n}`).toBeDefined();
    });
  }

  it("re-export the concrete module's own value", async () => {
    for (const [name, home] of Object.entries(HOME)) {
      const barrel = Object.entries(OLD).find(([, ns]) => ns.includes(name))![0];
      const [a, b] = (await Promise.all([import(barrel), import(home)])) as Array<Record<string, unknown>>;
      expect(a![name], name).toBe(b![name]);
    }
  });
});
