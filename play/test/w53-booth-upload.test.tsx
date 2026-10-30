// Wave 53 (docs/loom-w53-contract.md C2): a booth's upload stage, the rules.

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { boothDecision, boothStaged } from "../src/booth/upload.tsx";
import { letterCardState } from "../src/booth/letter-model.ts";
import type { ChatMessage } from "../src/types.ts";

let seq = 1;
const m = (extra: Partial<ChatMessage>): ChatMessage => ({
  seq: seq++, channel: "dm:The Uploader", channelKind: "dm", title: "The Uploader", from: "The Uploader", kind: "line", text: "x", ts: 0, audience: ["@Clippy"], parentSeq: null, hidden: false, beat: "Login", ...extra,
});
const map = (...rows: ChatMessage[]) => new Map(rows.map((r) => [r.seq, r]));

describe("what the stage shows", () => {
  it("is what was said to this part, in order, never its readouts or another part's", () => {
    const said = m({ text: "Welcome to the computer." });
    const card = m({ channel: "dm:Clippy", kind: "widget", widget: { kind: "captcha", text: "Select", params: {} } });
    const readout = m({ channel: "dm:Clippy", kind: "narration", readout: true, beat: undefined });
    const other = m({ audience: ["@Norton Anti-Virus"] });
    const room = m({ channel: "loc:The Desktop", audience: "all" });
    const codex = m({ channel: "codex", kind: "codex" });
    expect(boothStaged(map(said, card, readout, other, room, codex), "Clippy").map((r) => r.seq)).toEqual([said.seq, card.seq]);
  });
});

describe("the menu it docks", () => {
  it("offers the oldest menu, with its id and the option's words on the pick", () => {
    const pick = vi.fn();
    const d = boothDecision({ choices: [{ id: 7, beat: "Upload", options: ["My debt.", "My career."] }, { id: 9, beat: "x", options: ["Later"] }] }, pick)!;
    expect(d.options.map((o) => o.label)).toEqual(["My debt.", "My career."]);
    d.options[1]!.onClick();
    expect(pick).toHaveBeenCalledWith(1, { id: 7, text: "My career." });
  });
  it("is nothing with no menu", () => {
    expect(boothDecision({}, () => {})).toBeNull();
    expect(boothDecision(null, () => {})).toBeNull();
    expect(boothDecision({ choices: [] }, () => {})).toBeNull();
  });
});

describe("the booth's letter ask", () => {
  it("stays away once the upload asked; the address can still be changed", () => {
    const letter = { email: null, from: "x", asked: true };
    expect(letterCardState(letter, null, false, false)).toBe("none");
    expect(letterCardState({ email: null, from: "x" }, null, false, false)).toBe("ask");
    expect(letterCardState({ ...letter, email: "a@b.c" }, "a@b.c", false, false)).toBe("onFile");
    expect(letterCardState(letter, null, false, true)).toBe("ask");
  });
});

describe("the wiring", () => {
  const app = readFileSync(new URL("../src/booth/app.tsx", import.meta.url), "utf8");
  const up = readFileSync(new URL("../src/booth/upload.tsx", import.meta.url), "utf8");
  it("swaps the whole booth for the stage while on rails", () => {
    expect(app).toMatch(/cut\.showing \? <BoothUploadStage /u);
  });
  it("is fail-open: only the server's `cutscene` holds a booth, never an unsent report", () => {
    expect(up).toContain("useCutscene(!host.embedded && view?.cutscene === true)");
  });
  it("never puts an embedded pane on rails, or has it report in", () => {
    expect(up).toMatch(/if \(host\.embedded \|\| view\?\.arrive !== true/u);
  });
  it("leaves the part a way out of a stage it should not be on", () => {
    expect(up).toContain("corner={<WrongPart");
  });
});
