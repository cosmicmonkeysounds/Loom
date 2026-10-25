//! A hand-built `DeskView` (docs/loom-house-desk.md §2.1, core's
//! `house-desk.ts`) for the Desk window's tests: two sections of cues, one
//! running run, a speaker, an output, a story sound with no file, a colour
//! bulb and a look.

import type { DeskView } from "../../core/src/house-desk.ts";

export function deskFixture(over: Partial<DeskView> = {}): DeskView {
  return {
    desk: {
      version: 1,
      cues: [
        { id: "pre_show", number: "1", name: "Pre-show hum", section: "Pre-show", steps: [{ kind: "sound", sound: "server_hum", to: ["The Server Room"] }, { kind: "wait", ms: 2000 }] },
        { id: "doors", number: "2", name: "Doors", steps: [{ kind: "say", text: "The doors are open" }] },
        {
          id: "heart_reveal",
          number: "12",
          name: "The Heart wakes",
          section: "The Heart",
          notes: "Stand by the door",
          done: "heart_reveal_done",
          steps: [
            { kind: "look", look: "heart_wake" },
            { kind: "sound", sound: "server_hum", to: ["The Server Room"], start: "with", wait: 500 },
            { kind: "event", event: "heart_speaks" },
            { kind: "speech", room: "The Server Room", start: "with", max: 30000 },
          ],
        },
      ],
    },
    version: "abc123",
    source: "project",
    problems: [],
    warnings: [],
    rev: 7,
    now: 100_000,
    standby: "heart_reveal",
    runs: [
      {
        run: 3,
        cue: "pre_show",
        name: "Pre-show hum",
        by: "Director",
        source: "desk",
        startedAt: 90_000,
        group: 0,
        steps: [
          { i: 0, group: 0, state: "running", startAt: 90_000, endAt: 110_000 },
          { i: 1, group: 1, state: "pending", startAt: null, endAt: null },
        ],
        state: "running",
        endedAt: null,
      },
      {
        run: 2,
        cue: "doors",
        name: "Doors",
        by: "Task Manager",
        source: "desk",
        startedAt: 50_000,
        group: 0,
        steps: [{ i: 0, group: 0, state: "ended", startAt: 50_000, endAt: 50_100, result: "no-file" }],
        state: "done",
        endedAt: 50_100,
      },
    ],
    marks: { "speaker:living_l": { mark: "ok", by: "Director", at: 40_000 } },
    live: false,
    house: {
      router: { online: true, lastSeen: 99_000, name: "house-mac" },
      health: { at: 99_000, ok: true, device: "MOTU 828x", layout: "ok", voices: 0, xruns: 0, peakDb: null, announce: "on", missing: ["server_hum"], placeholders: [], files: 4 },
      speakers: [
        { id: "living_l", name: "Living L", room: "living", roomName: "Living room", out: [1] },
        { id: "server_spk", name: "Server room", room: "server", roomName: "Server room", out: [3] },
      ],
      outputs: [{ ch: 1, label: "Out 1" }],
      zones: [],
      sounds: [{ name: "server_hum", to: ["server_spk"], file: "missing", ms: null }],
      audioTargets: ["living_l", "server_spk", "everywhere"],
      lightsModule: { online: true, lastSeen: 99_000, name: "desktop" },
      fixtures: [{ id: "server_room_rgb", name: "Server RGB", room: "server", roomName: "Server room", kind: "bulb", caps: { color: true, ct: true, dim: true }, safety: false, device: "server_room_rgb", inZ2m: true }],
      lightZones: [],
      looks: [{ name: "heart_wake", to: ["server_room_rgb"], ms: 3000, loop: false }],
      lightTargets: ["server_room_rgb", "everywhere"],
      pairUntil: null,
      rooms: ["The Server Room"],
      events: ["heart_speaks", "heart_reveal_done"],
    },
    recent: [
      { at: 95_000, kind: "go", text: "GO 1 · Pre-show hum", by: "Director" },
      { at: 50_100, kind: "play", text: "📢 The doors are open", by: "Task Manager", result: "no-file" },
    ],
    ...over,
  };
}
