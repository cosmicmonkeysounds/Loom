// Wave 52: the server room with no mouse or keyboard. The controller, the
// webcam by name, spoken answers, and the keys that set them up.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { atEnd } from "../src/chat.tsx";
import { ChoicePanel } from "../src/heart/ChoicePanel.tsx";
import { hintsFromSearch, loadConfig, defaultConfig, withoutSecrets } from "../src/config.ts";
import { deviceFor, openDevice, type DeviceLike } from "../src/devices.ts";
import { GC, NO_PAD, PadMachine, REPEAT_EVERY_MS, REPEAT_FIRST_MS, SCROLL_MAX, frameOf, isGameCube, movedTo, type PadFrame, type RawPad } from "../src/gamepad/pad.ts";
import { setupDoor } from "../src/setup-map.ts";
import { EndOfSpeech, FLOOR_MS, MAX_MS, NOTHING_MS, QUIET_MS, cleanText, parrotLine, rmsOf, wavOf } from "../src/whisper/speech.ts";

const MAYFLASH = "MAYFLASH GameCube Controller Adapter (Vendor: 0079 Product: 1844)";

function raw(held: number[] = [], axes: Record<number, number> = {}, id = MAYFLASH): RawPad {
  // At rest, as the adapter reads: L and R at -1, the hat at 1.29, the sticks at 0.
  const a = [0, 0, 0, -1, -1, 0, 0, 0, 0, 1.29];
  for (const [k, v] of Object.entries(axes)) a[Number(k)] = v;
  return { id, axes: a, buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: held.includes(i) })) };
}

const frame = (over: Partial<PadFrame> = {}): PadFrame => ({ ...NO_PAD, ...over });

describe("the controller's frames", () => {
  it("knows the adapter by its id", () => {
    expect(isGameCube(MAYFLASH)).toBe(true);
    expect(isGameCube("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)")).toBe(false);
  });

  it("reads nothing off four idle ports", () => {
    expect(frameOf([raw(), raw(), raw(), raw()])).toEqual(NO_PAD);
    expect(frameOf([null, null, null, null])).toEqual(NO_PAD);
  });

  it("reads a controller in any port", () => {
    const f = frameOf([raw(), raw(), raw(), raw([GC.a, GC.b, GC.start, GC.down], { [GC.stickY]: -1, [GC.cY]: 0.8 })]);
    expect(f).toEqual({ a: true, b: true, start: true, dpad: 1, stick: -1, scroll: 0.8 });
    expect(frameOf([raw([GC.up])]).dpad).toBe(-1);
  });

  it("takes nothing from another kind of pad", () => {
    expect(frameOf([raw([GC.a], {}, "Xbox Wireless Controller")])).toEqual(NO_PAD);
  });

  it("does nothing for the buttons with no job (X, Y, Z, L, R)", () => {
    expect(frameOf([raw([0, 3, 4, 5, 7], { 3: 1, 4: 1 })])).toEqual(NO_PAD);
  });
});

describe("PadMachine", () => {
  it("fires A and Start once a press", () => {
    const m = new PadMachine();
    m.step(frame(), 0);
    expect(m.step(frame({ a: true }), 16)).toEqual([{ t: "select" }]);
    expect(m.step(frame({ a: true }), 32)).toEqual([]);
    m.step(frame(), 48);
    expect(m.step(frame({ a: true, start: true }), 64)).toEqual([{ t: "select" }, { t: "latest" }]);
  });

  it("fires B once a press, and never as a select", () => {
    const m = new PadMachine();
    m.step(frame(), 0);
    expect(m.step(frame({ b: true }), 16)).toEqual([{ t: "back" }]);
    expect(m.step(frame({ b: true }), 32)).toEqual([]);
  });

  it("never fires a button already held as it starts", () => {
    const m = new PadMachine();
    expect(m.step(frame({ a: true }), 0)).toEqual([]);
    expect(m.step(frame({ a: true }), 16)).toEqual([]);
  });

  it("moves once on a push, then repeats while held", () => {
    const m = new PadMachine();
    m.step(frame(), 0);
    expect(m.step(frame({ dpad: 1 }), 10)).toEqual([{ t: "move", dir: 1 }]);
    expect(m.step(frame({ dpad: 1 }), 10 + REPEAT_FIRST_MS - 1)).toEqual([]);
    expect(m.step(frame({ dpad: 1 }), 10 + REPEAT_FIRST_MS)).toEqual([{ t: "move", dir: 1 }]);
    expect(m.step(frame({ dpad: 1 }), 10 + REPEAT_FIRST_MS + REPEAT_EVERY_MS - 1)).toEqual([]);
    expect(m.step(frame({ dpad: 1 }), 10 + REPEAT_FIRST_MS + REPEAT_EVERY_MS)).toEqual([{ t: "move", dir: 1 }]);
  });

  it("gives the left stick a gap, so a stick at the threshold doesn't flutter", () => {
    const m = new PadMachine();
    m.step(frame(), 0);
    expect(m.step(frame({ stick: -0.5 }), 10)).toEqual([]);
    expect(m.step(frame({ stick: -0.7 }), 20)).toEqual([{ t: "move", dir: -1 }]);
    expect(m.step(frame({ stick: -0.5 }), 30)).toEqual([]);
    expect(m.step(frame({ stick: -0.7 }), 40)).toEqual([]); // never let go
    m.step(frame({ stick: 0 }), 50);
    expect(m.step(frame({ stick: -0.7 }), 60)).toEqual([{ t: "move", dir: -1 }]);
  });

  it("scrolls with the C stick, up for up, faster further over", () => {
    const m = new PadMachine();
    m.step(frame(), 0);
    expect(m.step(frame({ scroll: 0.2 }), 16)).toEqual([]);
    const [full] = m.step(frame({ scroll: 1 }), 32);
    expect(full).toEqual({ t: "scroll", px: (SCROLL_MAX * 16) / 1000 });
    const [half] = m.step(frame({ scroll: -0.6 }), 48);
    expect(half!.t === "scroll" && half!.px < 0 && Math.abs(half!.px) < (SCROLL_MAX * 16) / 1000).toBe(true);
  });

  it("doesn't jump after a stall: a long frame scrolls no further than a short one's cap", () => {
    const m = new PadMachine();
    m.step(frame(), 0);
    const [e] = m.step(frame({ scroll: 1 }), 5000);
    expect(e).toEqual({ t: "scroll", px: (SCROLL_MAX * 50) / 1000 });
  });
});

describe("movedTo", () => {
  it("walks the list and stops at both ends", () => {
    expect(movedTo(0, 1, 3)).toBe(1);
    expect(movedTo(2, 1, 3)).toBe(2);
    expect(movedTo(0, -1, 3)).toBe(0);
  });
  it("comes in from the end nearest the push", () => {
    expect(movedTo(-1, 1, 3)).toBe(0);
    expect(movedTo(-1, -1, 3)).toBe(2);
    expect(movedTo(-1, 1, 0)).toBe(-1);
  });
});

describe("the ⟦BACK⟧ bar and the controller", () => {
  const menu = { id: 1, beat: "Heart To Heart", channel: "dm:Trabolta", options: ["⟦BACK⟧ Let's go back to it."] };
  const bar = (numberKeys: boolean) => renderToStaticMarkup(createElement(ChoicePanel, { menu, doorOpen: false, numberKeys, onActivity: () => {}, onPick: async () => {}, pad: true }));

  it("answers to B and is never in A's ring: a stray A must not leave the talk", () => {
    for (const html of [bar(false), bar(true)]) {
      expect(html).toContain("data-pad-back");
      expect(html).not.toMatch(/data-pad(=|\s|>)/u);
    }
  });

  it("shows a controller its key", () => {
    expect(bar(false)).toContain(">B<");
    expect(bar(false)).not.toContain("ESC");
  });
});

describe("the thread's follow", () => {
  it("follows at the end and stays put scrolled back", () => {
    expect(atEnd({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(true);
    expect(atEnd({ scrollHeight: 1000, scrollTop: 300, clientHeight: 400 })).toBe(false);
  });
});

function streamOn(id: string) {
  const stopped: string[] = [];
  const stream = { getTracks: () => [{ stop: () => stopped.push(id), getSettings: () => ({ deviceId: id }) }] } as unknown as MediaStream;
  return { stream, stopped };
}

describe("the webcam by name", () => {
  const WIN: DeviceLike[] = [
    { kind: "audioinput", deviceId: "default", label: "Default - Microphone (Logi C310 HD WebCam) (046d:081b)" },
    { kind: "audioinput", deviceId: "communications", label: "Communications - Microphone (Logi C310 HD WebCam) (046d:081b)" },
    { kind: "audioinput", deviceId: "array", label: "Microphone Array (Realtek(R) Audio)" },
    { kind: "audioinput", deviceId: "c310-mic", label: "Microphone (Logi C310 HD WebCam) (046d:081b)" },
    { kind: "videoinput", deviceId: "c310-cam", label: "Logi C310 HD WebCam (046d:081b)" },
  ];

  it("finds the device, not Windows' aliases of it", () => {
    expect(deviceFor(WIN, "audioinput", "c310")?.deviceId).toBe("c310-mic");
    expect(deviceFor(WIN, "videoinput", " C310 ")?.deviceId).toBe("c310-cam");
    expect(deviceFor(WIN, "audioinput", "")).toBeNull();
    expect(deviceFor(WIN, "audioinput", "Blue Yeti")).toBeNull();
  });

  it("no name: the default, with nothing listed", async () => {
    const asked: Array<string | null> = [];
    await openDevice({ kind: "videoinput", label: "", list: () => Promise.reject(new Error("never")), open: async (id) => (asked.push(id), streamOn("x").stream) });
    expect(asked).toEqual([null]);
  });

  it("opens the named device", async () => {
    const asked: Array<string | null> = [];
    await openDevice({ kind: "audioinput", label: "C310", list: async () => WIN, open: async (id) => (asked.push(id), streamOn(id ?? "x").stream) });
    expect(asked).toEqual(["c310-mic"]);
  });

  it("falls back to the default when the named one won't open", async () => {
    const asked: Array<string | null> = [];
    const s = await openDevice({
      kind: "audioinput",
      label: "C310",
      list: async () => WIN,
      open: async (id) => {
        asked.push(id);
        if (id !== null) throw new Error("gone");
        return streamOn("default").stream;
      },
    });
    expect(asked).toEqual(["c310-mic", null]);
    expect(s).toBeDefined();
  });

  it("no names until the first grant: the default asks, then the named one takes over", async () => {
    const blank = WIN.map((d) => ({ ...d, label: "" }));
    const lists = [blank, WIN];
    const first = streamOn("array");
    const asked: Array<string | null> = [];
    await openDevice({ kind: "audioinput", label: "C310", list: async () => lists.shift()!, open: async (id) => (asked.push(id), id === null ? first.stream : streamOn(id).stream) });
    expect(asked).toEqual([null, "c310-mic"]);
    expect(first.stopped).toEqual(["array"]); // let go first: a camera often won't open twice
  });

  it("stays on the default when it already is the named device", async () => {
    const lists = [WIN.map((d) => ({ ...d, label: "" })), WIN];
    const asked: Array<string | null> = [];
    await openDevice({ kind: "audioinput", label: "C310", list: async () => lists.shift()!, open: async (id) => (asked.push(id), streamOn("c310-mic").stream) });
    expect(asked).toEqual([null]);
  });
});

describe("hearing an answer", () => {
  const FRAME = 85;
  const run = (e: EndOfSpeech, rms: number, ms: number) => {
    let last = "listening";
    for (let t = 0; t < ms && last === "listening"; t += FRAME) last = e.push(rms, FRAME);
    return last;
  };

  it("ends after the quiet that follows speech", () => {
    const e = new EndOfSpeech();
    run(e, 0.002, FLOOR_MS + FRAME);
    expect(run(e, 0.1, 1000)).toBe("listening");
    expect(e.heard).toBe(true);
    expect(run(e, 0.002, QUIET_MS - 100)).toBe("listening");
    expect(run(e, 0.002, 200)).toBe("finished");
  });

  it("gives up when nobody speaks", () => {
    const e = new EndOfSpeech();
    expect(run(e, 0.002, NOTHING_MS + 200)).toBe("nothing");
    expect(e.heard).toBe(false);
  });

  it("a thud isn't speech, and a slow starter still gets heard after one", () => {
    const e = new EndOfSpeech();
    run(e, 0.002, FLOOR_MS + FRAME);
    e.push(0.2, FRAME);
    e.push(0.2, FRAME);
    expect(run(e, 0.002, 3000)).toBe("listening");
    expect(e.heard).toBe(false);
    run(e, 0.1, 500);
    expect(e.heard).toBe(true);
  });

  it("the A press's click doesn't deafen it to the room's level", () => {
    const e = new EndOfSpeech();
    e.push(0.3, FRAME); // the click, in the measuring
    run(e, 0.002, FLOOR_MS + FRAME);
    run(e, 0.05, 500); // a quiet voice: far under the click
    expect(e.heard).toBe(true);
  });

  it("measures a loud room first, so the room itself isn't speech", () => {
    const e = new EndOfSpeech();
    run(e, 0.03, FLOOR_MS + FRAME);
    expect(run(e, 0.04, 2000)).toBe("listening");
    expect(e.heard).toBe(false);
    run(e, 0.2, 500);
    expect(e.heard).toBe(true);
  });

  it("cuts off a speech that never stops", () => {
    const e = new EndOfSpeech();
    run(e, 0.002, FLOOR_MS + FRAME);
    expect(run(e, 0.2, MAX_MS + 200)).toBe("finished");
  });

  it("writes a 16-bit mono WAV", () => {
    const wav = wavOf([0, 1, -1], 16000);
    const v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect(v.getUint32(4, true)).toBe(36 + 6);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(6);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)]).toEqual([0, 32767, -32768]);
  });

  it("levels", () => {
    expect(rmsOf([])).toBe(0);
    expect(rmsOf([0.5, -0.5])).toBeCloseTo(0.5);
  });

  it("reads whisper's answer as one line of speech", () => {
    expect(cleanText(" Trabolta, let us go.\n Please open the door.\n")).toBe("Trabolta, let us go. Please open the door.");
    expect(cleanText("I said (coughs) no [BLANK_AUDIO] *sighs* thanks")).toBe("I said no thanks");
  });

  it("calls what isn't speech nothing", () => {
    for (const none of ["", " [BLANK_AUDIO]\n", "(wind blowing)", "*door closes*", " ... "]) expect(cleanText(none)).toBe("");
  });

  it("says it back as one question", () => {
    expect(parrotLine("Open the door")).toBe("You said: Open the door. Is that right?");
    expect(parrotLine("Open the door!")).toBe("You said: Open the door! Is that right?");
  });
});

describe("the keys", () => {
  const LINK = "?code=x&spot=server-room&door=serial&webcam=%20C310%20&pad=1&whisper=1";

  it("come off the link and out of the address bar", () => {
    const h = hintsFromSearch(LINK);
    expect([h.webcam, h.pad, h.whisper]).toEqual(["C310", true, true]);
    expect(withoutSecrets(LINK)).toBe("");
  });

  it("are off when not given", () => {
    const h = hintsFromSearch("?code=x");
    expect([h.webcam, h.pad, h.whisper]).toEqual([null, null, null]);
    const c = defaultConfig({ eventId: "e", token: "t" });
    expect([c.webcam, c.pad, c.whisper]).toEqual(["", false, false]);
  });

  it("survive a reload, and an older stored config reads as off", () => {
    const old = { getItem: () => JSON.stringify({ eventId: "e", token: "t" }) };
    expect(loadConfig(old)).toMatchObject({ webcam: "", pad: false, whisper: false });
    const set = { getItem: () => JSON.stringify({ eventId: "e", token: "t", webcam: "C310", pad: true, whisper: true }) };
    expect(loadConfig(set)).toMatchObject({ webcam: "C310", pad: true, whisper: true });
  });
});

describe("the door on a first setup", () => {
  const heart = defaultConfig({ eventId: "e", token: "t", room: "The Server Room" });

  it("turns the sensor on for the heart's own terminal", () => {
    expect(setupDoor(heart, { first: true, touched: false }).door).toBe("serial");
  });

  it("leaves a choice made in ⚙ alone", () => {
    expect(setupDoor(heart, { first: true, touched: true }).door).toBe("off");
  });

  it("leaves a terminal already set up alone", () => {
    expect(setupDoor(heart, { first: false, touched: false }).door).toBe("off");
  });

  it("leaves every other terminal alone", () => {
    expect(setupDoor({ ...heart, room: "The Desktop" }, { first: true, touched: false }).door).toBe("off");
  });
});
