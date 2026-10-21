//! The idle show's popups (wave 17): the kinds of window that pile up over
//! the screensaver — Win98 dialogs, chat toasts, warning boxes and progress
//! dialogs that never finish. Data only; `field.ts` runs their lives and
//! `IdleShow.tsx` draws them. Every button does something (`gag`):
//! `close` (the default), `dodge` (the window jumps away once), `more`
//! (two more windows), `confirm` (it asks "Are you sure?" first).
//!
//! The same pool rules as the ads (`pools.ts`): `{character}` copy only on
//! an awake screen after the introduction; `scan` popups only where there is
//! a scan box to point at.

import type { SfxName } from "../sound/library.ts";
import type { Pooled } from "./pools.ts";

export type PopupStyle = "dialog" | "toast" | "warning" | "progress";
export type PopupIcon = "error" | "warning" | "info" | "question" | "chat" | "duck" | "computer" | "clock" | "coin" | "printer" | "face";
export type PopupGag = "close" | "dodge" | "more" | "confirm";

export interface PopupButton {
  label: string;
  gag?: PopupGag;
}

export interface PopupKind extends Pooled {
  id: string;
  style: PopupStyle;
  icon: PopupIcon;
  title: string;
  text: string;
  buttons: readonly PopupButton[];
  /** Its arrival sound (quiet; dropped while a voice speaks). */
  sound: SfxName;
}

const OK: readonly PopupButton[] = [{ label: "OK" }];

export const POPUP_KINDS: readonly PopupKind[] = [
  // --- all night ---------------------------------------------------------------------
  { id: "pop-low-disk", style: "warning", icon: "warning", title: "Low Disk Space", text: "You are running out of space on drive C:. Delete some memories?", buttons: [{ label: "Yes" }, { label: "Later", gag: "dodge" }], sound: "exclamation" },
  { id: "pop-illegal-op", style: "dialog", icon: "error", title: "PARTY.EXE", text: "This program has performed an illegal operation and will be shut down.", buttons: [{ label: "Close" }, { label: "Details >>", gag: "more" }], sound: "error" },
  { id: "pop-not-responding", style: "dialog", icon: "error", title: "Not Responding", text: "SmallTalk.exe is not responding. Wait for it, or say something interesting.", buttons: [{ label: "End Task" }, { label: "Wait", gag: "dodge" }], sound: "error" },
  { id: "pop-new-hardware", style: "toast", icon: "duck", title: "Found New Hardware", text: "RUBBER DUCK (USB). Installing drivers…", buttons: OK, sound: "chord" },
  { id: "pop-buddy-online", style: "toast", icon: "chat", title: "BuddyChat", text: "NetSurfer99 has signed on.", buttons: OK, sound: "blip" },
  { id: "pop-uh-oh", style: "toast", icon: "chat", title: "BuddyChat — 1 new message", text: "uh-oh! \"r u at the party??\"", buttons: [{ label: "Reply" }], sound: "blip" },
  { id: "pop-virus-found", style: "warning", icon: "warning", title: "Virus Found", text: "PARTY.VBS was found in this house. It looks harmless. It is wearing a tie.", buttons: [{ label: "Quarantine" }, { label: "Ignore", gag: "more" }], sound: "exclamation" },
  { id: "pop-updates", style: "dialog", icon: "info", title: "Updates Ready", text: "Important updates are ready. Restart now?", buttons: [{ label: "Restart now" }, { label: "Restart now", gag: "dodge" }], sound: "ding" },
  { id: "pop-cookies", style: "dialog", icon: "question", title: "Cookies", text: "This house uses cookies. They are at The Start Bar.", buttons: [{ label: "Accept" }, { label: "Accept all" }], sound: "ding" },
  { id: "pop-tip", style: "dialog", icon: "info", title: "Tip of the Day", text: "Did you know? A duck cannot be defragmented. We have tried.", buttons: [{ label: "Next tip", gag: "more" }, { label: "Close" }], sound: "ding" },
  { id: "pop-printer", style: "dialog", icon: "printer", title: "Printer", text: "The printer is out of paper. And toner. And patience.", buttons: [{ label: "Retry", gag: "dodge" }, { label: "Cancel" }], sound: "exclamation" },
  { id: "pop-winner", style: "warning", icon: "coin", title: "WINNER!!!", text: "You have been selected for a FREE nothing. Claim it now before it is gone.", buttons: [{ label: "CLAIM", gag: "more" }], sound: "tada", wall: true },
  { id: "pop-ram-full", style: "dialog", icon: "warning", title: "Memory Full", text: "Your RAM is full. Please forget something.", buttons: [{ label: "Forget" }, { label: "Cancel", gag: "confirm" }], sound: "exclamation" },
  { id: "pop-lonely", style: "dialog", icon: "question", title: "Screensaver", text: "Are you still there? The screensaver is getting lonely.", buttons: [{ label: "I'm here" }], sound: "ding", wall: true },
  { id: "pop-sure", style: "dialog", icon: "question", title: "Confirm", text: "Are you sure you want to be sure?", buttons: [{ label: "Yes" }, { label: "Yes" }, { label: "No", gag: "dodge" }], sound: "ding" },
  { id: "pop-reconnecting", style: "progress", icon: "computer", title: "Connection Lost", text: "Reconnecting at 14.4k… please don't pick up the phone.", buttons: [{ label: "Cancel" }], sound: "static" },
  { id: "pop-drive-a", style: "dialog", icon: "error", title: "Drive A:", text: "There is no disk in drive A:. There has never been a disk in drive A:.", buttons: [{ label: "Retry", gag: "more" }, { label: "Cancel" }], sound: "error" },
  { id: "pop-disk-cleanup", style: "toast", icon: "info", title: "Disk Cleanup", text: "Disk Cleanup is available on two floors.", buttons: OK, sound: "chord" },
  { id: "pop-cpu-hot", style: "warning", icon: "warning", title: "CPU Temperature", text: "Spicy. The Fan Closet is downstairs.", buttons: OK, sound: "exclamation" },
  { id: "pop-download", style: "progress", icon: "computer", title: "Downloading party.zip", text: "99% complete. Estimated time left: forever.", buttons: [{ label: "Cancel", gag: "dodge" }], sound: "modem" },
  { id: "pop-mail", style: "toast", icon: "chat", title: "Mail", text: "You have 1,024 unread messages. 1,023 are about beans.", buttons: OK, sound: "chime" },
  { id: "pop-keyboard", style: "dialog", icon: "error", title: "Keyboard Error", text: "Keyboard not found. Press F1 to continue.", buttons: [{ label: "F1", gag: "more" }], sound: "error" },
  { id: "pop-mouse-moved", style: "dialog", icon: "info", title: "System Settings Change", text: "Your mouse has moved. The house must restart for the change to take effect.", buttons: [{ label: "OK" }, { label: "Restart later", gag: "confirm" }], sound: "ding" },
  { id: "pop-guestbook", style: "toast", icon: "chat", title: "Guestbook", text: "Someone signed your guestbook: \"cool site!!!\"", buttons: OK, sound: "blip" },
  { id: "pop-human", style: "dialog", icon: "question", title: "Quick Survey", text: "How human are you today?", buttons: [{ label: "Very" }, { label: "Somewhat" }, { label: "01001110", gag: "more" }], sound: "ding" },
  { id: "pop-clock", style: "warning", icon: "clock", title: "System Clock", text: "Your clock is wrong. It is probably 1999.", buttons: OK, sound: "exclamation" },
  { id: "pop-wallet", style: "toast", icon: "coin", title: "Wallet", text: "Your Truthcoin misses you. Check your phone's Wallet.", buttons: OK, sound: "coin" },
  { id: "pop-scan-hint", style: "toast", icon: "info", title: "Got a pass?", text: "Open 🎟 Pass on your phone and hold it to the camera in the corner.", buttons: OK, sound: "blip", scan: true },
  // --- the doors ----------------------------------------------------------------------
  { id: "pop-bingo", style: "toast", icon: "info", title: "Computer Bingo", text: "Spotted a computer thing? Mark a square.", buttons: OK, sound: "chord", pools: ["early"] },
  { id: "pop-captcha", style: "dialog", icon: "question", title: "Are You Human?", text: "Please select every square containing a program.", buttons: [{ label: "Verify", gag: "more" }, { label: "Skip" }], sound: "ding", pools: ["early"] },
  // --- the hijack -----------------------------------------------------------------
  { id: "pop-hijack", style: "warning", icon: "error", title: "000. 000. 000.", text: "000. 000. 000. 000. 000. 000.", buttons: [{ label: "OK", gag: "more" }], sound: "glitch", pools: ["malware"] },
  { id: "pop-selected", style: "dialog", icon: "coin", title: "YOU HAVE BEEN SELECTED", text: "A special offer is being downloaded to you. Please do not resist.", buttons: [{ label: "Accept" }, { label: "Decline", gag: "more" }], sound: "critical", pools: ["malware"] },
  { id: "pop-blocker", style: "toast", icon: "info", title: "Pop-up Blocker", text: "Pop-up blocker blocked 0 pop-ups.", buttons: OK, sound: "blip", pools: ["malware"] },
  // --- after the hunts ---------------------------------------------------------------
  { id: "pop-chart-updated", style: "toast", icon: "info", title: "Trust Chart", text: "The Trust Chart has been updated.", buttons: OK, sound: "chord", pools: ["late"], phases: ["trust_chart"] },
  { id: "pop-load-beans", style: "dialog", icon: "printer", title: "Printer", text: "PC LOAD BEANS", buttons: [{ label: "Retry", gag: "more" }, { label: "Cancel" }], sound: "error", pools: ["late"], phases: ["beans", "overshare", "majority"] },
  // --- Y2K -------------------------------------------------------------------------------
  { id: "pop-y2k-countdown", style: "warning", icon: "clock", title: "Y2K", text: "{y2k} until midnight. Is everything saved?", buttons: OK, sound: "tick", pools: ["y2k"] },
  { id: "pop-y2k-1900", style: "dialog", icon: "warning", title: "Year 2000", text: "At midnight your clock may read 1900. Please dress accordingly.", buttons: OK, sound: "exclamation", pools: ["y2k"] },
  { id: "pop-y2k-toaster", style: "dialog", icon: "question", title: "Y2K Compliance", text: "Is your toaster Y2K compliant?", buttons: [{ label: "Yes" }, { label: "It's a toaster", gag: "confirm" }], sound: "ding", pools: ["y2k"] },
  // --- the end of the night ---------------------------------------------------------
  { id: "pop-safe-off", style: "dialog", icon: "computer", title: "Shut Down", text: "It is now safe to turn off your house.", buttons: OK, sound: "chord", pools: ["finale"] },
  { id: "pop-saving", style: "progress", icon: "computer", title: "Please Wait", text: "Saving your settings. This is taking a while because you have so many.", buttons: [{ label: "Cancel", gag: "dodge" }], sound: "ding", pools: ["finale"] },
  // --- the character's own (awake, after the introduction) -------------------------
  { id: "pop-char-friend", style: "dialog", icon: "face", title: "Friend Request", text: "{character} wants to be your friend.", buttons: [{ label: "Accept" }, { label: "Accept", gag: "dodge" }], sound: "ding", names: true },
  { id: "pop-char-typing", style: "toast", icon: "face", title: "{character}", text: "{character} is typing…", buttons: OK, sound: "blip", names: true },
  { id: "pop-char-buddy", style: "toast", icon: "face", title: "BuddyChat", text: "{character} has added you to his buddy list.", buttons: OK, sound: "blip", names: true },
  { id: "pop-char-memories", style: "dialog", icon: "question", title: "{character}.exe", text: "{character}.exe would like to access your memories.", buttons: [{ label: "Allow" }, { label: "Always allow" }], sound: "ding", names: true },
  { id: "pop-char-true", style: "dialog", icon: "face", title: "A Question", text: "{character} would like to know one true thing about you.", buttons: [{ label: "Tell him", gag: "more" }, { label: "Later", gag: "dodge" }], sound: "ding", names: true },
  { id: "pop-char-hi", style: "toast", icon: "face", title: "Message from {character}", text: "\"I see you. Come and say hi.\"", buttons: OK, sound: "blip", names: true, scan: true },
  { id: "pop-char-rate", style: "dialog", icon: "face", title: "{character}.exe", text: "Please rate your conversation with {character}. Only five stars are available.", buttons: [{ label: "★★★★★" }], sound: "chord", names: true },
];

/** A button's text once a `confirm` button has asked. */
export const CONFIRM_TEXT = "Are you sure?";
/** A dodged window's title. */
export const DODGED_TITLE = "Nice try!";
