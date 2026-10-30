//! The composer of a terminal with no keyboard (wave 52): SPEAK TO HIM → it
//! listens until the answer ends (or A) → whisper.cpp writes it down → he
//! says it back and asks → YES posts it as the program's own line, NO listens
//! again. Each step's buttons are `data-pad`, so the controller walks them
//! like any other choice, and B (`data-pad-back`) drops the answer at any
//! step, back to SPEAK TO HIM. A lazy chunk: `@loom/house`'s resampler stays
//! out of the main bundle.

import "./voice.css";
import { useEffect, useRef, useState } from "react";
import { record, transcribe, type Recording } from "./listen.ts";
import { VOICE_COPY, parrotLine } from "./speech.ts";

type Step = { k: "ready"; note: string | null } | { k: "listening" } | { k: "thinking" } | { k: "confirm"; text: string } | { k: "sending"; text: string };

export interface VoiceComposerProps {
  onSend: (text: string) => Promise<void>;
  disabled: boolean;
  /** Someone is using it: feeds the leash. */
  onInput: () => void;
  /** About to listen, or dropped: his voice stops, so it isn't what gets written down. */
  onListen: () => void;
  /** Say this, in his voice. */
  onSay: (text: string) => void;
}

export default function VoiceComposer({ onSend, disabled, onInput, onListen, onSay }: VoiceComposerProps) {
  const [step, setStep] = useState<Step>({ k: "ready", note: null });
  const recording = useRef<Recording | null>(null);
  const level = useRef<HTMLSpanElement>(null);
  // Each listen's number. B, or leaving the page, moves it on, and whatever
  // that listen was still waiting for is dropped when it lands.
  const turn = useRef(0);
  useEffect(
    () => () => {
      turn.current++;
      recording.current?.cancel();
    },
    [],
  );

  const listen = async () => {
    const mine = ++turn.current;
    const stale = () => mine !== turn.current;
    onInput();
    onListen();
    setStep({ k: "listening" });
    let wav: Uint8Array | null;
    try {
      const r = await record((rms) => {
        if (level.current !== null) level.current.style.transform = `scaleX(${Math.min(1, rms * 12)})`;
      });
      if (stale()) return r.cancel();
      recording.current = r;
      wav = await r.done;
      recording.current = null;
    } catch {
      if (!stale()) setStep({ k: "ready", note: VOICE_COPY.noMic });
      return;
    }
    if (stale()) return;
    onInput();
    if (wav === null) return setStep({ k: "ready", note: VOICE_COPY.nothing });
    setStep({ k: "thinking" });
    try {
      const text = await transcribe(wav);
      if (stale()) return;
      onInput();
      if (text === "") return setStep({ k: "ready", note: VOICE_COPY.nothing });
      setStep({ k: "confirm", text });
      onSay(parrotLine(text));
    } catch {
      if (!stale()) setStep({ k: "ready", note: VOICE_COPY.offline });
    }
  };

  const send = async (text: string) => {
    onInput();
    onListen();
    setStep({ k: "sending", text });
    try {
      await onSend(text);
      setStep({ k: "ready", note: null });
    } catch (e) {
      setStep({ k: "ready", note: (e as Error).message.toUpperCase() });
    }
  };

  const back = () => {
    turn.current++;
    recording.current?.cancel();
    recording.current = null;
    onInput();
    onListen();
    setStep({ k: "ready", note: null });
  };
  const backButton = (
    <button type="button" className="voice-back" data-pad-back onClick={back}>
      {VOICE_COPY.back}
    </button>
  );

  if (step.k === "listening")
    return (
      <div className="voice listening" role="status">
        <span className="voice-head">{VOICE_COPY.listening}</span>
        <span className="voice-meter" aria-hidden="true">
          <span ref={level} />
        </span>
        <button type="button" className="voice-btn" data-pad onClick={() => recording.current?.finish()}>
          {VOICE_COPY.done}
        </button>
        {backButton}
      </div>
    );
  if (step.k === "thinking")
    return (
      <div className="voice" role="status">
        <span className="voice-head">{VOICE_COPY.thinking}</span>
        {backButton}
      </div>
    );
  if (step.k === "confirm" || step.k === "sending")
    return (
      <div className="voice confirm">
        <span className="voice-head">{VOICE_COPY.said}</span>
        <span className="voice-text">{step.text}</span>
        <button type="button" className="voice-btn" data-pad disabled={step.k === "sending"} onClick={() => void send(step.text)}>
          {VOICE_COPY.yes}
        </button>
        <button type="button" className="voice-btn" data-pad disabled={step.k === "sending"} onClick={() => void listen()}>
          {VOICE_COPY.no}
        </button>
        {step.k === "confirm" && backButton}
      </div>
    );
  return (
    <div className="voice">
      {step.note !== null && <span className="voice-note">{step.note}</span>}
      <button type="button" className="voice-btn" data-pad disabled={disabled} onClick={() => void listen()}>
        🎤 {VOICE_COPY.speak}
      </button>
    </div>
  );
}
