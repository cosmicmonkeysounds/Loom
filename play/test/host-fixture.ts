//! A hand-built host view (CONTRACTS §2.6) for the host lane's tests.

import type { HostView } from "../src/types.ts";

export function hostFixture(over: Partial<HostView> = {}): HostView {
  return {
    title: "Fixture Night",
    theme: "aol97",
    interactions: [
      { id: "call_everyone", label: "C1 · 📣 Call everyone to the Desktop", who: "admin", act: "B · Act I: the Desktop" },
      { id: "start_bingo", label: "V2 · 🎱 Start Computer Bingo", who: "admin" },
      { id: "spin_the_bottle", label: "🍾 Spin the bottle", who: "admin", sequence: false },
      { id: "award_best_liar", label: "G7 · 🎭 Best liar", who: "admin", subject: true, act: "G · Ceremony" },
      { id: "force_majority", label: "🗳 Force the majority", who: "admin", sequence: false, act: "Anytime" },
    ],
    cues: { last: null, fired: [], presses: 0, pressed: null },
    world: [{ path: "Night.phase", value: "\"arrivals\"" }],
    roster: [
      { id: "g1", name: "Ada", location: "The Desktop" },
      { id: "g2", name: "Bob", location: null },
    ],
    clock: 60_000,
    countdowns: [{ label: "Hunt", endsAt: 120 }],
    runtime: "open",
    needs: [
      { kind: "held", key: "held", text: "💰 1 held transfer", target: "wallet" },
      { kind: "no-worker", key: "agent:Trabolta", text: "🤖 Trabolta: no worker", target: "agent", character: "Trabolta" },
    ],
    judging: {
      mode: "auto",
      judge: "Trabolta",
      confirm: { accurate: "fact_accurate", lie: "fact_lie", uncertain: "fact_uncertain" },
      pending: [
        { person: "g1", name: "Ada", question: "Q1", answer: "Mr Pickels", confidence: 100, proposed: "accurate", final: null, at: 10, near: "Mr. Pickles", asking: false, ruling: null },
      ],
      near: 1,
      recent: [],
    },
    wallet: { name: "Truthcoin", held: [{ id: "t1", fromName: "Ada", toName: "Bob", amount: 20, settleAt: null }], frozen: [], stimulus: { uses: 0, limit: 3 } },
    king: { hp: 15, max: 15, fallen: false },
    terminals: { voiceMuted: false, silentMs: 20_000, rows: [{ name: "Kitchen", agoMs: 3000, view: "face" }, { name: "Server Door", agoMs: 45_000, view: "chess" }] },
    agents: [{ id: "Trabolta", online: false, queue: null, waiting: [{ guest: "g1", name: "Ada", since: 0, text: "Are you there?" }] }],
    parts: [
      { id: "Norton", presence: "online" },
      { id: "McAfee", presence: "free" },
    ],
    people: [
      { id: "g1", name: "Ada", location: "The Desktop", online: true, lastSeen: 0, restricted: false, captured: false, flags: [{ label: "Bathroom", path: "Program.afk", value: "true", on: true }] },
      { id: "g2", name: "Bob", location: "The Tube", online: false, lastSeen: null, restricted: true, captured: false },
    ],
    alerts: { path: "Night.alerts", level: "sticky" },
    staffRooms: ["room:hosts"],
    ...over,
  };
}
