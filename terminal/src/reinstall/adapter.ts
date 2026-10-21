//! The terminal's config as the reinstall flow reads it (wave 18b): the
//! same event, token and name (the begin journals `reinstallation begun`
//! `by` this terminal's name), the role `both` (play here, or send to a
//! headset when one is online), the terminal's camera, and arrows that turn.

import type { ReinstallConfig } from "@loom/reinstall/config.ts";
import type { TerminalConfig } from "../config.ts";

export function reinstallConfigOf(c: Pick<TerminalConfig, "eventId" | "title" | "token" | "name" | "camera">): ReinstallConfig {
  return { eventId: c.eventId, title: c.title, token: c.token, name: c.name, role: "both", camera: c.camera, arrowsTurn: true };
}
