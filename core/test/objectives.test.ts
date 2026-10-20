import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/index.ts";
import type { Declaration, ObjectiveBody } from "../src/parser/index.ts";

function objectiveOf(src: string, name?: string): ObjectiveBody {
  const [file] = parse(src);
  const decl = file.items
    .filter((i): i is { kind: "declaration"; value: Declaration } => i.kind === "declaration")
    .map((i) => i.value)
    .find((d) => d.kind === "objective" && (name === undefined || d.name === name));
  if (!decl?.objective) throw new Error("no objective");
  return decl.objective;
}

describe("OBJECTIVE — parse", () => {
  it("reads every key, the brief and the checklist", () => {
    const o = objectiveOf(`OBJECTIVE Show Your Pass
  for: Program, Antivirus
  while: program.uploaded == true and program.cleared != true
  act: Doors
  title: Show your pass to an Antivirus at the door
  text:
    An Antivirus in the Optical Drive scans it.
    Hold it up, screen bright.
    - Upload finished, done when program.uploaded == true
    - Scanned at the door, DONE WHEN program.cleared == true
    - Smile
  buttons: pass, the golden duck, scan
  loud: TRUE
`);
    expect(o.title).toBe("Show your pass to an Antivirus at the door");
    expect(o.for).toEqual(["Program", "Antivirus"]);
    expect(o.while).toBe("program.uploaded == true and program.cleared != true");
    expect(o.act).toBe("Doors");
    expect(o.brief).toBe("An Antivirus in the Optical Drive scans it. Hold it up, screen bright.");
    expect(o.checklist.map((c) => [c.label, c.done])).toEqual([
      ["Upload finished", "program.uploaded == true"],
      ["Scanned at the door", "program.cleared == true"],
      ["Smile", null],
    ]);
    expect(o.buttons).toEqual(["pass", "the golden duck", "scan"]);
    expect(o.loud).toBe(true);
  });

  it("defaults: no title, no while, no act, empty text, quiet", () => {
    const o = objectiveOf("OBJECTIVE Bare\n  for: guests\n");
    expect(o.title).toBeNull();
    expect(o.while).toBeNull();
    expect(o.act).toBeNull();
    expect(o.brief).toBe("");
    expect(o.checklist).toEqual([]);
    expect(o.buttons).toEqual([]);
    expect(o.loud).toBe(false);
  });

  it("takes the aliases label: / brief: and folds key case", () => {
    const o = objectiveOf("OBJECTIVE A\n  FOR: everyone\n  Label: The label\n  brief: First line.\n    Second line.\n  Loud: false\n");
    expect(o.title).toBe("The label");
    expect(o.for).toEqual(["everyone"]);
    expect(o.brief).toBe("First line. Second line.");
    expect(o.loud).toBe(false);
  });

  it("keeps an empty while: / done when as \"\" (for the lint)", () => {
    const o = objectiveOf("OBJECTIVE A\n  for: guests\n  while:\n  text:\n    - Do it, done when\n");
    expect(o.while).toBe("");
    expect(o.checklist[0]).toMatchObject({ label: "Do it", done: "" });
  });

  it("a checklist-only text block has an empty brief", () => {
    const o = objectiveOf("OBJECTIVE A\n  for: guests\n  text:\n    - one\n    - two\n");
    expect(o.brief).toBe("");
    expect(o.checklist.map((c) => c.label)).toEqual(["one", "two"]);
  });

  it("splits buttons on top-level commas only", () => {
    const o = objectiveOf("OBJECTIVE A\n  for: guests\n  buttons: a(b, c), d\n");
    expect(o.buttons).toEqual(["a(b, c)", "d"]);
  });
});
