import { describe, expect, it } from "vitest";
import {
  ALERT_LEVELS,
  DEFAULT_ALERT_LEVEL,
  EFFECT_MANNERS,
  alertLevelOf,
  isEffectManner,
  lowerRung,
  noticeKey,
  splitNotice,
} from "../src/delivery.ts";

describe("alert ladder", () => {
  it("lists the four levels low → high, sticky by default", () => {
    expect(ALERT_LEVELS).toEqual(["balloon", "sticky", "dialog", "bsod"]);
    expect(DEFAULT_ALERT_LEVEL).toBe("sticky");
  });

  it("reads a world value as written, quotes and case allowed", () => {
    expect(alertLevelOf("dialog")).toBe("dialog");
    expect(alertLevelOf('"BSOD"')).toBe("bsod");
    expect(alertLevelOf(" 'Balloon' ")).toBe("balloon");
    expect(alertLevelOf("sticky")).toBe("sticky");
  });

  it("falls back to sticky for anything else", () => {
    expect(alertLevelOf(null)).toBe("sticky");
    expect(alertLevelOf(undefined)).toBe("sticky");
    expect(alertLevelOf("")).toBe("sticky");
    expect(alertLevelOf("loud")).toBe("sticky");
    expect(alertLevelOf("3")).toBe("sticky");
  });

  it("lowers one rung, floored at balloon", () => {
    expect(lowerRung("bsod")).toBe("dialog");
    expect(lowerRung("dialog")).toBe("sticky");
    expect(lowerRung("sticky")).toBe("balloon");
    expect(lowerRung("balloon")).toBe("balloon");
  });
});

describe("effect manners", () => {
  it("holds the contract's words", () => {
    for (const w of ["glitch", "static", "corrupted", "scream", "bsod", "flickering"]) expect(EFFECT_MANNERS.has(w)).toBe(true);
  });

  it("matches any word of the manner, folded", () => {
    expect(isEffectManner("glitch")).toBe(true);
    expect(isEffectManner("quietly, glitching")).toBe(true);
    expect(isEffectManner("STATIC")).toBe(true);
    expect(isEffectManner("through the static")).toBe(true);
    expect(isEffectManner("corrupted!")).toBe(true);
  });

  it("leaves delivery notes alone", () => {
    for (const m of ["quietly", "whispering", "weakly", "dejectedly", "through tears", "still smiling", "", null, undefined]) {
      expect(isEffectManner(m)).toBe(false);
    }
    expect(isEffectManner("errors")).toBe(false);
  });
});

describe("per-person notices", () => {
  it("strips a leading ~ outside or just inside the quotes", () => {
    expect(splitNotice('~"✅ Ada is accepted."')).toEqual({ cue: '"✅ Ada is accepted."', notice: true });
    expect(splitNotice('"~✅ Ada is accepted."')).toEqual({ cue: '"✅ Ada is accepted."', notice: true });
    expect(splitNotice('  "~ 🤷 a guess"')).toEqual({ cue: '"🤷 a guess"', notice: true });
  });

  it("leaves other cues alone", () => {
    expect(splitNotice('"Doors open."')).toEqual({ cue: '"Doors open."', notice: false });
    expect(splitNotice('"a ~ inside"')).toEqual({ cue: '"a ~ inside"', notice: false });
  });

  it("keys a notice by its leading glyph cluster", () => {
    expect(noticeKey("✅ Ada's answer is accepted.")).toBe("✅");
    expect(noticeKey("🤷 a guess")).toBe("🤷");
    expect(noticeKey("🎀 ribbon")).toBe("🎀");
    expect(noticeKey("⚠️ near")).toBe("⚠️");
    expect(noticeKey("👍🏽 thumbs")).toBe("👍🏽");
    expect(noticeKey("🧑‍💻 hacker")).toBe("🧑‍💻");
    expect(noticeKey('"✅ quoted"')).toBe("✅");
  });

  it("falls back to a bullet with no leading glyph", () => {
    expect(noticeKey("Ada is accepted.")).toBe("•");
    expect(noticeKey("")).toBe("•");
  });
});
