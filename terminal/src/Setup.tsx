//! ⚙ — setting a tablet up in two steps:
//!
//!   1. CONNECT — the event's moderator passcode (skipped when this tablet
//!      already has access).
//!   2. WHICH TERMINAL IS THIS? — the event's live house map's terminals (the
//!      map it plays: a director's save, the shed variant), by floor then
//!      room, each a big button saying where it hangs and what it shows, and
//!      whether another tablet is online on it right now. One tap powers on.
//!
//! Everything else (character, camera, voice, announcements, the camera
//! feed, the voice link's microphone and speaker, a manual screen type or
//! room) sits under a folded *advanced*.

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_TV_ROOM, VIEWS, VIEW_INFO, announceChoiceValue, announceFromChoice, baseOf, connect, defaultConfig, pickCharacter, roomChoices, savedCharacter, type TerminalConfig, type TerminalView } from "./config.ts";
import { feedStatusText, feedWanted, useFeedStatus } from "./camfeed.ts";
import { micBox, voiceRoles } from "./voice/roles.ts";
import { voiceStatus, voiceStatusText } from "./voice/status.ts";
import { fetchCharacters } from "./pilot.ts";
import { BrowserEngine, DeviceEngine, ENGINE_LABEL, SpeechQueue, deviceEnv, pickDeviceEngine, unlock, voiceEngines, type EngineKind, type VoiceChoice } from "./speech/engine.ts";
import { ringChime } from "./announce.ts";
import { CHARACTER_VOICE, rankVoices } from "./speech/pick-voice.ts";
import { bundledHouse, fetchHouse, type HouseInfo } from "./world/stream.ts";
import { hasWebGL2 } from "./webgl.ts";
import { UNPLACED, applyPick, groupTerminals, onlineBadge, withManual, type Heartbeat, type MapPick } from "./setup-map.ts";

interface Access {
  eventId: string;
  token: string;
  title: string;
}

/** The heartbeats (`GET /api/mod/screen/terminals`), every 5 s while open. */
function useHeartbeats(access: Access | null): { beats: Heartbeat[]; silentMs: number } {
  const [state, setState] = useState<{ beats: Heartbeat[]; silentMs: number }>({ beats: [], silentMs: 20_000 });
  useEffect(() => {
    if (access === null) return;
    let alive = true;
    const read = () =>
      void fetch(`${baseOf(access)}/api/mod/screen/terminals`, { headers: { "x-loom-token": access.token } })
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { terminals?: Heartbeat[]; silentMs?: number } | null) => {
          if (alive && b !== null && Array.isArray(b.terminals)) setState({ beats: b.terminals, silentMs: b.silentMs ?? 20_000 });
        })
        .catch(() => {});
    read();
    const t = window.setInterval(read, 5000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [access]);
  return state;
}

/** `step`: where setup opens — `connect` when the stored access is no good
 *  (the event ended: a new passcode first), `character` when the story
 *  lacks this terminal's character (advanced, unfolded). */
export function Setup({
  current,
  notice,
  step,
  spotAnnounce = null,
  onDone,
  onForget,
}: {
  current: TerminalConfig | null;
  notice: string | null;
  step?: "connect" | "character";
  /** What the house setting says for this tablet's spot now (the last
   *  screen state's `spot.announce`; null = unknown). */
  spotAnnounce?: boolean | null;
  onDone: (c: TerminalConfig) => void;
  onForget: () => void;
}) {
  const [access, setAccess] = useState<Access | null>(() => (current === null || step === "connect" ? null : { eventId: current.eventId, token: current.token, title: current.title }));
  const [changing, setChanging] = useState(false);
  const [advanced, setAdvanced] = useState(step === "character");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(notice);
  const [busy, setBusy] = useState(false);
  const [map, setMap] = useState<HouseInfo | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const [cast, setCast] = useState<readonly string[]>([]);

  // advanced
  const [character, setCharacter] = useState(current?.character ?? "");
  const [camera, setCamera] = useState<TerminalConfig["camera"]>(current?.camera ?? "user");
  const [engine, setEngine] = useState<VoiceChoice>(current?.engine ?? "browser");
  // Wave 18b, Q8: null = the house setting (`audio.json`'s list), else Always / Never.
  const [announce, setAnnounce] = useState<boolean | null>(current?.announce ?? null);
  const [serverVoice, setServerVoice] = useState(current?.serverVoice ?? "");
  const [browserVoice, setBrowserVoice] = useState(current?.browserVoice ?? "");
  const [speed, setSpeed] = useState(current?.speed ?? 1);
  const [camFeed, setCamFeed] = useState(current?.camFeed ?? true);
  // The voice link's microphone: undefined = the view's default (the TV's is off).
  const [mic, setMic] = useState<boolean | undefined>(current?.mic);
  const [voicesOn, setVoicesOn] = useState(current?.voices ?? true);
  const [fullscreen, setFullscreen] = useState(current?.fullscreen ?? true);
  // A manual screen type / room ("" = the map's). A terminal not set up from
  // the map shows what it had; that applies to a tap on its own spot only
  // (another terminal takes the map's) unless changed here.
  const manual = current !== null && current.fromMap !== true && current.spot !== "";
  const [viewOverride, setViewOverride] = useState<TerminalView | "">(manual ? current.view : "");
  const [roomOverride, setRoomOverride] = useState(manual ? current.room : "");
  const [manualTouched, setManualTouched] = useState(false);
  const [tested, setTested] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const feed = useFeedStatus();
  // The link stops while ⚙ is open (D9): show how it stood when ⚙ opened
  // (read while this screen first renders, before the link's cleanup runs).
  const [voice] = useState(() => voiceStatus.snapshot);
  const heart = useHeartbeats(access);

  useEffect(() => {
    if (!BrowserEngine.available()) return;
    const load = () => setVoices(rankVoices(speechSynthesis.getVoices(), CHARACTER_VOICE));
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  // The live map and the cast, once connected.
  useEffect(() => {
    if (access === null) return;
    let alive = true;
    setMapFailed(false);
    void fetchHouse(access)
      .then((h) => alive && setMap(h))
      .catch(() => {
        if (!alive) return;
        setMapFailed(true);
        setMap(bundledHouse());
      });
    void fetchCharacters(defaultConfig({ ...access, character: current?.character ?? "" }))
      .then((c) => {
        if (!alive) return;
        setCast(c);
        setCharacter((now) => (now.trim() !== "" ? now : pickCharacter(null, c)));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [access]);

  const groups = useMemo(() => (map === null ? [] : groupTerminals(map.house)), [map]);
  const rooms = useMemo(() => roomChoices(map?.house ?? null), [map]);
  // This tablet as it is now (its spot highlighted; its own heartbeat is no
  // "other tablet") — across a new event's passcode too.
  const self = current !== null ? { name: current.name, spot: current.spot } : null;
  const showConnect = access === null || changing;

  const doConnect = async () => {
    if (code.trim() === "") {
      setError("Enter the moderator passcode.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const c = await connect(code.trim());
      setAccess({ eventId: c.eventId, token: c.token, title: c.title });
      setCast(c.characters);
      setCharacter((now) => (now.trim() !== "" ? now : pickCharacter(null, c.characters)));
      setChanging(false);
      setCode("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const choose = async (pick: MapPick) => {
    if (access === null) return;
    setBusy(true);
    setError(null);
    try {
      const sameEvent = current !== null && current.eventId === access.eventId;
      const base: TerminalConfig = sameEvent ? { ...current, token: access.token, title: access.title || current.title } : defaultConfig({ ...access, character: pickCharacter(null, cast) });
      const kept = await savedCharacter(character, base.character, async () => cast);
      const voiceFields = mic === undefined ? { voices: voicesOn } : { voices: voicesOn, mic };
      const picked = applyPick({ ...base, character: kept, camera, engine, announce, camFeed, ...voiceFields, fullscreen, serverVoice: serverVoice.trim(), browserVoice, speed }, pick);
      if (mic === undefined) delete picked.mic;
      const next = picked;
      const own = manualTouched || (current !== null && current.spot === pick.spot);
      onDone(own ? withManual(next, pick, { view: viewOverride, room: roomOverride }) : next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const testVoice = async () => {
    await unlock();
    setTested("…");
    const engines =
      engine === "server" && access !== null
        ? voiceEngines({ choice: "server", browserVoice, serverVoice: serverVoice.trim(), speed, base: baseOf(access), token: access.token })
        : { primary: new DeviceEngine({ voice: browserVoice, speed, choice: engine === "server" ? "browser" : engine, prefer: CHARACTER_VOICE }), fallback: null };
    let used: EngineKind | null = null;
    const q = new SpeechQueue(engines, {
      level: () => {},
      chunk: () => {},
      done: () => {},
      idle: () => setTested(used === null ? "nothing could speak" : `spoke with: ${ENGINE_LABEL[used]}`),
      engine: (k) => (used = k),
    });
    q.say({ id: 1, chunks: ["Connection established.", "I have been expecting you, program."] });
  };

  const env = deviceEnv();
  const native = pickDeviceEngine(env);
  const deviceVoice =
    native === "browser"
      ? `this device has ${voices.length || env.voices} voice${(voices.length || env.voices) === 1 ? "" : "s"}`
      : native === "fully"
        ? "no browser voices — Fully Kiosk's text-to-speech will speak"
        : "no voice on this device — text only (in Fully Kiosk: enable its JavaScript Interface)";

  const tile = (pick: MapPick, where: string, screen: string) => {
    const chosen = self !== null && self.spot === pick.spot && (pick.spot !== "" || current?.spot === "");
    const badge = onlineBadge(pick.spot, heart.beats, heart.silentMs, self);
    return (
      <button key={pick.spot || "unplaced"} type="button" className={`pick${chosen ? " chosen" : ""}`} disabled={busy} onClick={() => void choose(pick)}>
        <span className="pick-name">
          {pick.name}
          {chosen && <span className="pick-here"> ✓ this tablet</span>}
        </span>
        <span className="pick-where">{where}</span>
        <span className="pick-screen">{screen}</span>
        {badge !== null && <span className="pick-badge">{badge}</span>}
      </button>
    );
  };

  return (
    <div className="terminal setup-screen">
      <div className="setup">
        <h1>TERMINAL SETUP</h1>
        {error && <div className="error">{error}</div>}
        {showConnect ? (
          <form
            className="step"
            onSubmit={(e) => {
              e.preventDefault();
              void doConnect();
            }}
          >
            <h2>1 · CONNECT</h2>
            <p className="muted">Type the event's moderator passcode (the Run page or the server's boot banner). This tablet keeps the access; the passcode itself is never stored.</p>
            <input className="big" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" autoFocus placeholder="moderator passcode" aria-label="moderator passcode" />
            <div className="actions">
              <button type="submit" className="big-button" disabled={busy}>
                {busy ? "CONNECTING…" : "CONNECT"}
              </button>
              {changing && (
                <button type="button" className="ghost" onClick={() => setChanging(false)}>
                  cancel
                </button>
              )}
            </div>
          </form>
        ) : (
          <div className="step">
            <h2>2 · WHICH TERMINAL IS THIS?</h2>
            <p className="muted">
              {access?.title ? `${access.title} — ` : ""}tap the spot this tablet hangs on. The list is the event's house map (set up in the house map editor).
            </p>
            {mapFailed && <div className="warn small">Couldn't read the event's house map — showing the show's own terminals.</div>}
            {map === null && !mapFailed && <div className="muted">reading the house map…</div>}
            {groups.map((g) => (
              <section key={g.floor} className="pick-floor">
                <h3>{g.label}</h3>
                {g.rooms.map((r) => (
                  <div key={r.room} className="pick-room">
                    {r.choices.map((c) => tile(c.pick, c.where, c.screen))}
                  </div>
                ))}
              </section>
            ))}
            {map !== null && (
              <section className="pick-floor">
                <h3>Not on the map</h3>
                {tile(UNPLACED, "no window into the games", "face only")}
              </section>
            )}
            <div className="links">
              <button type="button" className="ghost" onClick={() => setChanging(true)}>
                change passcode
              </button>
              {current !== null && (
                <button type="button" className="ghost" onClick={onForget}>
                  forget this terminal
                </button>
              )}
            </div>
            <details className="advanced" open={advanced} onToggle={(e) => setAdvanced(e.currentTarget.open)}>
              <summary>advanced — character, camera, voice, announcements, a manual screen</summary>
              <div className="advanced-body">
              <p className="muted small">These apply when you tap a terminal above (tap this tablet's own to save them).</p>
              <label>
                character (an agent-voiced one)
                {cast.length > 0 && cast.includes(character) ? (
                  <select value={character} onChange={(e) => setCharacter(e.target.value)}>
                    {cast.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value={character} onChange={(e) => setCharacter(e.target.value)} placeholder="Trabolta" />
                )}
              </label>
              <div className="row">
                <label>
                  camera
                  <select value={camera} onChange={(e) => setCamera(e.target.value as TerminalConfig["camera"])}>
                    <option value="user">front (facing the room)</option>
                    <option value="environment">back</option>
                  </select>
                </label>
                <label>
                  voice
                  <select value={engine} onChange={(e) => setEngine(e.target.value as VoiceChoice)}>
                    <option value="browser">this device's own (recommended)</option>
                    <option value="fully">Fully Kiosk's (Android TTS)</option>
                    <option value="silent">none — text only</option>
                    <option value="server">the server's (needs LOOM_TTS_URL)</option>
                  </select>
                </label>
              </div>
              <div className="muted small">{deviceVoice}</div>
              {engine === "server" && (
                <label>
                  server voice name <span className="muted">(blank = the server's default)</span>
                  <input value={serverVoice} onChange={(e) => setServerVoice(e.target.value)} placeholder="am_michael" />
                </label>
              )}
              <label>
                pace {speed.toFixed(2)}×
                <input type="range" min={0.6} max={1.5} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
              </label>
              <label>
                device voice
                <select value={browserVoice} onChange={(e) => setBrowserVoice(e.target.value)} disabled={voices.length === 0}>
                  <option value="">{voices[0] ? `best available — ${voices[0].name}` : "the device's default"}</option>
                  {voices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name} ({v.lang}){v.localService ? "" : " · online"}
                    </option>
                  ))}
                </select>
              </label>
              <div className="actions">
                <button type="button" className="ghost" onClick={() => void testVoice()}>
                  TEST VOICE
                </button>
                <button type="button" className="ghost" onClick={() => void unlock().then(() => ringChime())}>
                  CHIME
                </button>
                {tested !== null && <span className="muted small">{tested}</span>}
              </div>
              <label>
                say the house announcements <span className="muted">(house setting = this spot's 📢 on Run → Terminals)</span>
                <select value={announceChoiceValue(announce)} onChange={(e) => setAnnounce(announceFromChoice(e.target.value))}>
                  <option value="house">house setting{spotAnnounce === null ? "" : spotAnnounce ? " (this spot: says them)" : " (this spot: doesn't)"}</option>
                  <option value="always">always</option>
                  <option value="never">never</option>
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={camFeed} onChange={(e) => setCamFeed(e.target.checked)} />
                send this camera to the games <span className="muted">(placed terminals only)</span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={micBox(mic, viewOverride || current?.view || "auto").checked}
                  ref={(el) => {
                    if (el !== null) el.indeterminate = micBox(mic, viewOverride || current?.view || "auto").follows;
                  }}
                  onChange={(e) => setMic(e.target.checked)}
                />
                let the games hear this room{" "}
                <span className="muted">
                  {mic === undefined ? "(follows the screen you pick: on, off on the TV — tick or untick to choose; " : "("}the microphone; placed terminals only, never the tent)
                </span>
              </label>
              <label className="check">
                <input type="checkbox" checked={voicesOn} onChange={(e) => setVoicesOn(e.target.checked)} />
                play the players near this screen <span className="muted">(their headset voices)</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={fullscreen} onChange={(e) => setFullscreen(e.target.checked)} />
                full screen <span className="muted">(asked again on every tap; off for a laptop that needs Esc)</span>
              </label>
              {current !== null && feedWanted(current) && <div className={`small ${feed.kind === "stopped" ? "warn" : "muted"}`}>{feedStatusText(feed)}</div>}
              {current !== null && (voiceRoles(current).mic || voiceRoles(current).voices) && <div className={`small ${voice.link === "stopped" || voice.mic === "denied" || voice.mic === "insecure" ? "warn" : "muted"}`}>{voice.link === "off" ? "voice link: starts once this terminal is set up" : `before ⚙ opened — ${voiceStatusText(voice)}`}</div>}
              <label>
                screen <span className="muted">(blank = the map's)</span>
                <select value={viewOverride} onChange={(e) => {
                    setViewOverride(e.target.value as TerminalView | "");
                    setManualTouched(true);
                  }}>
                  <option value="">the map's</option>
                  {VIEWS.map((v) => (
                    <option key={v} value={v}>
                      {VIEW_INFO[v]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                room <span className="muted">(blank = the map's; a room terminal sleeps until the story opens it — the TV speaks for it, default {DEFAULT_TV_ROOM})</span>
                <select value={roomOverride} onChange={(e) => {
                    setRoomOverride(e.target.value);
                    setManualTouched(true);
                  }}>
                  <option value="">the map's</option>
                  {rooms.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                  {roomOverride !== "" && !rooms.some((r) => r.value === roomOverride) && <option value={roomOverride}>{roomOverride} (not on the map)</option>}
                </select>
              </label>
              {!hasWebGL2() && <div className="muted small">this tablet has no WebGL2 — it draws the reinstallation as a simple old-school 3D view from its spot instead of the full 3D simulation</div>}
              </div>
            </details>
          </div>
        )}
        <p className="muted small">
          A fleet: open <code>/terminal/?code=&lt;mod passcode&gt;&amp;spot=&lt;terminal id&gt;</code> on each tablet — it connects and picks that terminal with no taps. The camera needs https:// (or localhost); without it, programs type their name instead.
        </p>
      </div>
    </div>
  );
}

