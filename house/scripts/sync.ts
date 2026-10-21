//! `pnpm --filter @loom/house sync` — copy the show's house map, the
//! goldens and the voice link's vectors into the Godot project
//! (`reinstall/vr/house/house.json`, `reinstall/vr/test/golden/`). `test/sync.test.ts` fails when the copies
//! drift.

import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { GOLDEN, SHOW_HOUSE, VR_GOLDEN, VR_HOUSE } from "../test/golden.ts";
import { VOICE_GOLDEN } from "../test/voice-golden.ts";

mkdirSync(dirname(VR_HOUSE), { recursive: true });
copyFileSync(SHOW_HOUSE, VR_HOUSE);
mkdirSync(VR_GOLDEN, { recursive: true });
const goldens = readdirSync(GOLDEN).filter((f) => f.endsWith(".json"));
for (const f of goldens) copyFileSync(join(GOLDEN, f), join(VR_GOLDEN, f));
copyFileSync(VOICE_GOLDEN, join(VR_GOLDEN, basename(VOICE_GOLDEN)));
console.log(`synced house.json + ${goldens.length} goldens + the voice vectors into ${dirname(dirname(VR_HOUSE))}`);
