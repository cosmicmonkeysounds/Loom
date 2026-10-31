// Barrel (wave 13): the room-id / space helpers live in `rooms/spaces.ts`,
// the message runs + Slack-style threads in `stream/runs.ts`, the unread /
// active-thread state in `rooms/threads-state.ts`. Every old name still
// resolves here; new code imports the concrete module.

export { CODEX_ROOM, PINNED_SPACE, QUEST_LOG, SPACES, STORY_SPACE, WALLET_ROOM, channelHead, groupBySpace, prettyName, spaceTitle, withThe, type SpaceGroup } from "./rooms/spaces.ts";
export { RUN_WINDOW_MS, groupByChannel, groupRuns, questStatusOf, questSummary, repliesFor, replyCountFor, rootsOf, type MessageRun } from "./stream/runs.ts";
export { advanceMarks, useThreads, type ReadMarkPersist, type ReadMarkStore, type Threads } from "./rooms/threads-state.ts";
