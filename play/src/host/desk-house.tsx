//! The Desk's 🖥 House (wave 59): what a host may do to the house's machines,
//! which until now only Run had in one place. Part of the Desk's lazy chunk.
//!
//! - 🌀 His voice (Auto, Clean, Broken, a flavour), 🔇 the TV's voice, 🌀 Clippy's
//!   dream, ⚡ a talk scene's glitch, ■ and the announcement.
//! - 📷 Terminal photos (`photos.tsx`), mounted here and nowhere else: it polls
//!   every 5 s while mounted, and the panel is keyed by tab.
//! - 📢 Audio ads: On / Off, the same switch as Run → Terminals, and what the next
//!   one waits on.
//! - Try it (`desk.tsx`), which plays on the house.
//! - 📟 Every terminal's state and build stamp, with Identify.
//!
//! It reads the console's host view and writes only what the host allowlist
//! opens. What the server keeps a director's stays on Run, and the line
//! at the foot says so: 🎭 the costume's switch and the descent. Nothing here
//! starts, restarts, reloads or ends a show, and nothing ever should. New words
//! here are `DRAFT w59d`.

import { useEffect, useState, type ReactNode } from "react";
import type { ApiError } from "../client.ts";
import { adsLine, type AdsStatus } from "../../../core/src/audio-ads.ts";
import { VOICE_FLAVOURS, VOICE_FLAVOUR_LABEL, VOICE_FX_MODES, type VoiceFlavour } from "../../../core/src/voice-fx.ts";
import type { HostView } from "../types.ts";
import type { HostCalls } from "./api.ts";
import type { HostAuth } from "./client.ts";
import { useHostConsole } from "./dock.tsx";
import { liveAsk, stopAllDone } from "./desk-model.ts";
import { ADS_NOTE, ADS_NOT_YET, DREAM_CUE, DREAM_NOT_NOW, VOICE_MODE_WORD, adsDone, dreamDone, dreamRow, identifyDone, terminalLines, terminalsAside, voiceModeLine } from "./desk-tabs.ts";
import { ActButton, ConfirmButton, HostEmpty, HostSection, failText } from "./kit.tsx";
import { optimisticValue, tvVoiceLabel, type Optimistic, type VoiceFxMode } from "./model.ts";
import { PhotosSection } from "./photos.tsx";
import { glitchText } from "./talk-model.ts";

/** One write (`DeskBody`'s `act`): `done` is the line on success, or makes it from the answer. */
export type Act = (done: string | ((answer: unknown) => string), call: () => Promise<unknown>, refusal?: (e: ApiError) => string) => Promise<boolean>;

/** The Run-only line under the switches. `DRAFT w59d`. */
export const RUN_ONLY = "A director's, on Run → Terminals and the House map card: 🎭 the costume's switch, and the descent.";

/** The console's view over the body. Outside a console (the tests) it is empty. */
export function DeskHouse({ auth, calls, act, live, tryIt }: { auth: HostAuth | undefined; calls: HostCalls; act: Act; live: boolean; tryIt: ReactNode }) {
  const c = useHostConsole();
  return <DeskHouseBody view={c?.view ?? null} rows={c?.rows ?? []} auth={auth} calls={calls} act={act} live={live} refresh={() => c?.client.refresh()} tryIt={tryIt} />;
}

export interface DeskHouseBodyProps {
  view: HostView | null;
  rows: readonly { id: string; live: boolean }[];
  /** The booth's token, for what polls for itself (📷). Undefined only outside a booth. */
  auth?: HostAuth | undefined;
  calls: HostCalls;
  act: Act;
  /** The doors are open: what guests would see asks first (`testNeedsConfirm`). */
  live: boolean;
  /** A fresh host view after a write. */
  refresh: () => void;
  tryIt: ReactNode;
}

/** The tab over one view (the tests render it with a fixture). */
export function DeskHouseBody({ view, rows, auth, calls, act, live, refresh, tryIt }: DeskHouseBodyProps) {
  const send: Act = (done, call, refusal) => act(done, call, refusal).finally(refresh);
  const t = view?.terminals ?? null;
  const dream = dreamRow(rows, t?.dream, view === null || view.doorsClosed === true || view.runtime === "idle");
  const glitch = view?.talk?.glitch ?? null;
  return (
    <div className="host-desk-house" data-testid="host-desk-house">
      {view === null && <HostEmpty>Reading the house…</HostEmpty>}
      {t !== null && t.voiceFx !== undefined && <VoiceBox fx={t.voiceFx} calls={calls} send={send} />}
      <div className="host-desk-pair">
        {t !== null && <TvVoice muted={t.voiceMuted} calls={calls} send={send} />}
        <ActButton label="■ Stop + the announcement" title="■ STOP ALL lets an announcement finish. This cuts it and empties its queue." onClick={() => send((a) => stopAllDone(true, a), () => calls.deskStopAll(true))} />
      </div>
      {dream !== null && (
        <HostSection id="desk-dream" title="🌀 Clippy's dream" aside={dream.state}>
          <ConfirmButton className="host-desk-wide" testId="host-desk-dream" label={dream.button} ask={dream.ask} yes="Do it" disabled={!dream.live} onConfirm={() => send((a) => dreamDone(dream.on, a), () => calls.cue(DREAM_CUE, null, null))} />
          {!dream.live && <p className="host-note">{DREAM_NOT_NOW}</p>}
        </HostSection>
      )}
      {glitch !== null && (
        <HostSection id="desk-glitch" title="⚡ The talk scene">
          <ActButton className="host-desk-wide" label="⚡ Glitch" onClick={() => send((a) => glitchText(a as Record<string, unknown>), () => calls.cue(glitch, null, null))} />
        </HostSection>
      )}
      {t?.ads !== undefined && <AdsBox ads={t.ads} calls={calls} send={send} />}
      {auth !== undefined && <PhotosSection auth={auth} calls={calls} />}
      {tryIt}
      {t !== null && <TerminalsBox terminals={t} live={live} calls={calls} send={send} />}
      <p className="host-note" data-testid="host-desk-run-only">
        {RUN_ONLY}
      </p>
    </div>
  );
}

/** A toggle that turns with the note, then trusts the view again. */
function useTurned<T>(server: T): [T, (value: T) => void] {
  const [turned, setTurned] = useState<Optimistic<T> | null>(null);
  useEffect(() => {
    if (turned !== null && server === turned.value) setTurned(null);
  }, [server, turned]);
  return [optimisticValue(server, turned, Date.now()), (value) => setTurned({ value, at: Date.now() })];
}

/** 🌀 His voice: the three modes, and a flavour on his next words. */
function VoiceBox({ fx, calls, send }: { fx: VoiceFxMode; calls: HostCalls; send: Act }) {
  const [mode, turn] = useTurned<VoiceFxMode>(fx);
  const [more, setMore] = useState(false);
  const pick = async (m: VoiceFxMode) => {
    if (m !== mode && (await send(`🌀 His voice: ${VOICE_MODE_WORD[m]}`, () => calls.voiceFx(m)))) turn(m);
  };
  const shot = (f: VoiceFlavour) => send(`🌀 ${VOICE_FLAVOUR_LABEL[f]} on his next words`, () => calls.voiceShot(f));
  return (
    <HostSection id="desk-voice" title="🌀 His voice" aside={VOICE_MODE_WORD[mode]}>
      <div className="host-desk-modes" role="group" aria-label="His voice">
        {VOICE_FX_MODES.map((m) => (
          <ActButton key={m} className="host-desk-mode host-toggle" pressed={m === mode} label={VOICE_MODE_WORD[m]} onClick={() => pick(m)} />
        ))}
      </div>
      <p className="host-note">{voiceModeLine(mode)}</p>
      <button type="button" className="w95-btn host-desk-fold" aria-expanded={more} onClick={() => setMore((o) => !o)}>
        {more ? "▾" : "▸"} Break his next words (8 s)
      </button>
      {more && (
        <div className="host-desk-flavours" data-testid="host-desk-flavours">
          {VOICE_FLAVOURS.map((f) => (
            <ActButton key={f} className="host-desk-flavour" label={VOICE_FLAVOUR_LABEL[f]} onClick={() => shot(f)} />
          ))}
        </div>
      )}
    </HostSection>
  );
}

function TvVoice({ muted, calls, send }: { muted: boolean; calls: HostCalls; send: Act }) {
  const [shown, turn] = useTurned<boolean>(muted);
  return (
    <ActButton
      className="host-toggle"
      pressed={shown}
      label={tvVoiceLabel(shown)}
      onClick={async () => {
        const want = !shown;
        if (await send(want ? "🔇 TV voice muted" : "🔊 TV voice on", () => calls.tvMute(want))) turn(want);
      }}
    />
  );
}

/** 📢 Audio ads: Run's switch on a phone, its state, and what the next one waits on. */
function AdsBox({ ads, calls, send }: { ads: AdsStatus; calls: HostCalls; send: Act }) {
  const [on, turn] = useTurned<boolean>(ads.on);
  const pick = async (want: boolean) => {
    if (want !== on && (await send(adsDone(want), () => calls.adsSwitch(want), (e) => (e.status === 409 ? ADS_NOT_YET : failText(e))))) turn(want);
  };
  return (
    <HostSection id="desk-ads" title="📢 Audio ads" aside={on ? "On" : "Off"}>
      <div className="host-desk-pair" role="group" aria-label="Audio ads">
        <ActButton className="host-desk-mode host-toggle" pressed={on} label="On" onClick={() => pick(true)} />
        <ActButton className="host-desk-mode host-toggle" pressed={!on} label="Off" onClick={() => pick(false)} />
      </div>
      <p className="host-note" data-testid="host-desk-ads-line">
        {adsLine({ ...ads, on })}
      </p>
      <p className="host-note">{ADS_NOTE}</p>
    </HostSection>
  );
}

/** 📟 Every terminal at a glance: silent ones first. Identify covers the terminal's
 *  whole screen, so once the doors are open it asks, like every test on the Desk. */
function TerminalsBox({ terminals, live, calls, send }: { terminals: NonNullable<HostView["terminals"]>; live: boolean; calls: HostCalls; send: Act }) {
  const lines = terminalLines(terminals);
  return (
    <HostSection id="desk-terminals" title="📟 Terminals" aside={terminalsAside(terminals)}>
      {lines.length === 0 ? (
        <HostEmpty>No terminal has polled yet.</HostEmpty>
      ) : (
        <ul className="host-rows" data-testid="host-desk-terminals">
          {lines.map((l) => (
            <li key={l.name} className={`host-subrow ${l.quiet ? "alarm" : ""}`}>
              <span className="host-subrow-name">
                {l.quiet ? "🔴" : "🟢"} {l.name}
                <span className="host-subrow-sub">{l.sub}</span>
                {l.badges.length > 0 && (
                  <span className="host-desk-badges">
                    {l.badges.map((b) => (
                      <span key={b.key} className={`host-desk-badge${b.warn ? " warn" : ""}`}>
                        {b.text}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              {live ? <ConfirmButton label="Identify" ask={liveAsk("look")} yes="Test anyway" onConfirm={() => send(identifyDone(l), () => calls.identify(l.name))} /> : <ActButton label="Identify" onClick={() => send(identifyDone(l), () => calls.identify(l.name))} />}
            </li>
          ))}
        </ul>
      )}
    </HostSection>
  );
}
