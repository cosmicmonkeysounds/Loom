import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { GOLDEN, SHOW_DESCENT, SHOW_HOUSE, VR_DESCENT, VR_GOLDEN, VR_HOUSE } from "./golden.ts";
import { VOICE_GOLDEN } from "./voice-golden.ts";

// The Godot project keeps copies (`pnpm --filter @loom/house sync`).
describe("the VR project's copies", () => {
  it.skipIf(!existsSync(VR_HOUSE))("reinstall/vr/house/house.json is the show's house.json", () => {
    expect(readFileSync(VR_HOUSE, "utf8")).toBe(readFileSync(SHOW_HOUSE, "utf8"));
  });

  it.skipIf(!existsSync(VR_HOUSE))("reinstall/vr/house/descent.json is the show's descent.json", () => {
    expect(readFileSync(VR_DESCENT, "utf8")).toBe(readFileSync(SHOW_DESCENT, "utf8"));
  });

  it.skipIf(!existsSync(VR_GOLDEN))("reinstall/vr/test/golden/ matches house/test/golden/", () => {
    for (const f of readdirSync(GOLDEN).filter((n) => n.endsWith(".json"))) {
      const copy = join(VR_GOLDEN, f);
      expect(existsSync(copy), `${f} is missing — run sync`).toBe(true);
      expect(readFileSync(copy, "utf8"), f).toBe(readFileSync(join(GOLDEN, f), "utf8"));
    }
  });

  it.skipIf(!existsSync(VR_GOLDEN))("reinstall/vr/test/golden/ carries the voice link's vectors", () => {
    const copy = join(VR_GOLDEN, basename(VOICE_GOLDEN));
    expect(existsSync(copy), "voice-mulaw.json is missing — run sync").toBe(true);
    expect(readFileSync(copy, "utf8")).toBe(readFileSync(VOICE_GOLDEN, "utf8"));
  });
});
