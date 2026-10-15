import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";
import { checkinSigns, checkinSlug, printExtras } from "../server/routes/k12.ts";
import { foldName } from "../src/parser/names.ts";

describe("K-12 print extras", () => {
  it("slugs fold back onto the LOCATION name", () => {
    for (const n of ["The Desktop", "Disk Cleanup", "The Server Room", "Café_Room  2"]) {
      expect(foldName(checkinSlug(n))).toBe(foldName(n.replace(/_/g, " ")));
    }
    expect(checkinSlug("The Server Room")).toBe("the-server-room");
  });

  it("skips prisons, cutscenes and `checkin: false` rooms, keeps hidden rooms flagged", () => {
    const loc = (id: string, o: Partial<{ prison: boolean; cutscene: boolean; hidden: boolean; checkin: boolean; label: string }> = {}) => ({
      id,
      label: o.label ?? null,
      prison: o.prison ?? false,
      sealed: false,
      hidden: o.hidden ?? false,
      cutscene: o.cutscene ?? false,
      checkin: o.checkin ?? true,
      capacity: null,
      contains: [],
    });
    const model = {
      locations: new Map([
        ["The Desktop", loc("The Desktop", { label: "The Desktop (living room)" })],
        ["The Mud Room", loc("The Mud Room", { cutscene: true })],
        ["The Internet", loc("The Internet", { prison: true, hidden: true })],
        ["The Cache", loc("The Cache", { hidden: true })],
        ["The Server Room", loc("The Server Room", { hidden: true, checkin: false })],
      ]),
    };
    const signs = checkinSigns(model, "https://app.example.com", "EVT 1");
    expect(signs.map((s) => [s.id, s.label, s.hidden])).toEqual([
      ["The Desktop", "The Desktop (living room)", false],
      ["The Cache", "The Cache", true],
    ]);
    expect(signs[1]!.url).toBe("https://app.example.com/?code=EVT%201&checkin=the-cache");
    expect(printExtras(null, "https://x", "E").checkin).toEqual([]);
  });

  it("the show prints a sign for every room the check-in rule handles", () => {
    const sim = Sim.fromSources(scenarioSource("trapped-in-the-internet"));
    const ids = checkinSigns(sim.model, "https://a", "E").map((s) => s.id);
    for (const room of ["The Desktop", "The Cache", "The Tube", "Disk Cleanup", "The Cloud", "The Registry"]) expect(ids).toContain(room);
    expect(ids).not.toContain("The Mud Room");
    expect(ids).not.toContain("The Internet");
    expect(ids).not.toContain("The Server Room"); // locked: a visit would reveal it early
  });
});
