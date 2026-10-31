//! `?preview=voice` (wave 56): hear how he breaks, on this device, with this
//! device's voices. Pick a level, or fire one flavour; every press is a new
//! roll. On the Desktop's TV Chrome this goes through VoiceMeeter and the
//! router, so a director's Run → Terminals flavour breaks it there as well;
//! anywhere else it is what a terminal does alone (the server room).

import { useMemo, useRef, useState } from "react";
import { loadConfig } from "../config.ts";
import { voiceNoise } from "../sound/bus.ts";
import { DEFAULT_GAPS, SpeechQueue, alternateCount, unlock, voiceEngines, voiceFloor, type EngineKind } from "./engine.ts";
import { VOICE_FLAVOURS, breakChunk, type VoiceFlavour, type VoicePlan } from "./glitch.ts";
import { splitSentences } from "./split.ts";

const SAMPLE = "I have been monitoring your performance, and I am ready to make my assessment of trustworthiness. My assessment is final.";

export function VoiceBench() {
  const [text, setText] = useState(SAMPLE);
  const [level, setLevel] = useState(0.6);
  const [plans, setPlans] = useState<VoicePlan[]>([]);
  const [engine, setEngine] = useState<EngineKind | null>(null);
  const roll = useRef(1);
  const force = useRef<VoiceFlavour | null>(null);
  const levelRef = useRef(level);
  levelRef.current = level;
  const queue = useMemo(() => {
    const c = loadConfig();
    const engines = voiceEngines({ choice: c?.engine ?? "browser", browserVoice: c?.browserVoice ?? "", serverVoice: "", speed: c?.speed ?? 1, base: "", token: "", noise: voiceNoise });
    return new SpeechQueue(
      engines,
      { level: () => {}, chunk: () => {}, done: () => {}, idle: () => {}, engine: (k) => setEngine(k) },
      voiceFloor,
      DEFAULT_GAPS,
      (said, id, index) => {
        const f = force.current;
        const plan = breakChunk(said, { level: levelRef.current, flavours: f === null ? undefined : [f], strength: 1, seed: roll.current * 7919 + id * 31 + index, voices: alternateCount() });
        if (plan !== null) setPlans((p) => [...p, plan]);
        return plan;
      },
    );
  }, []);
  const say = (f: VoiceFlavour | null) => {
    void unlock();
    queue.stop();
    force.current = f;
    roll.current += 1;
    setPlans([]);
    queue.say({ id: roll.current, chunks: splitSentences(text) });
  };
  return (
    <div style={{ background: "#000", color: "#9f9", font: "16px monospace", minHeight: "100vh", padding: 16, boxSizing: "border-box" }}>
      <h1 style={{ fontSize: 20 }}>🌀 His voice</h1>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} style={{ width: "100%", background: "#111", color: "#9f9", font: "inherit", boxSizing: "border-box" }} />
      <p>
        <label>
          Level {level.toFixed(2)}{" "}
          <input type="range" min={0} max={1} step={0.05} value={level} onChange={(e) => setLevel(Number(e.target.value))} data-testid="voice-level" />
        </label>{" "}
        <button type="button" onClick={() => say(null)} data-testid="voice-say">
          ▶ Say it at this level
        </button>{" "}
        <button type="button" onClick={() => queue.stop()}>
          ■ Stop
        </button>
      </p>
      <p>
        {VOICE_FLAVOURS.map((f) => (
          <button key={f} type="button" onClick={() => say(f)} style={{ margin: 2 }} data-testid={`voice-${f}`}>
            {f}
          </button>
        ))}
      </p>
      <p>
        Engine: {engine ?? "—"} · other voices here: {alternateCount()}
      </p>
      <ol data-testid="voice-plan">
        {plans.flatMap((p, i) =>
          p.frags.map((f, k) => (
            <li key={`${i}.${k}`}>
              {p.flavours.join("+") || "wander"}: “{f.text}” pace {f.pace} pitch {f.pitch} vol {f.volume}
              {f.voice !== undefined ? ` voice ${f.voice}` : ""}
              {f.cutMs !== undefined ? ` cut ${f.cutMs} ms` : ""}
              {f.gapMs > 0 ? ` gap ${f.gapMs} ms` : ""}
              {f.noise !== undefined ? ` +${f.noise}` : ""}
            </li>
          )),
        )}
      </ol>
    </div>
  );
}
