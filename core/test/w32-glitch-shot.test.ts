//! Wave 32 (terminal lane, review): the screen fold marks a burst's glitch
//! shot `light` from `Night.glitch_kind`, so the walls and the TV never have
//! to guess a burst from the moments ring (a ⚡ flicker just before a 📺
//! hijack once read as a burst).
import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import { ScreenWatch, glitchIsBurst } from "../server/routes/screen.ts";

const SRC = `# Glitch\nstart: Boot\n\n== Boot\n\nHello.\n\nINTERACTION burst\n  who: admin\n\nINTERACTION full\n  who: admin\n\nwhen burst:\n  cue screens_glitch\n  set Night.glitch_kind = "burst"\n\nwhen full:\n  cue screens_glitch\n  set Night.glitch_kind = "full"\n`;

describe("w32 — the glitch shot's kind", () => {
  it("light only for a burst, read as the fold saw the rule's world", () => {
    const s = Sim.fromSources(SRC);
    s.fireBeat("Boot");
    let now = 1000;
    const watch = new ScreenWatch({ now: () => now });
    const look = () => watch.poll(s, { name: "TV", spot: "", view: "tv", character: "" }, () => false).program;
    expect(look().glitch).toBeNull();
    s.signal("burst");
    now += 5000;
    expect(look().glitch).toMatchObject({ cue: "screens_glitch", at: 6000, light: true });
    s.signal("full");
    now += 5000;
    const g = look().glitch!;
    expect(g.at).toBe(11000);
    expect(g.light).toBeUndefined();
  });

  it("glitchIsBurst reads Night.glitch_kind", () => {
    const s = Sim.fromSources(SRC);
    s.fireBeat("Boot");
    expect(glitchIsBurst(s)).toBe(false);
    s.setVar("Night.glitch_kind", '"burst"');
    expect(glitchIsBurst(s)).toBe(true);
    s.setVar("Night.glitch_kind", '"full"');
    expect(glitchIsBurst(s)).toBe(false);
    expect(glitchIsBurst(null)).toBe(false);
  });
});
