import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Thread, lineClass } from "../src/chat.tsx";
import type { Line } from "../src/pilot.ts";

const line = (seq: number, text: string, theirs = true): Line => ({ seq, text, theirs, from: theirs ? "Trabolta" : "Winamp", channel: "dm:Trabolta", ts: 0, kind: "line" }) as unknown as Line;
const render = (p: Partial<Parameters<typeof Thread>[0]>) =>
  renderToStaticMarkup(createElement(Thread, { lines: [], revealed: new Map(), typing: false, character: "Trabolta", guestName: "Winamp", ...p }));
const pick = (seq: number, text: string, act = false): Line => ({ ...line(seq, text, false), pick: true, ...(act ? { act: true } : {}) }) as Line;

describe("a pick at the heart is the server's own line (wave 28)", () => {
  it("lands in the thread's order (before his reply), as YOU, from the stream itself", () => {
    const html = render({ lines: [line(1, "So. Someone has found my heart."), pick(2, "I'm a person."), line(3, "Go on.")] });
    const at = (s: string) => html.indexOf(s);
    expect(at("I&#x27;m a person.")).toBeGreaterThan(at("found my heart"));
    expect(at("I&#x27;m a person.")).toBeLessThan(at("Go on."));
    expect(html).toContain('class="line mine kind-line echo"');
    expect(html).toMatch(/<span class="who">YOU<\/span>/u);
  });

  it("a deed reads as an action (B4), with its time", () => {
    const ts = new Date(2026, 9, 31, 20, 4).getTime();
    const html = render({ lines: [line(1, "Go on."), { ...pick(2, "[shows the Sandy File]", true), ts }] });
    expect(html).toContain('class="line mine kind-line echo act"');
    expect(html).toContain("20:04");
    expect(html).toContain("[shows the Sandy File]");
    expect(lineClass({ theirs: false, kind: "line", pick: true, act: true }, false)).toBe("line mine kind-line echo act");
    expect(lineClass({ theirs: false, kind: "line" }, false)).toBe("line mine kind-line");
  });

  it("the terminal keeps no local echo state: the Thread takes no echoes, the app none", () => {
    const app = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");
    const chat = readFileSync(new URL("../src/chat.tsx", import.meta.url), "utf8");
    expect(app).not.toMatch(/setEchoes|echoes=/u);
    expect(chat).not.toMatch(/echoAfter|interface Echo\b/u);
  });
});

describe("the thread at a room terminal (wave 27)", () => {
  it("draws no empty cursor for a line still queued for the voice: one typing row instead (B3)", () => {
    const html = render({ lines: [line(1, "First."), line(2, "Second."), line(3, "Third.")], revealed: new Map([[1, 3], [2, 0], [3, 0]]) });
    expect(html).toContain("Fir");
    expect(html).not.toContain("Second.");
    expect(html).not.toContain("Third.");
    expect(html.match(/class="line theirs typing"/g)?.length).toBe(1);
    expect(html.match(/class="cursor"/g)?.length).toBe(1);
  });

  it("says once that earlier messages are on the phone, and never asks his heart to say something", () => {
    const html = render({ lines: [line(9, "Winamp. I know that name.")], earlier: true });
    expect(html.indexOf("earlier messages are on your phone")).toBeLessThan(html.indexOf("I know that name"));
    expect(render({ lines: [], empty: "— direct line to TRABOLTA open. he speaks first. —" })).not.toContain("say something");
    expect(render({ lines: [] })).toContain("say something");
  });
});
