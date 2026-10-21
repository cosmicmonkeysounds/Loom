//! The 🎤 corner cue (wave 19): shown while a player in the reinstallation
//! can hear this room — an honest sign that the microphone is on the air,
//! small and out of the way (the left edge, half way down, above the
//! slides: every view keeps its own top-left corner).

import { onAir, useVoiceStatus } from "./status.ts";

export function MicCue() {
  const s = useVoiceStatus();
  if (!onAir(s)) return null;
  return (
    <div className="mic-cue" role="status" title="A player in the reinstallation can hear this room" aria-label="microphone on: a player in the reinstallation can hear this room">
      🎤
    </div>
  );
}
