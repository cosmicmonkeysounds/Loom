//! Wave 13 recheck, lane ccore: the small story and helpers the recheck
//! tests share (a host part, two Antivirus whose scans the story may refuse,
//! a `playable: false` prop and an agent-voiced Trabolta with a hold line).

import type { HostView } from "../src/host-board.ts";
import type { EventRuntime } from "../server/event-runtime.ts";
import { call } from "./w13-fix-harness.ts";

export const STORY = `# Recheck Night
start: Opening

ROLE Program
  uploaded: bool = false

GROUP Hosts
  joinable: false

CHANNEL hosts
  kind: faction
  faction: Hosts

LOCATION Hall

CHARACTER Task Manager
  faction: Hosts
  admin: true
  when greet for program:
    reply Hello {program.name}.

CHARACTER Clippy
  faction: Hosts
  when answered for program:
    if Night.bottle_open == true:
      reply Accepted.
    else:
      broadcast "🗣 The bottle is not on {program.name}." to channel(hosts)

CHARACTER McAfee
  when scanned by program:
    if Night.scan_open == true:
      reply Clean: {program.name}.
    else:
      broadcast "🗣 Not now: {program.name}." to channel(hosts)

CHARACTER Norton
  when scanned by program:
    Self: Hello there.

CHARACTER Lamp
  playable: false

CHARACTER Trabolta
  mind: external
  hold: One moment.

INTERACTION answered
  who: performer

INTERACTION greet
  who: performer

INTERACTION open the doors
  who: admin

when poke for program:
  Trabolta: The last facts, {program.name}.

== Opening
  setting: Hall
Hello.
`;

export const hostRead = async (rt: EventRuntime): Promise<HostView> => (await call(rt, "GET", "/api/state?role=mod&host=1", {}, { moderator: true })).json as unknown as HostView;
export const waitingOf = async (rt: EventRuntime) => (await hostRead(rt)).agents.find((a) => a.id === "Trabolta")?.waiting ?? [];

