//! The shared story of the wave 18 core tests: a small night with the new
//! header lines (`wanted:`, `reinstall:`, `archive:`), booth objectives with
//! `target:` / `pick:`, an evergreen guest objective with `go:`, a global
//! booth button and Clippy's `by:` admin cues — run through the wave 13
//! fix-round harness's EventRuntime + route callers.

import type { EventRuntime } from "../server/event-runtime.ts";
import { freshDir, runtime as baseRuntime } from "./w13-fix-harness.ts";

export * from "./w13-fix-harness.ts";

export const W18 = `# Wave 18 Night
start: Opening
wanted: program.marked as program.marked_for by program.escort_by, for Antivirus
reinstall: program.marked == true or program.corrupted == true or Night.ended == true
archive: The Uploader when program.cleared == true
archive: # arrival when program.cleared == true

ROLE Program
  marked: bool = false
  marked_for: text = ""
  escort_by: text = ""
  corrupted: bool = false
  cleared: bool = false

GROUP Antivirus
  joinable: false

GROUP Hosts
  joinable: false

LOCATION The Desktop

LOCATION The Internet
  prison: true

LOCATION Server Room
  hidden: true

CHANNEL arrival
  kind: open

CHANNEL hosts
  kind: faction
  faction: Hosts

CHARACTER Norton
  faction: Antivirus
  when mark_program for program:
    set program.marked = true
    set program.marked_for = "Lied about the cat"
  when claim_escort for program:
    set program.escort_by = "Norton"
  when send_to_internet for program:
    capture program into The Internet

CHARACTER McAfee
  faction: Antivirus
  when scanned by program:
    reply Clean.

CHARACTER Clippy
  faction: Hosts
  when scanned by program:
    reply Hello {program.name}.

CHARACTER Task Manager
  faction: Hosts
  admin: true
  when scanned by program:
    reply Seen.

CHARACTER The Uploader

INTERACTION mark_program
  label: 🚨 Mark
  who: performer
  by: Antivirus

INTERACTION claim_escort
  label: 🙋 I'll get them
  who: performer
  by: Antivirus

INTERACTION send_to_internet
  label: 🛡 Send to the Internet
  who: performer
  by: Antivirus

INTERACTION ring_the_bell
  label: 🔔 Ring the bell
  who: performer

INTERACTION i_have_bingo
  label: 🎱 I have BINGO
  who: guest

INTERACTION call_to_the_desktop
  label: C1 · 📣 Call everyone
  who: admin
  description: Everyone to the Desktop.

INTERACTION start_bingo
  label: B1 · 🎱 Start the Bingo
  who: admin
  by: Clippy
  description: Clippy deals the cards.

INTERACTION bingo_time
  label: B2 · ⏰ Bingo time
  who: admin
  by: Clippy
  description: The winners come up.

INTERACTION the_bottle
  label: B3 · 🍾 Spin
  who: admin
  description: The bottle picks someone.

INTERACTION the_summary
  label: B4 · 📊 Summary
  who: admin
  description: What happened.

INTERACTION end_the_night
  label: E · 🌙 End
  who: admin
  description: Goodnight.

OBJECTIVE Explore The Computer
  for: guests
  evergreen: true
  go: The Desktop
  text: Look around the house.

OBJECTIVE Celebrate The Winners
  for: Clippy
  pick: program.location == "The Desktop"
  target: Night.bottle_pick
  text:
    - 🎱 Who shouted BINGO?

OBJECTIVE Hunt
  for: Antivirus
  text: Find the marked.

when ring_the_bell:
  broadcast "🔔 Ding." to everyone

when call_to_the_desktop:
  broadcast "!Come to the Desktop." to everyone
  broadcast "Called." to channel(hosts)

when start_bingo:
  broadcast "🎱 Bingo is on." to everyone

when end_the_night:
  set Night.ended = true

== Opening
  setting: The Desktop
Hello.
`;

export function rt18(dir: string = freshDir()): EventRuntime {
  return baseRuntime({}, dir, W18);
}
