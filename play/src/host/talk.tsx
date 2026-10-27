//! The 🤖 Talk card (wave 32, contract C6): in the host Show window between
//! NEXT and the status line, only while a talk scene is on (`HostView.talk`).
//! Task Manager types what Clippy just said out loud and Trabolta answers him
//! live in the Desktop (`POST /api/mod/talk`, `host/api.ts` `talk`). Top to
//! bottom: the scene and its hint, Trabolta's state, the room's last lines,
//! the text box + Send, the canned Clippy lines (one tap sends), the canned
//! Trabolta lines (ARM then FIRE: his own line, at once), ⚡ Glitch (the
//! scene's admin button, through the cue call) and the console's own NEXT
//! (the same desk as the NEXT card: no new fire path), so the scene flows
//! straight into the next activity. Other hosts see it folded with Open.
//! The rules are `talk-model.ts`.

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { cueTitleTags } from "../../../core/src/cue-sheet.ts";
import type { TalkChip, TalkView } from "../../../core/src/talk-back.ts";
import { ARM_LINE, useArmButtons } from "../arm.ts";
import { ApiError } from "../client.ts";
import { ArmDrain, armWindow } from "../director.tsx";
import type { HostConsoleState } from "./dock.tsx";
import { fireLabel } from "./fire-label.ts";
import { failText } from "./kit.tsx";
import { TALK_AGENT, TALK_AS, TALK_MAX, TALK_PLACEHOLDER, canSend, chipFace, chipKey, draftAfterSend, glitchText, talkClock, talkErrorText, talkFoldedLine, talkLines, talkSentText, talkState } from "./talk-model.ts";

export interface TalkCardProps {
  c: HostConsoleState;
  talk: TalkView;
  open: boolean;
  onToggle: () => void;
}

/** The card. `open` is `talkOpen` over Show's folds (a jump opens it). */
export function TalkCard({ c, talk, open, onToggle }: TalkCardProps) {
  return (
    <fieldset className={`host-box host-talk${open ? "" : " folded"}`} data-show="talk" data-testid="host-talk">
      <legend>🤖 TALK</legend>
      <div className="host-talk-head">
        <span className="host-talk-title">{talk.title}</span>
        <button type="button" className="w95-btn host-talk-fold" aria-expanded={open} onClick={onToggle}>
          {open ? "Fold" : "Open"}
        </button>
      </div>
      {open ? <TalkBody c={c} talk={talk} /> : <p className="host-talk-folded">{talkFoldedLine()}</p>}
    </fieldset>
  );
}

/** The open card's body (exported for the tests' hooks harness). */
export function TalkBody({ c, talk }: { c: HostConsoleState; talk: TalkView }) {
  const ctx = c.ctx!;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const arm = useArmButtons();
  // `since` is the server's clock: count on it, not the phone's.
  const state = talkState(talk, talkClock(ctx.now, c.client.skew));
  const lines = talkLines(ctx.session.messages.values());
  const draft = c.talkDraft;

  /** One line out. Once the server took the box's line, only the words it
   *  sent leave the box: the box stays live while it's in flight, so
   *  Clippy's next sentence can be typed on (`draftAfterSend`). */
  const send = async (key: string, as: typeof TALK_AS | typeof TALK_AGENT, text: string, direction?: string) => {
    if (busy !== null) return;
    setBusy(key);
    setError(null);
    try {
      const r = await ctx.calls.talk(as, text, direction);
      if (key === "box") c.setTalkDraft((d) => draftAfterSend(d, text));
      c.desk.setToast(talkSentText(as, r));
    } catch (e) {
      setError(e instanceof ApiError ? talkErrorText(e.message, e.status) : failText(e));
    } finally {
      setBusy(null);
      c.client.refresh();
    }
  };
  const sendBox = () => {
    if (canSend(draft, busy !== null)) void send("box", TALK_AS, draft);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter is a new line; an IME's Enter picks a word.
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    sendBox();
  };
  const glitch = async () => {
    if (talk.glitch === null || busy !== null) return;
    setBusy("glitch");
    try {
      c.desk.setToast(glitchText(await ctx.calls.cue(talk.glitch, null, null)));
    } catch (e) {
      c.desk.setToast(failText(e));
    } finally {
      setBusy(null);
      c.client.refresh();
    }
  };
  const bar = c.bar;
  const next = bar?.kind === "next" ? bar.row : null;
  const armedNext = next !== null && c.desk.armed?.id === next.id;
  const sendingNext = next !== null && c.desk.pending === next.id;

  return (
    <>
      <p className="host-talk-hint">{talk.hint}</p>
      <p className={`host-talk-state ${state.tone}`} data-testid="host-talk-state">
        {state.text}
      </p>
      {lines.length > 0 && (
        <ul className="host-talk-lines" aria-label="The Desktop, last lines">
          {lines.map((l) => (
            <li key={l.seq} className={`host-talk-line${l.his ? " his" : ""}`}>
              <span className="host-talk-from">{l.from}:</span> {l.text}
            </li>
          ))}
        </ul>
      )}
      <div className="host-talk-say">
        <textarea
          className="host-text host-talk-box"
          rows={2}
          maxLength={TALK_MAX}
          enterKeyHint="send"
          placeholder={TALK_PLACEHOLDER}
          aria-label={TALK_PLACEHOLDER}
          value={draft}
          onChange={(e) => {
            c.setTalkDraft(e.target.value);
            if (error !== null) setError(null);
          }}
          onKeyDown={onKey}
          data-testid="host-talk-box"
        />
        <button type="button" className="w95-btn host-talk-send" disabled={!canSend(draft, busy !== null)} aria-busy={busy === "box" || undefined} onClick={sendBox} data-testid="host-talk-send">
          {busy === "box" ? "Sending…" : "Send"}
        </button>
      </div>
      {error !== null && (
        <p className="host-talk-error" role="alert" data-testid="host-talk-error">
          {error}
        </p>
      )}
      {talk.clippy.length > 0 && (
        <ChipRow title={`${TALK_AS} says (tap = send)`} side="clippy">
          {talk.clippy.map((chip, k) => (
            <button key={k} type="button" className="w95-btn host-talk-chip-btn clippy" disabled={busy !== null} aria-busy={busy === chipKey(talk.scene, "clippy", k) || undefined} title={chip.text} onClick={() => void send(chipKey(talk.scene, "clippy", k), TALK_AS, chip.text, chip.direction)}>
              {chipFace(chip)}
            </button>
          ))}
        </ChipRow>
      )}
      {talk.trabolta.length > 0 && (
        <ChipRow title={`${TALK_AGENT} says (tap twice)`} side="trabolta">
          {talk.trabolta.map((chip: TalkChip, k) => {
            // The scene is in the key: an arm never carries over to the next scene's line k.
            const key = chipKey(talk.scene, "trabolta", k);
            const armed = arm.armed === key;
            return (
              <button key={k} type="button" className={`w95-btn host-talk-chip-btn trabolta${armed ? " armed" : ""}`} disabled={busy !== null} aria-busy={busy === key || undefined} title={chip.text} onClick={() => arm.tap(key, true, () => void send(key, TALK_AGENT, chip.text))}>
                {armed ? <span className="host-talk-armed">{ARM_LINE}</span> : chipFace(chip)}
              </button>
            );
          })}
        </ChipRow>
      )}
      <div className="host-talk-foot">
        {talk.glitch !== null && (
          <button type="button" className="w95-btn host-talk-glitch" disabled={busy !== null} aria-busy={busy === "glitch" || undefined} onClick={() => void glitch()} data-testid="host-talk-glitch">
            ⚡ Glitch
          </button>
        )}
        {next !== null && (
          <div className="host-talk-next" data-testid="host-talk-next">
            <span className="host-talk-next-cue">
              <span className="host-box-tag">NEXT</span> {next.code !== null ? `${next.code} ` : ""}
              {cueTitleTags(next.title).title}
            </span>
            <button
              type="button"
              className={`host-fire ${armedNext ? "armed" : ""} ${c.stale ? "stale" : ""}`}
              disabled={c.desk.locked(next)}
              aria-busy={sendingNext || undefined}
              aria-label={armedNext ? `Fire ${next.code ?? next.title}` : `Arm ${next.code ?? next.title}`}
              onClick={() => c.desk.tap(next)}
            >
              {fireLabel(armedNext, sendingNext, next.subject && !armedNext)}
              {armedNext && !sendingNext && <ArmDrain key={c.desk.armed!.at} at={c.desk.armed!.at} ms={armWindow(c.desk.armed!)} className="host-drain-fire" />}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function ChipRow({ title, side, children }: { title: string; side: "clippy" | "trabolta"; children: ReactNode }) {
  return (
    <div className={`host-talk-chips ${side}`} role="group" aria-label={title}>
      <p className="host-talk-chips-h">{title}</p>
      <div className="host-talk-chips-row">{children}</div>
    </div>
  );
}
