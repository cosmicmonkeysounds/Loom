//! `pnpm --filter @loom/house goldens` — regenerate the conformance goldens
//! (`test/golden/`) from the fixtures + the show's house map. Commit the
//! result; `test/golden.test.ts` fails when they drift. Then run `sync` so
//! the Godot project gets the same files.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GOLDEN, goldenFiles } from "../test/golden.ts";

const files = goldenFiles();
mkdirSync(GOLDEN, { recursive: true });
for (const f of readdirSync(GOLDEN)) {
  if (f.endsWith(".json") && !files.has(f)) rmSync(join(GOLDEN, f));
}
for (const [name, body] of files) writeFileSync(join(GOLDEN, name), body);
console.log(`wrote ${files.size} goldens to ${GOLDEN}`);
