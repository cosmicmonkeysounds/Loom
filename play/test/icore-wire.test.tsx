// Wave 13 integration (icore): the core fields the Stage B lanes waited on,
// read by the play app as the server sends them — `PrimeView.paused` on
// the booth tray, `ChatMessage.phase` on the moments layer's staleness rule.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BoothTray } from "../src/booth/tray.tsx";
import { momentOf, phaseOf, replayable } from "../src/moments/model.ts";
import type { ChatMessage, PrimeView } from "../src/types.ts";

const prime = (extra: Partial<PrimeView>): PrimeView => ({ character: "Norton", faction: null, guests: [], channels: [], spaces: [], ...extra });

const alert = (seq: number, phase?: string | null): ChatMessage =>
  ({
    seq,
    channel: "lobby",
    channelKind: "lobby",
    title: "Lobby",
    from: "",
    kind: "signal",
    text: `Alarm ${seq}`,
    ts: seq * 1000,
    audience: "all",
    parentSeq: null,
    hidden: false,
    alert: true,
    moment: "major",
    ...(phase !== undefined ? { phase } : {}),
  }) as ChatMessage;

describe("PrimeView.paused on the booth tray", () => {
  it("a paused booth view holds its countdown at ⏸; a running one ticks ⏳", () => {
    const countdowns = [{ label: "Summons", path: "Night.summons_at", endsAt: 300 }];
    expect(renderToStaticMarkup(<BoothTray view={prime({ clock: 100_000, countdowns, paused: true })} onWallet={() => {}} />)).toContain("⏸ 3:20");
    expect(renderToStaticMarkup(<BoothTray view={prime({ clock: 100_000, countdowns })} onWallet={() => {}} />)).toContain("⏳");
  });
});

describe("ChatMessage.phase on the moments layer", () => {
  it("phaseOf reads the server's stamp (a null stamp too), else the phase known now", () => {
    expect(phaseOf(alert(1, "summons"), "y2k")).toBe("summons");
    expect(phaseOf(alert(1, null), "y2k")).toBeNull();
    expect(phaseOf(alert(1), "y2k")).toBe("y2k");
  });

  it("a backlog replayed after wake drops the alarms of a phase that has passed", () => {
    const viewer = { role: "guest" as const, me: "g1" };
    // Processed now (phase y2k): the stamp, not the current phase, decides.
    const backlog = [alert(1, "summons"), alert(2, "y2k"), alert(3)].map((m) => momentOf(m, viewer, "y2k")!);
    expect(backlog.map((m) => m.phase)).toEqual(["summons", "y2k", "y2k"]);
    expect(replayable(backlog, {}, "y2k").map((m) => m.seq)).toEqual([2, 3]);
  });
});

describe("who pressed LAST (cues.lastName)", () => {
  it("names the presser the server names; your own press is you; the story is the story", async () => {
    const { lastByText } = await import("../src/host/tab-cues.tsx");
    expect(lastByText("director", false, "Task Manager")).toBe("Task Manager");
    expect(lastByText("director", true, "Task Manager")).toBe("you");
    expect(lastByText("director", false)).toBe("a host or the director");
    expect(lastByText("director", false, "  ")).toBe("a host or the director");
    expect(lastByText("story", false, "Ada")).toBe("the story");
  });

  it("the server's name decides against this booth's part: a reload still says you, another host's repeat is theirs", async () => {
    const { lastByText, lastByTitle } = await import("../src/host/tab-cues.tsx");
    // Reloaded (no local memory of the press): the name is this booth's part.
    expect(lastByText("director", false, "Task Manager", "task manager")).toBe("you");
    // This booth pressed the cue, then another host pressed it again.
    expect(lastByText("director", true, "Ada", "Task Manager")).toBe("Ada");
    // The story fired the cue after this booth's press.
    expect(lastByText("story", true, undefined, "Task Manager")).toBe("the story");
    // An older server (no name): the local memory still says you.
    expect(lastByText("director", true, undefined, "Task Manager")).toBe("you");
    expect(lastByTitle("you")).toBe("You pressed LAST");
    expect(lastByTitle("the story")).toBe("The story pressed LAST");
    expect(lastByTitle("Task Manager")).toBe("Task Manager pressed LAST");
  });
});
