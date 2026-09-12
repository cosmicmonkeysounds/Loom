//! Building the conversation the model sees for one guest.
//!
//! The system prompt is the persona plus a live *state block*: the
//! character's variables, what the character knows (their codex — which
//! grows as guests share lore with them), who the guest is and what the
//! guest knows. Then the recent DM thread with that guest, as alternating
//! user / assistant turns.

import type { Persona } from "./persona.ts";

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

/** A codex entry as the server projects it (`CodexEntryView`). */
export interface Entry {
  id: string;
  title: string;
  about: string | null;
  text: string;
}

export interface GuestContext {
  id: string;
  name: string;
  /** Their public group, if any. */
  faction: string | null;
  /** Entries the guest holds. */
  codex: Entry[];
  /** Selected world facts about them (`humanity`, `truth`, …). */
  facts: Record<string, string>;
}

export interface MindState {
  /** `<character>.<variable>` → current value. */
  variables: Record<string, number>;
  /** Entries the character holds. */
  codex: Entry[];
  /** Any other world facts worth telling the model (`Night.phase`, …). */
  facts: Record<string, string>;
}

/** One line of the DM thread, oldest first. */
export interface ThreadLine {
  /** True when the character said it. */
  mine: boolean;
  text: string;
}

export function buildMessages(persona: Persona, state: MindState, guest: GuestContext, thread: ThreadLine[], maxTurns = 16): ChatTurn[] {
  const out: ChatTurn[] = [{ role: "system", content: `${persona.system}\n\n${stateBlock(persona, state, guest)}` }];
  const recent = thread.slice(-maxTurns);
  for (const line of recent) out.push({ role: line.mine ? "assistant" : "user", content: line.text });
  // A thread always ends on the guest's line (that's why we're answering).
  if (recent.length === 0 || recent[recent.length - 1]!.mine) out.push({ role: "user", content: "(the guest is waiting)" });
  return out;
}

export function stateBlock(persona: Persona, state: MindState, guest: GuestContext): string {
  const lines: string[] = ["=== LIVE STATE (do not quote numbers to the guest) ==="];
  const vars = persona.variables.map((v) => `${v}=${state.variables[v] ?? "?"}`);
  if (vars.length > 0) lines.push(`Your variables: ${vars.join(", ")}`);
  for (const [k, v] of Object.entries(state.facts)) lines.push(`${k}: ${v}`);
  lines.push(`You are talking to: ${guest.name}${guest.faction ? ` (${guest.faction})` : ""}`);
  for (const [k, v] of Object.entries(guest.facts)) lines.push(`Their ${k}: ${v}`);
  lines.push(
    guest.codex.length > 0
      ? `They know: ${guest.codex.map((e) => e.title).join("; ")}`
      : "They know nothing yet.",
  );
  if (state.codex.length > 0) {
    lines.push("What you know (your codex — shared lore has changed you):");
    for (const e of state.codex) lines.push(`- ${e.title}: ${oneLine(e.text)}`);
  }
  return lines.join("\n");
}

function oneLine(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}
