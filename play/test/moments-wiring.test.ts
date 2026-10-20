//! Wave 13 integration: where a moment's "Take me there" can go from each
//! surface that mounts the moments layer — a guest on rails in a cutscene
//! gets no room exit (the room would only change behind the stage), the
//! loud pass objective still opens the pass.

import { describe, expect, it } from "vitest";
import { roomExit } from "../src/guest/app.tsx";
import { momentExit } from "../src/moments/model.ts";

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
