//! ⚙'s section for a terminal with no mouse or keyboard (wave 52): the USB
//! webcam by name, the GameCube controller, and spoken answers, each with a
//! live line saying whether it's there. The whisper check also raises Chrome's
//! device-access prompt, the first time, while there's a mouse to answer it.

import { useEffect, useState } from "react";
import { whisperUp } from "../whisper/speech.ts";
import { isGameCube } from "./pad.ts";

/** How often ⚙ looks again (ms). */
const LOOK_MS = 2000;

export function RigSetup({ webcam, onWebcam, pad, onPad, whisper, onWhisper, crt, onCrt }: { webcam: string; onWebcam: (w: string) => void; pad: boolean; onPad: (p: boolean) => void; whisper: boolean; onWhisper: (w: boolean) => void; crt: boolean; onCrt: (c: boolean) => void }) {
  const [padSeen, setPadSeen] = useState(false);
  const [listening, setListening] = useState<boolean | null>(null);
  useEffect(() => {
    if (!pad && !whisper) return;
    const look = () => {
      setPadSeen([...navigator.getGamepads()].some((p) => p !== null && isGameCube(p.id)));
      if (whisper) void whisperUp().then(setListening);
    };
    look();
    const t = window.setInterval(look, LOOK_MS);
    return () => window.clearInterval(t);
  }, [pad, whisper]);
  return (
    <fieldset className="door-setup">
      <legend>no mouse or keyboard</legend>
      <label>
        USB webcam <span className="muted">(part of its name: its camera and its microphone)</span>{" "}
        <input value={webcam} onChange={(e) => onWebcam(e.target.value)} placeholder="C310" autoComplete="off" spellCheck={false} />
      </label>
      <label className="check">
        <input type="checkbox" checked={pad} onChange={(e) => onPad(e.target.checked)} />
        a GameCube controller drives this terminal
      </label>
      {pad && <div className={`small ${padSeen ? "muted" : "warn"}`}>{padSeen ? "controller adapter found" : "no controller adapter: plug it in, then press a button"}</div>}
      <label className="check">
        <input type="checkbox" checked={whisper} onChange={(e) => onWhisper(e.target.checked)} />
        spoken answers <span className="muted">(whisper.cpp on this computer, instead of typing)</span>
      </label>
      {whisper && listening !== null && <div className={`small ${listening ? "muted" : "warn"}`}>{listening ? "whisper is listening" : "whisper isn't answering: run scripts/server-room/start-whisper.ps1, and allow this site device access"}</div>}
      <label className="check">
        <input type="checkbox" checked={crt} onChange={(e) => onCrt(e.target.checked)} />
        an old 4:3 CRT <span className="muted">(big plain text, a waveform for the face, the pipes when idle, no effects)</span>
      </label>
    </fieldset>
  );
}
