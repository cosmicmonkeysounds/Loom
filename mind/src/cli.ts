#!/usr/bin/env -S npx tsx
//! `loom-mind` — give a CHARACTER a mind for the night.
//!
//!   pnpm --filter @loom/mind start -- \
//!     --server https://party.example.com --event <eventId> \
//!     --mod-code MOD123 --persona ../core/examples/trapped-in-the-internet/trabolta.persona.md
//!
//! Flags (env fallbacks in parentheses):
//!   --server URL        the event server (LOOM_SERVER, default http://localhost:7000)
//!   --event ID          the event id (LOOM_EVENT, default `default`)
//!   --mod-code CODE     the moderator passcode (LOOM_MOD_CODE)
//!   --mod-token TOKEN   an existing mod token instead of a passcode (LOOM_MOD_TOKEN)
//!   --persona FILE      the persona markdown (required)
//!   --model NAME        override the persona's model
//!   --endpoint URL      override the persona's OpenAI-compatible endpoint
//!   --api-key KEY       bearer token for a hosted endpoint (LLM_API_KEY)
//!   --dry-run           print replies + adjustments, send nothing
//!   --say GUEST_ID      answer one guest once (from current state), then exit

import { readFileSync } from "node:fs";
import { Mind } from "./bridge.ts";
import { ModClient } from "./mod-api.ts";
import { parsePersona } from "./persona.ts";

function arg(name: string, env?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  return env !== undefined ? process.env[env] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const personaPath = arg("persona");
  if (!personaPath) {
    process.stderr.write("usage: loom-mind --persona <file.md> [--server URL] [--event ID] [--mod-code CODE] [--dry-run]\n");
    process.exit(2);
  }
  const persona = parsePersona(readFileSync(personaPath, "utf8"));
  const client = new ModClient({
    server: arg("server", "LOOM_SERVER") ?? "http://localhost:7000",
    event: arg("event", "LOOM_EVENT") ?? "default",
    passcode: arg("mod-code", "LOOM_MOD_CODE"),
    token: arg("mod-token", "LOOM_MOD_TOKEN"),
  });
  const mind = new Mind({
    client,
    persona,
    model: arg("model"),
    endpoint: arg("endpoint"),
    apiKey: arg("api-key", "LLM_API_KEY"),
    dryRun: flag("dry-run"),
  });
  process.stderr.write(
    `🧠 ${persona.character} · model ${arg("model") ?? persona.model} @ ${arg("endpoint") ?? persona.endpoint}` +
      `${flag("dry-run") ? " · DRY RUN" : ""}\n`,
  );
  const once = arg("say");
  if (once) {
    const reply = await mind.answer(once);
    process.stdout.write(JSON.stringify(reply, null, 2) + "\n");
    return;
  }
  const ac = new AbortController();
  process.on("SIGINT", () => ac.abort());
  process.on("SIGTERM", () => ac.abort());
  await mind.run(ac.signal);
}

main().catch((e: unknown) => {
  process.stderr.write(`loom-mind: ${(e as Error).message}\n`);
  process.exit(1);
});
