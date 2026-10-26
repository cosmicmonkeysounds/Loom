//! The voice clock (wave 26, V1; C11): a voiced TV scene's `t` follows his
//! speech off the speech bus.

import { afterEach, describe, expect, it } from "vitest";
import { clearSpeech, emitSpeech, onSpeech, recentSpeech, SPEECH_RING_LINES, setSpeechLive, speechLive, forgetSpeech, type SpeechEvent } from "../src/cutscene/speech-bus.ts";
import { VOICE_LOOKBACK_MS, VOICE_STRETCH_MAX_MS, VOICE_WAIT_MS, voiceClock, voiceState, type VoiceTiming } from "../src/cutscene/voice-clock.ts";

const S = 100_000; // the scene's start (server ms)
const DEF: VoiceTiming = { beats: ["Bottle Landed"], marks: [1000, 3000], tail: 2000, ms: 8000 };

const queued = (seq: number, at: number, chunks = 2, beat: string | null = "Bottle Landed"): SpeechEvent => ({ kind: "queued", seq, beat, chunks, at });
const line = (seq: number, at: number, texts: string[] = ["Excel.", "Truth or dare?"], beat: string | null = "Bottle Landed"): SpeechEvent[] => [
  { kind: "line", seq, beat, chunks: texts.length, texts, at },
  { kind: "chunk", seq, index: 0, at },
];
const chunk = (seq: number, index: number, at: number): SpeechEvent => ({ kind: "chunk", seq, index, at });
const done = (seq: number, at: number): SpeechEvent => ({ kind: "done", seq, at });

describe("voiceClock", () => {
  it("holds the frame just before his first sentence until he starts it", () => {
    const ev = [queued(5, S + 500)];
    expect(voiceClock(DEF, S, S + 800, ev)).toBe(800); // not there yet: as the server says
    expect(voiceClock(DEF, S, S + 1500, ev)).toBe(999); // there: waits for him
    expect(voiceClock(DEF, S, S + VOICE_WAIT_MS - 1, ev)).toBe(999);
    // A voice that never starts: the server's clock after VOICE_WAIT_MS.
    expect(voiceClock(DEF, S, S + VOICE_WAIT_MS, ev)).toBeNull();
  });

  it("runs from each sentence's mark as he says it; a slow one holds below the next mark", () => {
    const ev = [queued(5, S + 500), ...line(5, S + 1600)];
    expect(voiceClock(DEF, S, S + 2000, ev)).toBe(1400);
    expect(voiceClock(DEF, S, S + 4700, ev)).toBe(2999); // still on "Excel.": held
    ev.push(chunk(5, 1, S + 5000));
    expect(voiceClock(DEF, S, S + 5500, ev)).toBe(3500);
    expect(voiceClock(DEF, S, S + 9000, ev)).toBe(5999); // held below the end of his part (ms − tail)
  });

  it("a fast voice jumps ahead to the mark", () => {
    const ev = [queued(5, S), ...line(5, S + 200), chunk(5, 1, S + 900)];
    expect(voiceClock(DEF, S, S + 300, ev)).toBe(1100);
    expect(voiceClock(DEF, S, S + 1000, ev)).toBe(3100);
  });

  it("after his last line the scene runs on from ms − tail, ending tail after he stops", () => {
    const ev = [queued(5, S + 500), ...line(5, S + 1600), chunk(5, 1, S + 5000), done(5, S + 6000)];
    const v = voiceState(DEF, S, S + 6500, ev)!;
    expect(v.t).toBe(6500); // from 6000 (ms − tail), not 4000
    expect(v.ended).toBe(true);
    expect(v.endAt).toBe(S + 6000 + 2000);
    expect(v.spoken).toBeNull();
    // A slow voice that ran past ms − tail goes on from where it was held.
    const slow = [queued(5, S), ...line(5, S + 1000), chunk(5, 1, S + 3000), done(5, S + 12_000)];
    expect(voiceState(DEF, S, S + 12_000, slow)).toMatchObject({ t: 6000, endAt: S + 14_000 });
    // Before done, endAt is where the warped clock reaches ms at this pace.
    expect(voiceState(DEF, S, S + 2000, [queued(5, S), ...line(5, S + 1000)])).toMatchObject({ t: 2000, endAt: S + 2000 + 6000 });
  });

  it("tells the sentence being said, in the written words", () => {
    const ev = [queued(5, S), ...line(5, S + 1000, ["Antivirus.", "Truth or dare?"]), chunk(5, 1, S + 3000)];
    expect(voiceState(DEF, S, S + 1500, ev)?.spoken).toEqual({ seq: 5, index: 0, text: "Antivirus." });
    expect(voiceState(DEF, S, S + 3500, ev)?.spoken).toEqual({ seq: 5, index: 1, text: "Truth or dare?" });
    expect(voiceState(DEF, S, S + 500, ev)?.spoken).toBeNull(); // not yet
    // …and its mark index (the layer leaves a scene's `drawn` sentences uncaptioned).
    expect(voiceState(DEF, S, S + 1500, ev)?.mark).toBe(0);
    expect(voiceState(DEF, S, S + 3500, ev)?.mark).toBe(1);
    expect(voiceState(DEF, S, S + 500, ev)?.mark).toBeNull();
    // Merged sentences map by share: 1 spoken for 2 marks is mark 0.
    expect(voiceState(DEF, S, S + 1500, [queued(5, S, 1), ...line(5, S + 1000, ["Excel. Truth or dare?"])])?.mark).toBe(0);
  });

  it("ignores another beat's lines, lines from long before the moment, and a scene from history", () => {
    expect(voiceClock(DEF, S, S + 2000, [queued(5, S, 2, "Question Results"), ...line(5, S + 1000, ["A.", "B."], "Question Results")])).toBeNull();
    expect(voiceClock(DEF, S, S + 2000, [queued(5, S - VOICE_LOOKBACK_MS - 1), ...line(5, S + 1000)])).toBeNull();
    expect(voiceClock(DEF, S, S + 2000, [queued(5, S - VOICE_LOOKBACK_MS + 1), ...line(5, S + 1000)])).toBe(2000);
    expect(voiceClock(DEF, S, S + 2000, [queued(5, S + VOICE_WAIT_MS + 1)])).toBeNull();
    expect(voiceClock(DEF, 0, 2000, [queued(5, 0)])).toBeNull();
    expect(voiceClock({ ...DEF, marks: [] }, S, S + 2000, [queued(5, S)])).toBeNull();
    expect(voiceClock(DEF, S, S + 2000, [])).toBeNull();
    // Beat names fold like the story's.
    expect(voiceClock(DEF, S, S + 2000, [queued(5, S, 2, "bottle_landed"), ...line(5, S + 1000, ["A.", "B."], "bottle_landed")])).toBe(2000);
    expect(voiceClock(DEF, S, S + 2000, [queued(5, S, 2, null)])).toBeNull();
  });

  it("matches lines to the moment, not to a scene that waited in the queue", () => {
    const late = S + 10_000; // the scene started late behind another; its lines came with the moment
    const ev = [queued(5, S + 300), ...line(5, late + 400)];
    expect(voiceClock(DEF, late, late + 600, ev, S)).toBe(1200);
    expect(voiceClock(DEF, late, late + 600, ev)).toBeNull(); // matched against the late start: too old
  });

  it("maps a different sentence count by share: a merged name, a longer branch", () => {
    // 1 spoken sentence for 2 marks ("Excel. Truth or dare?" merged): from mark 0, held below the end.
    const one = [queued(5, S, 1), ...line(5, S + 1000, ["Excel. Truth or dare?"])];
    expect(voiceClock(DEF, S, S + 1500, one)).toBe(1500);
    expect(voiceClock(DEF, S, S + 9000, one)).toBe(5999);
    // 4 spoken for 2 marks: sentences 0–1 share mark 0 and run on as one; 2 starts mark 1.
    const four = [queued(5, S, 4), ...line(5, S + 1000, ["A.", "B.", "C.", "D."]), chunk(5, 1, S + 1500)];
    expect(voiceClock(DEF, S, S + 1800, four)).toBe(1800); // no step back at sentence 1
    four.push(chunk(5, 2, S + 2500));
    expect(voiceClock(DEF, S, S + 2600, four)).toBe(3100);
    // 2 spoken for 3 marks: sentence 1 starts mark 1 (of 0, 1, 2).
    const three: VoiceTiming = { beats: ["Bottle Landed"], marks: [1000, 2000, 3000] };
    expect(voiceClock(three, S, S + 1200, [queued(5, S), ...line(5, S + 1000), chunk(5, 1, S + 1100)])).toBe(2100);
  });

  it("several lines: a pause between them (another speaker's reading) holds below the next line's mark", () => {
    const def: VoiceTiming = { beats: ["Advice Helped"], marks: [1000, 2000, 5000], ms: 10_000, tail: 2000 };
    const ev: SpeechEvent[] = [queued(7, S, 1, "Advice Helped"), queued(9, S, 2, "Advice Helped"), ...line(7, S + 1000, ["You helped me."], "Advice Helped"), done(7, S + 2000)];
    expect(voiceClock(def, S, S + 1500, ev)).toBe(1500);
    expect(voiceClock(def, S, S + 2500, ev)).toBe(1999); // line 7 done, 9 not begun: not the end yet
    ev.push(...line(9, S + 6000, ["She said yes.", "Thank you."], "Advice Helped"));
    expect(voiceClock(def, S, S + 6100, ev)).toBe(2100);
    ev.push(chunk(9, 1, S + 7000), done(9, S + 8000));
    expect(voiceState(def, S, S + 8000, ev)).toMatchObject({ t: 8000, ended: true, endAt: S + 10_000 });
  });

  it("a line that finishes early ends his part: the scene runs on from ms − tail", () => {
    const ev = [queued(5, S), ...line(5, S + 1000), done(5, S + 1500)];
    expect(voiceState(DEF, S, S + 2000, ev)).toMatchObject({ t: 6500, ended: true });
  });

  it("a cut line (the mute) runs on from where it was, never jumping to his end", () => {
    const cut = (seq: number, at: number): SpeechEvent => ({ kind: "done", seq, at, cut: true });
    const ev = [queued(5, S), ...line(5, S + 1000), cut(5, S + 1500)];
    // At the cut t was 1500 (sentence 0 from mark 1000 + 500): on from there.
    expect(voiceState(DEF, S, S + 1500, ev)).toMatchObject({ t: 1500, ended: true, endAt: S + 1500 + 6500 });
    expect(voiceState(DEF, S, S + 2000, ev)).toMatchObject({ t: 2000, ended: true });
    // Cut before he began: on from the held frame (or the plain clock below it).
    expect(voiceState(DEF, S, S + 600, [queued(5, S), cut(5, S + 500)])).toMatchObject({ t: 600, ended: true });
    expect(voiceState(DEF, S, S + 2500, [queued(5, S), cut(5, S + 2000)])).toMatchObject({ t: 1499, ended: true });
  });

  it("once it falls back after VOICE_WAIT_MS, a voice that starts late never pulls the scene back", () => {
    const def: VoiceTiming = { beats: ["Pickup Line"], marks: [1500, 4200], ms: 8000, tail: 2600 };
    const ev: SpeechEvent[] = [queued(5, S + 500, 2, "Pickup Line")];
    expect(voiceClock(def, S, S + 5900, ev)).toBe(1499);
    expect(voiceClock(def, S, S + 6100, ev)).toBeNull();
    // A backlog: he only gets to it at +7 s.
    ev.push(...line(5, S + 7000, ["…The house says YES.", "That is the line."], "Pickup Line"));
    expect(voiceClock(def, S, S + 7000, ev)).toBeNull();
    ev.push(chunk(5, 1, S + 8000), done(5, S + 9000));
    expect(voiceState(def, S, S + 9500, ev)).toBeNull();
    // Started just inside the wait: on his voice.
    expect(voiceClock(def, S, S + 6500, [queued(5, S + 500, 2, "Pickup Line"), ...line(5, S + 5900, ["A.", "B."], "Pickup Line")])).toBe(2100);
    // A queued moment that started late: his line started before the scene did.
    expect(voiceClock(def, S, S + 6500, [queued(5, S - 1000, 2, "Pickup Line"), ...line(5, S - 500, ["A.", "B."], "Pickup Line")], S - 1000)).toBe(4199);
  });

  it("a hold scene has no end to move", () => {
    const v = voiceState({ beats: ["Present Award"], marks: [800, 3200], ms: "hold" }, S, S + 1000, [queued(5, S, 2, "Present Award"), ...line(5, S + 900, ["Most Trusted.", "Excel."], "Present Award")]);
    expect(v).toMatchObject({ t: 900, endAt: null });
    expect(VOICE_STRETCH_MAX_MS).toBe(20_000);
    expect(VOICE_WAIT_MS).toBe(6000);
  });
});

describe("the speech bus", () => {
  afterEach(() => clearSpeech());

  it("keeps the last SPEECH_RING_LINES lines' events, one done each, and tells listeners", () => {
    const heard: SpeechEvent[] = [];
    const off = onSpeech((e) => heard.push(e));
    for (let seq = 1; seq <= SPEECH_RING_LINES + 3; seq++) {
      emitSpeech(queued(seq, seq));
      emitSpeech(done(seq, seq + 1));
      emitSpeech(done(seq, seq + 2)); // a second done is dropped
    }
    off();
    emitSpeech(queued(999, 1));
    const seqs = new Set(recentSpeech().map((e) => e.seq));
    expect(seqs.size).toBe(SPEECH_RING_LINES);
    expect(seqs.has(1)).toBe(false);
    expect(seqs.has(999)).toBe(true);
    expect(recentSpeech().filter((e) => e.seq === 10 && e.kind === "done")).toHaveLength(1);
    expect(heard).toHaveLength(2 * (SPEECH_RING_LINES + 3));
    expect(recentSpeech()).toBe(recentSpeech()); // stable until the next event
    forgetSpeech();
    expect(recentSpeech()).toEqual([]);
  });

  it("a finished seq queued again starts a new line (a story restart reuses seqs)", () => {
    emitSpeech(queued(12, 10));
    emitSpeech(done(12, 20));
    emitSpeech(queued(12, 5000, 3, "The Verdict"));
    emitSpeech(done(12, 6000));
    expect(recentSpeech()).toEqual([queued(12, 5000, 3, "The Verdict"), done(12, 6000)]);
    // A line not finished keeps its events when it is queued again.
    emitSpeech(queued(13, 7000));
    emitSpeech(queued(13, 7100));
    expect(recentSpeech().filter((e) => e.seq === 13)).toHaveLength(2);
  });

  it("the live flag says whether a TV here can speak", () => {
    expect(speechLive()).toBe(false);
    setSpeechLive(true);
    expect(speechLive()).toBe(true);
    clearSpeech();
    expect(speechLive()).toBe(false);
  });
});
