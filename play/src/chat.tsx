//! Barrel (wave 13): the chat primitives moved into concrete modules —
//! `ui/primitives.tsx` (atoms, sheets), `moments/banner.tsx`,
//! `moments/pins-rail.tsx`, `rooms/list.tsx` (the room list + shell),
//! `stream/bubble.tsx`, `stream/list.tsx`, `stream/composer.tsx` and
//! `stream/channel-view.tsx`. Every old name still resolves here; new code
//! imports the concrete module (a barrel import invites cycles).

export {
  ActionRow,
  Avatar,
  Badge,
  ConnDot,
  GroupPill,
  InviteSheet,
  PersonAvatar,
  PickerSheet,
  SessionEnded,
  Sheet,
  WIDE,
  WakeLockToggle,
  colorFor,
  connLabel,
  initialsOf,
  plural,
  useMediaQuery,
  useWide,
  type PickItem,
} from "./ui/primitives.tsx";
export { AlertBanner } from "./moments/banner.tsx";
export { PinnedRail } from "./moments/pins-rail.tsx";
export { ChannelRow, Shell, SpaceList } from "./rooms/list.tsx";
export { CardActionsProvider, MessageBubble, MessageGroup, type CardActions, type ModerateHook, type WidgetHook } from "./stream/bubble.tsx";
export { MessageList, STICK_SLACK, atBottom, useStickToBottom } from "./stream/list.tsx";
export { CHAT_TEXT_MAX, Composer, RESTRICTED_ROOM_NOTE, cantPostNote, sendFromComposer } from "./stream/composer.tsx";
export { ChannelView, DecisionTray, MessageThread, PresenceStrip } from "./stream/channel-view.tsx";
