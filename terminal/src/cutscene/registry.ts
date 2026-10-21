//! Every cutscene the terminals know (wave 17): the four act files, in
//! running order. A lane adds a scene by pushing a `SceneDef` onto its own
//! file's `SCENES` — nothing here changes. The demo scene is the preview's
//! only (`preview.tsx`), never the show's.

import { SCENES as ACT1 } from "./scenes/act1.tsx";
import { SCENES as ACT2 } from "./scenes/act2.tsx";
import { SCENES as ACT3 } from "./scenes/act3.tsx";
import { SCENES as MOMENTS } from "./scenes/moments.tsx";
import type { SceneDef } from "./types.ts";

/** Every act's scenes, by file (the preview groups them so). */
export const ACTS: ReadonlyArray<{ file: string; scenes: readonly SceneDef[] }> = [
  { file: "act1", scenes: ACT1 },
  { file: "act2", scenes: ACT2 },
  { file: "act3", scenes: ACT3 },
  { file: "moments", scenes: MOMENTS },
];

/** The show's scenes. */
export const SCENES: readonly SceneDef[] = ACTS.flatMap((a) => a.scenes);

/** Ids used twice (a lane's typo would shadow another's scene). */
export function duplicateIds(list: readonly SceneDef[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const s of list) (seen.has(s.id) ? dup : seen).add(s.id);
  return [...dup];
}
