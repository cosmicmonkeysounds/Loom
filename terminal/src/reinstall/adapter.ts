//! The terminal's config as the reinstall flow reads it (wave 18b): the
//! same event, token and name (the begin journals `reinstallation begun`
//! `by` this terminal's name), the role `both` (play here, or send to a
//! headset when one is online), the terminal's camera, arrows that turn, and
//! no voice link (wave 19: the tent laptop sits beside the headsets).

import type { ReinstallConfig } from "@loom/reinstall/config.ts";
import type { TerminalConfig } from "../config.ts";

export function reinstallConfigOf(c: Pick<TerminalConfig, "eventId" | "title" | "token" | "name" | "camera">): ReinstallConfig {
  return { eventId: c.eventId, title: c.title, token: c.token, name: c.name, role: "both", camera: c.camera, arrowsTurn: true, voice: false };
}
