//! `view: tv` (OCT31 K-18 + N-04b) — the house Mac's Chrome, full screen on
//! the TV over the fireplace: the character's face, speaking his lines in the
//! TV's room in the Mac's own voice, the mouth moving as he speaks, a caption
//! under it. While
//! someone is in the reinstallation simulation the world takes the right of
//! the screen. The screen layer (slides / overlays, K-17) is drawn over it by
//! the app, and attract (the screensaver) stands until the introduction.
//!
//! The voice is the house Mac's own (decision 2026-10-15): Chrome's
//! `speechSynthesis` over the macOS voices, ranked by `pick-voice.ts`
//! (Samantha / an Enhanced or Premium download when installed; pick one in
//! ⚙). The server voice (`engine: server`, `/api/mod/tts`) is an opt-in that
//! latches back to the Mac's voice the first time the server has none.
//!
//! Sound: Chrome on the house Mac launches with
//! `--autoplay-policy=no-user-gesture-required`; without it (or after a
//! reboot that lost the flag) one click anywhere on the page enables the
//! voice. The mute (🔊 button, or the `M` key) is the director's — it lives on
//! the server (`POST /api/mod/screen/voice`), so it holds across a reload and
//! the Run page can flip it too (K-29).

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { baseOf, type TerminalConfig } from "./config.ts";
import { Face, type FaceHandle } from "./face/Face.tsx";
import { moodOfText, type Mood } from "./face/mood.ts";
import type { ScreenState } from "./screen.ts";
import { SpeechQueue, audioUnlocked, unlock, voiceEngines, voiceNote, type EngineKind } from "./speech/engine.ts";
import { splitSentences } from "./speech/split.ts";
import { LinePlayer, cursorAfterGap, planVoice, postVoiceMute, showsNameplate, type TvLine } from "./tv.ts";
import { useSpatialStream, useWorld, type Gone, type WorldStore } from "./world/stream.ts";
import { kioskFullscreen } from "./fullscreen.ts";
import { setSoundMuted } from "./sound/bus.ts";
import { onSceneFace } from "./cutscene/face-bus.ts";

/** A caption stays up this long after the last line (ms). */
const CAPTION_LINGER_MS = 6000;

export function Tv({
  config,
  state,
  cursor,
  attract,
  attractScreen,
  canDraw,
  worldSlot,
  gear,
  onGone,
}: {
  config: TerminalConfig;
  state: ScreenState | null;
  /** The chat cursor the screen poll sends as `after` (owned by the app). */
  cursor: MutableRefObject<number | null>;
  attract: boolean;
  attractScreen: ReactNode;
  canDraw: boolean;
  worldSlot: (store: WorldStore) => ReactNode;
  gear: ReactNode;
  onGone: (g: Gone) => void;
}) {
  const [mood, setMood] = useState<Mood>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [caption, setCaption] = useState<TvLine | null>(null);
  const [awake, setAwake] = useState(() => audioUnlocked());
  const [engineUsed, setEngineUsed] = useState<EngineKind | null>(null);
  const [latched, setLatched] = useState(false);
  // The mute as the server last said it, overridden by a click until the next poll agrees.
  const [localMute, setLocalMute] = useState<boolean | null>(null);
  const serverMute = state?.voice?.muted ?? false;
  const muted = localMute ?? serverMute;
  useEffect(() => {
    if (localMute !== null && localMute === serverMute) setLocalMute(null);
  }, [localMute, serverMute]);

  const face = useRef<FaceHandle | null>(null);
  // A cutscene's beat flashes the face's mood (wave 17, `cutscene/face-bus.ts`).
  useEffect(() => onSceneFace((m, ms) => face.current?.flash(m, ms)), []);

  // --- the world, while someone is in the simulation ---
  const world = useSpatialStream(config, canDraw);
  const inSimulation = useWorld(world, (s) => s.world.players.size > 0);
  const gone = useWorld(world, (s) => s.gone);
  useEffect(() => {
    if (gone !== null) onGone(gone);
  }, [gone, onGone]);

  // --- the voice: one speech queue, fed one line at a time by the player ---
  const waiters = useRef(new Map<number, () => void>());
  const queue = useMemo(() => {
    const engines = voiceEngines(
      { choice: config.engine, browserVoice: config.browserVoice, serverVoice: config.serverVoice, speed: config.speed, base: baseOf(config), token: config.token },
      () => setLatched(true),
    );
    const chunks = new Map<number, string[]>();
    const q = new SpeechQueue(engines, {
      level: (v) => face.current?.level(v),
      chunk: (id, i) => {
        setMood(moodOfText(chunks.get(id)?.[i] ?? ""));
        setSpeaking(true);
      },
      done: (id) => {
        chunks.delete(id);
        waiters.current.get(id)?.();
        waiters.current.delete(id);
      },
      idle: () => {
        setSpeaking(false);
        setMood("neutral");
      },
      engine: (kind) => setEngineUsed(kind),
    });
    return { q, chunks };
  }, [config]);

  const lingerTimer = useRef(0);
  const player = useMemo(
    () =>
      new LinePlayer({
        caption: (line) => {
          window.clearTimeout(lingerTimer.current);
          setCaption(line);
          if (line !== null && line.mode !== "speak") setMood(moodOfText(line.text));
        },
        speak: (line) =>
          new Promise<void>((resolve) => {
            const parts = splitSentences(line.text);
            if (parts.length === 0) return resolve();
            queue.chunks.set(line.seq, parts);
            waiters.current.set(line.seq, resolve);
            queue.q.say({ id: line.seq, chunks: parts });
          }),
        cancel: () => {
          queue.q.stop();
          for (const w of waiters.current.values()) w();
          waiters.current.clear();
          setSpeaking(false);
        },
        sleep: (ms) => new Promise((r) => window.setTimeout(r, ms)),
        idle: () => {
          window.clearTimeout(lingerTimer.current);
          lingerTimer.current = window.setTimeout(() => setCaption(null), CAPTION_LINGER_MS);
        },
      }),
    [queue],
  );
  useEffect(
    () => () => {
      player.stop();
      window.clearTimeout(lingerTimer.current);
    },
    [player],
  );

  // Every poll: the room's new lines → the player (the cursor moves first, so
  // a slow line never makes the next poll ask for it again).
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const lastAnswer = useRef<number | null>(null);
  useEffect(() => {
    const voice = state?.voice;
    if (state === null || voice === null || voice === undefined) return;
    const from = cursorAfterGap(cursor.current, lastAnswer.current, state.receivedAt);
    lastAnswer.current = state.receivedAt;
    const plan = planVoice(voice, from, { character: config.character, muted: mutedRef.current, attract });
    cursor.current = plan.cursor;
    player.push(plan.lines);
  }, [state, attract, config.character, cursor, player]);

  // The mute cuts the line being said at once — and the page's own accents.
  useEffect(() => {
    if (muted) player.stop();
  }, [muted, player]);
  useEffect(() => {
    setSoundMuted(muted);
    return () => setSoundMuted(false);
  }, [muted]);
  // Attract (a story restart, the character asleep): stop talking.
  useEffect(() => {
    if (attract) {
      player.stop();
      setCaption(null);
    }
  }, [attract, player]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setLocalMute(next);
    void postVoiceMute(config, next).then((v) => {
      if (v === null) setLocalMute(null); // refused / offline: the server's word stands
    });
  }, [config, muted]);

  // One click (or key) anywhere enables sound after a reboot; `M` mutes.
  const wake = useCallback(() => {
    void kioskFullscreen().request(); // a click: full screen too (`--kiosk` already is)
    void unlock().then(() => setAwake(audioUnlocked() || !("AudioContext" in window)));
  }, []);
  useEffect(() => {
    wake(); // with --autoplay-policy=no-user-gesture-required this succeeds unattended
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "m" || e.key === "M") toggleMute();
    };
    const onDown = () => {
      if (!audioUnlocked()) wake();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [wake, toggleMute]);

  const showWorld = canDraw && inSimulation && !attract;
  return (
    <div className={`terminal tv${showWorld ? " with-world" : ""}`} data-muted={String(muted)} data-speaking={String(speaking)}>
      <section className="tv-face">
        <Face mood={mood} speaking={speaking} handle={face} />
        {showsNameplate(state) && <div className="nameplate">{config.character.toUpperCase()}</div>}
      </section>
      {showWorld && <section className="tv-world">{worldSlot(world)}</section>}
      {caption !== null && !attract && (
        <div className={`tv-caption${caption.mode === "speak" ? "" : " text-only"}`} data-mode={caption.mode}>
          {caption.from !== config.character && <span className="tv-caption-who">{caption.from}: </span>}
          {caption.text}
        </div>
      )}
      {attract && <div className="tv-attract">{attractScreen}</div>}
      <div className="tv-status">
        <button type="button" className={`tv-mute${muted ? " on" : ""}`} onClick={toggleMute} title="Mute the TV voice (M)">
          {muted ? "🔇 VOICE MUTED" : "🔊 VOICE"}
        </button>
        {voiceNote(config.engine, engineUsed, latched) !== null && <span className="engine-note">{voiceNote(config.engine, engineUsed, latched)}</span>}
      </div>
      {!awake && (
        <button type="button" className="tv-wake" onClick={wake}>
          🔇 CLICK ONCE TO ENABLE THE VOICE
        </button>
      )}
      {gear}
      <div className="scanlines" aria-hidden="true" />
    </div>
  );
}
