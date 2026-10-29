//! Wave 44 (C9): 🆘 Help Me at the tent — when it is offered, its rest, what
//! a press posts, and the flow drawing it on the wizard.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { askForHelp } from "../src/api.ts";
import { defaultConfig } from "../src/config.ts";
import { ReinstallFlow } from "../src/flow.tsx";
import { createSfx } from "../src/game/audio.ts";
import { HELP_FAIL_MS, HELP_HOLD_MS, HELP_IDLE, TENT_HELP_SIGNAL, helpAnswered, helpAt, helpFace, helpOffered } from "../src/help.ts";
import type { Program } from "../src/program.ts";

const program = (over: Partial<Program> = {}): Program => ({ id: "g1", name: "Winamp", location: null, captured: true, restricted: false, eligible: true, marked: false, favour: false, reinstalled: 0, ...over }) as Program;

afterEach(() => vi.unstubAllGlobals());

describe("help.ts", () => {
  it("is offered to a program being reinstalled, never a party favour", () => {
    expect(helpOffered({ captured: true, marked: false })).toBe(true);
    expect(helpOffered({ captured: false, marked: true })).toBe(true);
    expect(helpOffered({ captured: false, marked: false })).toBe(false);
  });

  it("rests a minute after a press, eight seconds after a failure", () => {
    const sent = helpAnswered("ok", 1000);
    expect(sent).toEqual({ kind: "sent", until: 1000 + HELP_HOLD_MS });
    expect(helpFace(sent).disabled).toBe(true);
    expect(helpFace(sent).note).toMatch(/on the way/u);
    expect(helpAt(sent, 1000 + HELP_HOLD_MS - 1)).toBe(sent);
    expect(helpAt(sent, 1000 + HELP_HOLD_MS)).toBe(HELP_IDLE);
    const failed = helpAnswered("failed", 0);
    expect(helpFace(failed)).toMatchObject({ disabled: false, label: "🆘 Help Me" });
    expect(helpFace(failed).note).toMatch(/wave at the tent's host/u);
    expect(helpAt(failed, HELP_FAIL_MS)).toBe(HELP_IDLE);
    expect(helpFace({ kind: "sending" }).disabled).toBe(true);
  });
});

describe("askForHelp", () => {
  it("fires the story's button for the program, as the device", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true, presses: 3 }), { status: 200 });
    });
    const config = defaultConfig({ eventId: "e1", token: "mod-t", name: "Tent laptop" });
    expect(await askForHelp(config, "g7")).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/\/e\/e1\/api\/mod\/signal$/u);
    expect((calls[0]!.init.headers as Record<string, string>)["x-loom-token"]).toBe("mod-t");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ name: TENT_HELP_SIGNAL, subject: "g7", label: "Tent · Tent laptop" });
  });

  it("a refusal, an error or no network reads as failed", async () => {
    const config = defaultConfig({ eventId: "e1", token: "t" });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: true, refused: true }), { status: 200 }));
    expect(await askForHelp(config, "g1")).toBe("failed");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "moderators only" }), { status: 403 }));
    expect(await askForHelp(config, "g1")).toBe("failed");
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    expect(await askForHelp(config, "g1")).toBe("failed");
  });
});

describe("the flow draws it", () => {
  const render = (p: Program) =>
    renderToStaticMarkup(
      createElement(ReinstallFlow, {
        config: defaultConfig({ eventId: "e", token: "t", role: "both" }),
        program: p,
        ended: false,
        stations: { list: [], ok: true, refresh: () => {} },
        canDraw: true,
        sfx: createSfx(() => null),
        start: "choose",
        onExit: () => {},
      }),
    );

  it("on the wizard for a captured program, not for a party favour", () => {
    expect(render(program())).toContain("🆘 Help Me");
    expect(render(program({ captured: false, marked: false, favour: true }))).not.toContain("Help Me");
  });
});
