//! Wave 13 integration: where a moment's "Take me there" can go from each
//! surface that mounts the moments layer — a guest on rails in a cutscene
//! gets no room exit (the room would only change behind the stage), the
//! loud pass objective still opens the pass.

import { describe, expect, it } from "vitest";
import { roomExit } from "../src/guest/app.tsx";
import { momentExit } from "../src/moments/model.ts";
import { readBundledCss } from "./css.ts";

describe("momentExit", () => {
  const announcement = { channel: "lobby" } as const;
  const pass = { channel: null, pass: true } as const;

  it("goes to the room only when the app can open rooms", () => {
    expect(momentExit(announcement, { room: true, pass: true })).toBe("room");
    expect(momentExit(announcement, { room: false, pass: true })).toBeNull();
    expect(momentExit({ channel: null }, { room: true, pass: true })).toBeNull();
  });

  it("opens the pass for the pass objective, never a room", () => {
    expect(momentExit(pass, { room: false, pass: true })).toBe("pass");
    expect(momentExit(pass, { room: true, pass: false })).toBeNull();
  });
});

describe("the guest's room exit", () => {
  const open = (_id: string) => {};

  it("is the plain opener out of the cutscene", () => {
    expect(roomExit({ showing: false, over: false, leave: () => {} }, open)).toBe(open);
  });

  it("is absent while the story keeps the guest on rails", () => {
    expect(roomExit({ showing: true, over: false, leave: () => {} }, open)).toBeUndefined();
  });

  it("steps out of a finished cutscene, then opens the room", () => {
    const calls: string[] = [];
    const exit = roomExit({ showing: true, over: true, leave: () => void calls.push("leave") }, (id) => void calls.push(`open ${id}`));
    exit?.("lobby");
    expect(calls).toEqual(["leave", "open lobby"]);
  });
});

describe("the balloon over a host booth", () => {
  it("floats above the NEXT bar and its ARM (and above the composer too), never over them", () => {
    const css = readBundledCss();
    expect(/--moments-host-bar-h: 66px/u.test(css)).toBe(true);
    // The bar's own height: the token covers the tallest bar (`max-height: 64px` + its top line).
    expect(/\.host-bar \{[^}]*max-height: 64px/u.test(css)).toBe(true);
    const host = /:where\(\.root:has\(\.booth-dock:not\(\[hidden\]\) \.host-dock\)\) \.moments-balloon \{[^}]*bottom: calc\(([^}]*)\)/u.exec(css);
    expect(host?.[1]).toContain("var(--moments-host-bar-h)");
    const both = /:where\(\.root:has\(\.booth-dock:not\(\[hidden\]\) \.host-dock\):has\(\.composer\)\) \.moments-balloon \{[^}]*bottom: calc\(([^}]*)\)/u.exec(css);
    expect(both?.[1]).toContain("var(--moments-host-bar-h)");
    expect(both?.[1]).toContain("var(--moments-composer-h)");
    // Same specificity as the composer rule, so the later (combined) rule wins: it must come after it.
    expect(css.indexOf(":where(.root:has(.booth-dock:not([hidden]) .host-dock):has(.composer))")).toBeGreaterThan(css.indexOf(":where(.root:has(.composer)) .moments-balloon"));
  });
});
