// Wave 42b (B5): a guest's line queued behind other programs, on a wall
// terminal piloting their DM with him. Fixture waits (play's
// `applyAgentWait` over the server's `agentWait` frames) through
// `pilotWait` and the thread.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { applyAgentWait, type AgentWait, type AgentWaitNotice } from "@loom/play/agent-wait.ts";
import type { GuestView } from "@loom/play/types.ts";
import { Thread, waitCells } from "../src/chat.tsx";
import { pilotWait, type Line } from "../src/pilot.ts";

const frame = (state: AgentWaitNotice["state"], extra: Partial<AgentWaitNotice> = {}): AgentWaitNotice => ({ channel: "dm:Trabolta", audience: ["g-1"], character: "Trabolta", state, ...extra });
const waitOf = (...frames: AgentWaitNotice[]): AgentWait | undefined => frames.reduce<ReadonlyMap<string, AgentWait>>((m, f) => applyAgentWait(m, f, 1), new Map()).get("dm:Trabolta");
const view = { people: [{ id: "Trabolta", name: "Jean Trabolta", kind: "character" }] } as unknown as GuestView;
const line = (seq: number, text: string): Line => ({ seq, text, theirs: false, from: "Winamp", channel: "dm:Trabolta", ts: 0, kind: "line" }) as unknown as Line;
const render = (p: Partial<Parameters<typeof Thread>[0]>) =>
  renderToStaticMarkup(createElement(Thread, { lines: [line(1, "Hello?")], revealed: new Map(), typing: false, character: "Trabolta", guestName: "Winamp", ...p }));

describe("pilotWait", () => {
  it("queued: the wait, named as the guest's view names him", () => {
    const w = waitOf(frame("queued", { position: 3, etaS: 20 }));
    expect(pilotWait(w, false, view, "Trabolta")).toEqual({ typing: false, wait: { name: "Jean Trabolta", wait: w } });
    expect(pilotWait(w, false, null, "Trabolta").wait?.name).toBe("Trabolta");
  });

  it("answering is the typing row; typing wins over a stale queued; idle is nothing", () => {
    expect(pilotWait(waitOf(frame("answering")), false, view, "Trabolta")).toEqual({ typing: true, wait: null });
    expect(pilotWait(waitOf(frame("queued", { position: 2 })), true, view, "Trabolta")).toEqual({ typing: true, wait: null });
    expect(pilotWait(waitOf(frame("queued", { position: 2 }), frame("idle")), false, view, "Trabolta")).toEqual({ typing: false, wait: null });
  });
});

describe("the thread's wait line", () => {
  it("draws the phone's words and a block bar where the typing row goes", () => {
    const w = waitOf(frame("queued", { position: 8, etaS: 90 }), frame("queued", { position: 7, etaS: 63 }))!;
    const html = render({ wait: { name: "Jean Trabolta", wait: w } });
    expect(html).toContain('class="line system wait" role="status"');
    expect(html).toContain("Jean Trabolta is answering other programs. You are 7th in line, about 1 min. Please do not move the mouse.");
    // 2 of 8 places up the line: 3 of 10 cells.
    expect(html).toContain("[■■■□□□□□□□]");
    expect(html.indexOf("Hello?")).toBeLessThan(html.indexOf("answering other programs"));
  });

  it("gives way to the typing row, and to a line still queued for the voice", () => {
    const wait = { name: "Jean Trabolta", wait: waitOf(frame("queued", { position: 2 }))! };
    expect(render({ wait, typing: true })).not.toContain("answering other programs");
    const his = { ...line(2, "One moment."), theirs: true, from: "Trabolta" } as Line;
    expect(render({ wait, lines: [line(1, "Hello?"), his], revealed: new Map([[2, 0]]) })).not.toContain("answering other programs");
    expect(render({})).not.toContain("wait");
  });

  it("the bar fills as the line moves up, never empty", () => {
    expect(waitCells(waitOf(frame("queued", { position: 20 }))!)).toBe("■□□□□□□□□□");
    expect(waitCells(waitOf(frame("queued", { position: 20 }), frame("queued", { position: 1 }))!)).toBe("■■■■■■■■■■");
    expect(waitCells(waitOf(frame("queued"))!)).toBeNull();
  });
});
