//! The crew's show book (`scripts/show-page.ts` → the show's `SHOW.html`):
//! it builds, it carries every admin cue and every LOCATION of the story as
//! it stands, it never prints a secret (each one read from the source, so a
//! changed combo, code or answer key is checked after the next merge), and
//! the committed file is a fresh build (`show:page --check`).

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OUTPUT,
  REDACTED,
  actorsOf,
  buildShowPage,
  checkboxify,
  cueLabelHtml,
  esc,
  loadShow,
  redact,
  roomLabel,
  secretsIn,
  showSecrets,
  titleNamedCodes,
} from "../scripts/show-page.ts";
import { parseFactsText } from "../src/facts.ts";
import { foldCode } from "../src/runtime/sim/model.ts";

const SHOW = loadShow();
const SECRETS = showSecrets(SHOW);
const PAGE = buildShowPage(SHOW.dir);

describe("redaction", () => {
  it("blanks a secret in any case, with either apostrophe, never inside a longer word", () => {
    const s = ["Moon-Code", "it's here"];
    expect(redact("the moon-code door", s)).toBe(`the ${REDACTED} door`);
    expect(redact("IT’S HERE now", s)).toBe(`${REDACTED} now`);
    expect(redact("xmoon-codey", s)).toBe("xmoon-codey");
    expect(secretsIn("nothing to see", s)).toEqual([]);
  });

  it("catches every form the Codex box redeems (foldCode: spaces, dashes, underscores or none)", () => {
    const s = ["COMPUTER-PROM"];
    for (const typed of ["computer prom", "Computer_Prom", "computerprom", "COMPUTER - PROM", "com-puter prom"]) {
      expect(redact(`to ${typed} now`, s), typed).toBe(`to ${REDACTED} now`);
    }
    expect(secretsIn("the computer promenade", s)).toEqual([]);
    expect(secretsIn("mapsandducks.com", ["MAPSANDDUCKS-COM"])).toEqual([]);
    expect(secretsIn("mapsandducks com", ["MAPSANDDUCKS-COM"])).toEqual(["MAPSANDDUCKS-COM"]);
  });

  it("drops a blanked aside from a house room label", () => {
    expect(roomLabel("Server Room (cold storage)", ["COLD-STORAGE"])).toBe("Server Room");
    expect(roomLabel("Cold Storage", ["COLD-STORAGE"])).toBe(REDACTED);
    expect(roomLabel("Kitchen", ["COLD-STORAGE"])).toBe("Kitchen");
  });

  it("skips one- and two-digit aliases, which would blank every clock time", () => {
    expect(SECRETS.some((x) => /^\d{1,2}$/u.test(x))).toBe(false);
  });
});

describe("the source's secrets", () => {
  const facts = parseFactsText(readFileSync(join(SHOW.dir, "facts.json"), "utf8")).facts!;

  it("reads the keypad code, the digit notes, every hunt answer + alias and the pickup line", () => {
    expect(SECRETS).toContain(facts.door!.code);
    for (const c of facts.door!.clues ?? []) expect(SECRETS).toContain(c.code);
    for (const q of facts.questions) {
      expect(SECRETS).toContain(q.answer);
      for (const a of q.accept) if (!/^\d{1,2}$/u.test(a)) expect(SECRETS).toContain(a);
    }
    for (const a of facts.answers) expect(SECRETS).toContain(a.answer);
  });

  it("reads every Kernel.combo_* string and each of its pairs from the story", () => {
    const combos = SHOW.files.flatMap((f) => [...f.source.matchAll(/^\s*set\s+Kernel\.combo_[a-z0-9_]+\s*=\s*"([^"]*)"/gmu)].map((m) => m[1]!));
    expect(combos.length).toBeGreaterThanOrEqual(2);
    for (const c of combos) {
      expect(SECRETS).toContain(c);
      for (const pair of c.split(",")) expect(SECRETS).toContain(pair.trim());
    }
  });

  it("reads every codex unlock code but the public ones its own title spells", () => {
    const codes = SHOW.files.flatMap((f) => [...f.source.matchAll(/^\s*code:\s*(\S.*?)\s*$/gmu)].map((m) => m[1]!));
    expect(codes.length).toBe([...SHOW.model.codex.values()].filter((c) => c.code !== null).length);
    const named = titleNamedCodes(SHOW.model);
    for (const c of codes) {
      if (named.has(foldCode(c))) expect(SECRETS, c).not.toContain(c);
      else expect(SECRETS, c).toContain(c);
    }
    // Only a public entry is ever exempt, and only a code its title holds.
    for (const c of SHOW.model.codex.values()) {
      if (c.code === null || !named.has(c.code)) continue;
      expect(c.secret, c.id).toBe(false);
      expect(foldCode(c.title), c.id).toContain(c.code);
    }
    expect(named.has("trustchart")).toBe(true);
    expect(named.has("computerprom")).toBe(false);
  });
});

describe("the show book", () => {
  it("is a complete standalone document", () => {
    expect(PAGE.startsWith("<!doctype html>")).toBe(true);
    expect(PAGE).toContain("<title>Trapped in the Internet Show Book</title>");
    expect(PAGE).toContain('<meta name="claude:viewport-fit-sides" content="cover">');
    expect(PAGE).not.toMatch(/<!-- @(counts|cues|beats|cast|rooms|terminals) -->/u);
    expect(PAGE).not.toMatch(/<script[^>]+src=/u);
    expect(PAGE).not.toContain("window.print");
  });

  it("names none of the secrets", () => {
    expect(secretsIn(PAGE, SECRETS)).toEqual([]);
  });

  it("carries every admin cue, by label and id", () => {
    const admin = [...SHOW.model.interactions.values()].filter((i) => i.who === "admin");
    expect(admin.length).toBeGreaterThan(60);
    for (const i of admin) {
      expect(PAGE, i.id).toContain(cueLabelHtml(i.label, SECRETS));
      expect(PAGE, i.id).toContain(`<code>${esc(i.id)}</code>`);
    }
  });

  it("carries every LOCATION and every terminal spot", () => {
    for (const l of SHOW.model.locations.values()) expect(PAGE, l.id).toContain(`<strong>${esc(l.id)}</strong>`);
    for (const t of SHOW.house.terminals ?? []) expect(PAGE, t.id).toContain(`<code>${esc(t.id)}</code>`);
  });

  it("names the actors from the cast packs", () => {
    const actors = actorsOf(SHOW.castReadme);
    expect(actors.get("clippy")).toBe("Brooke");
    for (const [, a] of actors) if (a !== null) expect(PAGE).toContain(esc(a));
  });

  it("gives every tick box a unique id and a label", () => {
    const ids = [...PAGE.matchAll(/<input type="checkbox" id="([^"]+)">/gu)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThan(40);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(PAGE).toContain(`<label for="${id}">`);
    expect(checkboxify('<ul class="check" data-list="x"><li data-ck>A b</li><li data-ck>A b</li></ul>')).toContain('id="ck-x-a-b-2"');
  });

  it("is committed as a fresh build (show:page --check)", () => {
    const file = join(SHOW.dir, OUTPUT);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8") === PAGE, `${OUTPUT} is stale: run pnpm --filter @loom/core show:page`).toBe(true);
  });
});
