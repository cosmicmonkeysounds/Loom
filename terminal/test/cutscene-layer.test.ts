import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ScreenLayer } from "../src/ScreenLayer.tsx";
import { CutsceneSlot } from "../src/cutscene/slot.tsx";
import { drawsSlides, roomOnly, screenTargetOf, silentView } from "../src/cutscene/load.ts";
import { ACTS, SCENES, duplicateIds } from "../src/cutscene/registry.ts";
import { NO_LAYERS, type ScreenLayers } from "../src/slides.ts";

const layers: ScreenLayers = { ...NO_LAYERS, slide: { value: "trivia_1", cue: "screens_trivia_1", seq: 3, at: 1000 } };

describe("the cutscene slot", () => {
  it("shows the slide's card until the chunk has loaded (a server render never loads it)", () => {
    const html = renderToStaticMarkup(createElement(ScreenLayer, { layers, gear: null, cutscene: (card) => createElement(CutsceneSlot, { state: null, layers, bare: false, card, gear: null }) }));
    expect(html).toContain("TRABOLTA TRIVIA · ROUND 1");
    expect(html).toContain('class="slide-tap"');
    expect(html).not.toContain("data-peekable"); // no tap handler: no peek
  });

  it("keeps the wrapper standing with no slide (the layer under it is never remounted)", () => {
    const html = renderToStaticMarkup(createElement(ScreenLayer, { layers: NO_LAYERS, gear: null, onSlideTap: () => {}, cutscene: () => null }));
    expect(html).toBe('<div class="slide-tap" data-peekable=""></div>');
  });

  it("a tap peeks only while a slide is up (never a moment alone)", () => {
    const tap = vi.fn();
    const slot = (l: ScreenLayers) => (ScreenLayer({ layers: l, gear: null, onSlideTap: tap, cutscene: () => null }) as { props: { children: { props: { onClick?: () => void } }[] } }).props.children[0]!.props.onClick;
    expect(slot(NO_LAYERS)).toBeUndefined();
    expect(slot(layers)).toBe(tap);
  });

  it("only screens that draw slides draw cutscenes", () => {
    for (const v of ["auto", "world", "face", "mirror", "tv", "shadow"]) expect(drawsSlides(v, null), v).toBe(true);
    expect(drawsSlides("chess", null)).toBe(false);
    expect(drawsSlides("casino", null)).toBe(false);
    // A room terminal mounts the layer for its room scenes only (wave 20).
    expect(drawsSlides("face", "The Server Room")).toBe(true);
    expect(roomOnly("face", "The Server Room")).toBe(true);
    expect(roomOnly("face", null)).toBe(false);
    expect(roomOnly("chess", "The Server Room")).toBe(false);
  });
});

describe("the registry", () => {
  it("lists the four act files, the house's wins and the heart's room scenes, with no id used twice", () => {
    expect(ACTS.map((a) => a.file)).toEqual(["act1", "act2", "act3", "moments", "house", "heart", "credits"]);
    expect(duplicateIds(SCENES)).toEqual([]);
    expect(duplicateIds([{ id: "a", when: [], ms: 1 }, { id: "a", when: [], ms: 2 }, { id: "b", when: [], ms: 3 }])).toEqual(["a"]);
  });

  it("every scene has a trigger, a length and something to draw", () => {
    for (const s of SCENES) {
      expect(s.when.length, s.id).toBeGreaterThan(0);
      expect(s.ms === "hold" || (typeof s.ms === "number" && s.ms > 0), s.id).toBe(true);
      expect(s.tv !== undefined || s.wall !== undefined, s.id).toBe(true);
    }
  });
});

describe("the cutscene layer, drawn", () => {
  it("draws a slide's scene in the slot, a moment's over nothing, the card for a slide with none", async () => {
    // A server render warns about the kit's layout effects (they measure a canvas / a marquee): expected here.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { CutsceneLayer } = await import("../src/cutscene/CutsceneLayer.tsx");
    const { DEMO_SCENES } = await import("../src/cutscene/scenes/demo.tsx");
    const { fakeState } = await import("../src/cutscene/fake.ts");
    const now = Date.now();
    const slide = { value: "kit_demo", cue: "tv_kit_demo", seq: 9, at: now - 5500 };
    const html = renderToStaticMarkup(createElement(CutsceneLayer, { state: fakeState({ now }), layers: { overlay: null, slide }, bare: false, card: createElement("i", null, "CARD"), gear: null, scenes: DEMO_SCENES, target: "tv" }));
    expect(html).toContain('data-scene="demo"');
    expect(html).toContain('data-seq="9"');
    expect(html).toContain("Installing the Kit"); // 5.5 s in: the desktop phase
    expect(html).not.toContain("CARD");
    // A slide no scene draws: its card.
    const card = renderToStaticMarkup(createElement(CutsceneLayer, { state: fakeState({ now }), layers: { overlay: null, slide: { ...slide, value: "beans" } }, bare: false, card: createElement("i", null, "CARD"), gear: null, scenes: DEMO_SCENES, target: "wall" }));
    expect(card).toBe('<div class="cutscene-base"><i>CARD</i></div>');
    // A fresh moment over no slide, with the ⚙ (no slide brought one).
    const m = fakeState({ now, target: "terminals", moments: [{ seq: 4, at: now - 13_000, kind: "signal", name: "Kit Demo", who: "Excel", kept: false }] });
    const top = renderToStaticMarkup(createElement(CutsceneLayer, { state: m, layers: { overlay: null, slide: null }, bare: false, card: null, gear: createElement("b", null, "GEAR"), scenes: DEMO_SCENES }));
    expect(top).toContain('class="cutscene-stage cutscene-moment"');
    expect(top).toContain("Windows"); // 13 s in: the blue screen
    expect(top).toContain("<b>GEAR</b>");
    // A moment that replaces a slide keeps its card mounted, hidden (its clip
    // never starts over), and the moment's stage stands in its own wrapper.
    const over = fakeState({ now, target: "terminals", moments: [{ seq: 5, at: now - 13_000, kind: "signal", name: "Kit Demo", who: null, kept: false }] });
    const both = renderToStaticMarkup(createElement(CutsceneLayer, { state: over, layers: { overlay: null, slide: { ...slide, value: "beans", seq: 10 } }, bare: false, card: createElement("i", null, "CARD"), gear: createElement("b", null, "GEAR"), scenes: DEMO_SCENES }));
    expect(both).toContain('<div class="cutscene-base" data-hidden="" aria-hidden="true"><i>CARD</i></div>');
    expect(both).toContain('<div class="cutscene-top"><div class="cutscene-stage cutscene-moment"');
    expect(both).not.toContain("GEAR"); // the slide brought the ⚙ already
    // An overlay or a pilot: nothing.
    expect(renderToStaticMarkup(createElement(CutsceneLayer, { state: m, layers: { overlay: "alarm", slide: null }, bare: false, card: null, gear: null, scenes: DEMO_SCENES }))).toBe("");
    quiet.mockRestore();
  });
});

describe("the mirror fallback (X5)", () => {
  it("draws the TV's takes (no wall gags) and keeps its effects silent", () => {
    expect(screenTargetOf("mirror")).toBe("tv");
    expect(screenTargetOf("tv")).toBe("tv");
    for (const v of ["auto", "world", "face", "shadow"]) expect(screenTargetOf(v), v).toBe("wall");
    expect(silentView("mirror")).toBe(true);
    expect(silentView("tv")).toBe(false);
    expect(silentView("auto")).toBe(false);
  });
});

describe("a slide scene hidden under a moment (OB-6)", () => {
  it("is drawn frozen at the frame it was covered, then live again", async () => {
    const { baseClock, sameSceneFrame } = await import("../src/cutscene/CutsceneLayer.tsx");
    expect(baseClock(1000, 1500, false)).toBe(1500);
    expect(baseClock(1000, 1500, true)).toBe(1000);
    const scene = { kind: "slide" as const, def: { id: "x", when: [], ms: "hold" as const }, seq: 1, at: 1, start: 1, value: "x", who: null, key: "x:s1" };
    const state = {} as never;
    const a = { scene, now: 1000, t: null, voice: null, caption: null, state, target: "tv" as const, reduced: false, silent: true };
    // A new pick object for the same scene at the same frozen clock: no redraw.
    expect(sameSceneFrame(a, { ...a, scene: { ...scene } })).toBe(true);
    expect(sameSceneFrame(a, { ...a, now: 1033 })).toBe(false);
    // Wave 26 (V1): a new warped t, sentence or caption redraws; the same one doesn't.
    expect(sameSceneFrame(a, { ...a, t: 500 })).toBe(false);
    expect(sameSceneFrame({ ...a, voice: { seq: 1, index: 0, text: "Hi." } }, { ...a, voice: { seq: 1, index: 0, text: "Hi." } })).toBe(true);
    expect(sameSceneFrame(a, { ...a, voice: { seq: 1, index: 0, text: "Hi." } })).toBe(false);
    expect(sameSceneFrame(a, { ...a, caption: "Hi." })).toBe(false);
  });
});

describe("a voiced scene on the TV (wave 26, V1)", () => {
  it("is drawn at his voice's t with his sentence captioned; a wall, a muted TV: the server's clock", async () => {
    const { CutsceneLayer } = await import("../src/cutscene/CutsceneLayer.tsx");
    const { fakeState } = await import("../src/cutscene/fake.ts");
    const bus = await import("../src/cutscene/speech-bus.ts");
    const { BOTTLE_SPIN_MS } = await import("../src/cutscene/kit/tv1-time.ts");
    const Probe = (p: { t: number; voice?: { text: string } | null }) => createElement("p", null, `t=${Math.round(p.t)} voice=${p.voice?.text ?? "-"}`);
    const scenes = [{ id: "bottle_landed", when: [{ moment: "signal" as const, name: "bottle_landed" }], ms: 14_000, tv: Probe, wall: Probe }];
    const now = 7_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      bus.clearSpeech();
      bus.emitSpeech({ kind: "queued", seq: 812, beat: "Bottle Landed", chunks: 2, at: now - 1400 });
      bus.emitSpeech({ kind: "line", seq: 812, beat: "Bottle Landed", chunks: 2, texts: ["Excel.", "Truth or dare?"], at: now - 500 });
      bus.emitSpeech({ kind: "chunk", seq: 812, index: 0, at: now - 500 });
      // A story epoch of its own: the layer's queues (kept per target across mounts) start over.
      const moment = (seq: number) => ({ ...fakeState({ now, moments: [{ seq, at: now - 1500, kind: "signal", name: "bottle_landed", who: "Excel", kept: false }] }), announceEpoch: `voice-${seq}` });
      const draw = (seq: number, target: "tv" | "wall") => renderToStaticMarkup(createElement(CutsceneLayer, { state: moment(seq), layers: { overlay: null, slide: null }, bare: false, card: null, gear: null, scenes, target }));
      bus.setSpeechLive(true);
      const tv = draw(61, "tv");
      expect(tv).toContain(`t=${BOTTLE_SPIN_MS + 500} voice=Excel.`);
      expect(tv).toContain('data-voiced=""');
      // The bottle draws "<pick>." itself (ownCaption): the scene gets his
      // sentence, the layer adds no second copy.
      expect(tv).not.toContain("cutscene-voice-caption");
      const wall = draw(62, "wall");
      expect(wall).toContain("t=1500 voice=-");
      expect(wall).not.toContain("cutscene-voice-caption");
      bus.setSpeechLive(false); // muted / attract
      expect(draw(63, "tv")).toContain("t=1500 voice=-");
    } finally {
      bus.clearSpeech();
      vi.useRealTimers();
    }
  });

  it("the stage draws the layer's caption over the scene", async () => {
    const { SceneStage } = await import("../src/cutscene/CutsceneLayer.tsx");
    const { fakeState } = await import("../src/cutscene/fake.ts");
    const Probe = () => createElement("p", null, "scene");
    const html = renderToStaticMarkup(createElement(SceneStage, { def: { id: "verdict", when: [], ms: 1000, tv: Probe }, kind: "moment", target: "tv", t: 0, at: 1, seq: 1, value: "", who: null, state: fakeState({ now: 1 }), reduced: false, play: () => false, onDone: () => {}, voice: { seq: 1, index: 0, text: "I have compared every fact." }, caption: "I have compared every fact." }));
    expect(html).toContain('<div class="cutscene-voice-caption" aria-live="polite">I have compared every fact.</div>');
  });

  it("captions only a scene that doesn't draw his sentence itself", async () => {
    const { voiceCaption } = await import("../src/cutscene/CutsceneLayer.tsx");
    const s = (id: string) => ({ kind: "moment" as const, def: { id, when: [], ms: 1000 }, seq: 1, at: 1, start: 1, value: "", who: null, key: id });
    const v = { t: 1, spoken: { seq: 1, index: 1, text: "I am Jean Trabolta." }, mark: 1, ended: false, endAt: null };
    expect(voiceCaption(s("verdict"), v)).toBe("I am Jean Trabolta.");
    expect(voiceCaption(s("trabolta_introduction"), v)).toBeNull(); // the intro types it itself
    expect(voiceCaption(s("bottle_landed"), v)).toBeNull(); // the bottle draws "<pick>." and "Truth or dare?"
    // advice_helped: SandyChat types the proposal (its `drawn`), the rest is captioned.
    expect(voiceCaption(s("advice_helped"), { ...v, mark: 6 })).toBeNull();
    expect(voiceCaption(s("advice_helped"), { ...v, mark: 0 })).toBe("I am Jean Trabolta.");
    expect(voiceCaption(s("verdict"), { ...v, spoken: null })).toBeNull();
    expect(voiceCaption(s("verdict"), undefined)).toBeNull();
  });

  it("(wave 32) hands a scene the sentence with its mark: its place across all his lines", async () => {
    const { sceneVoiceOf } = await import("../src/cutscene/CutsceneLayer.tsx");
    const v = { t: 1, spoken: { seq: 12, index: 0, text: "I did not freeze." }, mark: 7, ended: false, endAt: null };
    expect(sceneVoiceOf(v)).toEqual({ seq: 12, index: 0, text: "I did not freeze.", mark: 7 });
    expect(sceneVoiceOf({ ...v, mark: null })).toEqual({ seq: 12, index: 0, text: "I did not freeze." });
    expect(sceneVoiceOf({ ...v, spoken: null, mark: null })).toBeNull();
    expect(sceneVoiceOf(undefined)).toBeNull();
  });
});

describe("a voiced moment whose voice never comes (wave 26, V1)", () => {
  it("ends at its own ms once it falls back, not where the wait pushed it", async () => {
    const { CutsceneLayer } = await import("../src/cutscene/CutsceneLayer.tsx");
    const { fakeState } = await import("../src/cutscene/fake.ts");
    const bus = await import("../src/cutscene/speech-bus.ts");
    const { BOTTLE_SPIN_MS } = await import("../src/cutscene/kit/tv1-time.ts");
    const { VOICE_WAIT_MS } = await import("../src/cutscene/voice-clock.ts");
    const Probe = (p: { t: number }) => createElement("p", null, `t=${Math.round(p.t)}`);
    const scenes = [{ id: "bottle_landed", when: [{ moment: "signal" as const, name: "bottle_landed" }], ms: 14_000, tv: Probe }];
    const at = 9_000_000_000;
    vi.useFakeTimers();
    try {
      bus.clearSpeech();
      bus.setSpeechLive(true);
      bus.emitSpeech({ kind: "queued", seq: 950, beat: "Bottle Landed", chunks: 2, at: at + 500 });
      const state = { ...fakeState({ now: at, moments: [{ seq: 81, at, kind: "signal", name: "bottle_landed", who: "Excel", kept: false }] }), announceEpoch: "voice-never" };
      const draw = (now: number) => {
        vi.setSystemTime(now);
        return renderToStaticMarkup(createElement(CutsceneLayer, { state, layers: { overlay: null, slide: null }, bare: false, card: null, gear: null, scenes, target: "tv" }));
      };
      // Waiting for him: held at the frame before his first sentence; its end moves out.
      expect(draw(at + VOICE_WAIT_MS - 100)).toContain(`t=${BOTTLE_SPIN_MS - 1}`);
      // He never starts: the server's clock, and the moment's own end again.
      expect(draw(at + VOICE_WAIT_MS + 100)).toContain(`t=${VOICE_WAIT_MS + 100}`);
      expect(draw(at + 14_000 - 50)).toContain("t=13950");
      expect(draw(at + 14_000 + 50)).not.toContain("t=");
    } finally {
      bus.clearSpeech();
      vi.useRealTimers();
    }
  });
});

describe("a voiced scene through a mute (wave 26, V1)", () => {
  it("keeps following his (now ended) lines instead of jumping back to the server's clock", async () => {
    const { CutsceneLayer } = await import("../src/cutscene/CutsceneLayer.tsx");
    const { fakeState } = await import("../src/cutscene/fake.ts");
    const bus = await import("../src/cutscene/speech-bus.ts");
    const { BOTTLE_SPIN_MS } = await import("../src/cutscene/kit/tv1-time.ts");
    const Probe = (p: { t: number }) => createElement("p", null, `t=${Math.round(p.t)}`);
    const scenes = [{ id: "bottle_landed", when: [{ moment: "signal" as const, name: "bottle_landed" }], ms: 14_000, tv: Probe }];
    const now = 8_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      bus.clearSpeech();
      bus.emitSpeech({ kind: "queued", seq: 900, beat: "Bottle Landed", chunks: 2, at: now - 1400 });
      bus.emitSpeech({ kind: "line", seq: 900, beat: "Bottle Landed", chunks: 2, texts: ["Excel.", "Truth or dare?"], at: now - 500 });
      bus.emitSpeech({ kind: "chunk", seq: 900, index: 0, at: now - 500 });
      const state = { ...fakeState({ now, moments: [{ seq: 71, at: now - 1500, kind: "signal", name: "bottle_landed", who: "Excel", kept: false }] }), announceEpoch: "voice-mute" };
      const el = (st: typeof state) => createElement(CutsceneLayer, { state: st, layers: { overlay: null, slide: null }, bare: false, card: null, gear: null, scenes, target: "tv" });
      bus.setSpeechLive(true);
      expect(renderToStaticMarkup(el(state))).toContain(`t=${BOTTLE_SPIN_MS + 500}`);
      // The director mutes: the TV drops the line (cut); the scene runs on
      // from where it was, never skipping ahead to the end of his part.
      bus.setSpeechLive(false);
      bus.emitSpeech({ kind: "done", seq: 900, at: now, cut: true });
      vi.setSystemTime(now + 100);
      expect(renderToStaticMarkup(el(state))).toContain(`t=${BOTTLE_SPIN_MS + 600}`);
    } finally {
      bus.clearSpeech();
      vi.useRealTimers();
    }
  });
});
