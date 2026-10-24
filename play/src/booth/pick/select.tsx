//! PLAYER SELECT (wave 18, BOOTH-SPEC §4.7): an objective whose buttons are
//! steps (Celebrate The Winners: 🎱 → 🎀 → 🎯) as one window — move chips
//! along the top, the step's to-do line, the programs at hand as tiles, and
//! the press in the foot. A harmless follow-on pre-selects the last step's
//! program (*SAME: ICQ*); a destructive step never does, greys the earlier
//! pick and arms (two taps). Each press is one `/api/prime/act`; the reply
//! line says what reached the program's phone. No scans.

import { useState } from "react";
import { ARM_LINE, useArmButtons } from "../../arm.ts";
import { PersonAvatar } from "../../ui/primitives.tsx";
import type { PrimeActResult, PrimeGuest } from "../../types.ts";
import { BoothLayer } from "../layer.tsx";
import { replyLine, stepWord, withoutGlyph, type WizardStep } from "../popouts/model.ts";
import type { BoothObjective } from "../wire.ts";
import { GuestTiles } from "./tiles.tsx";

export interface PlayerSelectProps {
  objective: BoothObjective;
  steps: readonly WizardStep[];
  guests: readonly PrimeGuest[];
  press: (id: string, guest: string) => Promise<PrimeActResult>;
  onClose: () => void;
  onLater?: () => void;
  /** Wave 21: a player booth — no staff-room lines, a refusal reads "Not now.". */
  player?: boolean;
}

/** The SAME row's button: the step's glyph and its first word ("🎀 Give"). */
export function sameLabel(s: Pick<WizardStep, "glyph" | "label">): string {
  const word = withoutGlyph(s.label).split(/\s+/u)[0] ?? "";
  return `${s.glyph} ${word}`.trim();
}

/** The step's helper line. */
export function stepHelper(s: WizardStep, index: number): string {
  if (s.destructive) return "Tap the program, then tap again.";
  if (index === 0 || !s.preselect) return "Tap the program.";
  return "…or tap someone else below";
}

export function PlayerSelect({ objective, steps, guests, press, onClose, onLater, player = false }: PlayerSelectProps) {
  const arm = useArmButtons();
  const [at, setAt] = useState(0);
  const [done, setDone] = useState<Array<string | null>>(() => steps.map(() => null));
  const [chosen, setChosen] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState<string[]>([]);
  const finished = at >= steps.length;
  const byId = new Map(guests.map((g) => [g.id, g]));
  const atHand = (objective.pick ?? []).map((id) => byId.get(id)).filter((g): g is PrimeGuest => g !== undefined);
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const step = steps[at];
  const prev = at > 0 ? done[at - 1] ?? null : null;
  const same = step !== undefined && step.preselect && prev !== null ? prev : null;
  const greyed = new Map<string, string>();
  if (step?.destructive === true) for (let i = 0; i < at; i++) if (done[i] != null) greyed.set(done[i]!, stepWord(steps[0]));
  const go = (n: number) => {
    setAt(n);
    setChosen(null);
  };
  const fire = (guest: string) => {
    if (step === undefined || busy) return;
    arm.tap(`${step.id}:${guest}`, step.destructive, () => {
      setBusy(true);
      press(step.id, guest).then(
        (r) => {
          setBusy(false);
          setReply(replyLine(nameOf(guest), r, { player }));
          if (r.refused === true) return;
          if (!player) setStaff((r.staff ?? []).filter((t) => t.trim() !== ""));
          setDone((d) => d.map((x, i) => (i === at ? guest : x)));
          go(at + 1);
        },
        (e: unknown) => {
          setBusy(false);
          setReply(`Not done: ${e instanceof Error ? e.message : String(e)}`);
        },
      );
    });
  };
  const target = chosen ?? null;
  const armed = step !== undefined && target !== null && arm.armed === `${step.id}:${target}`;
  const foot = finished ? (
    <div className="bsel-foot">
      <button type="button" className="w95-btn booth-default bsel-go" onClick={() => {
        setDone(steps.map(() => null));
        setReply("");
        setStaff([]);
        go(0);
      }}>
        + Another round
      </button>
      <button type="button" className="w95-btn" onClick={onClose}>
        Close
      </button>
    </div>
  ) : (
    <div className="bsel-foot">
      {reply.startsWith("Not done") && <p className="bsel-reply refused">{reply}</p>}
      {step !== undefined && target !== null && step.destructive && <p className="booth-harm-head">⚠ Marks {nameOf(target)} for reinstallation: tap twice</p>}
      {step !== undefined && target !== null && (
        <button type="button" className={`w95-btn bsel-go ${step.destructive ? "harm" : "booth-default"} ${armed ? "armed" : ""}`} disabled={busy} aria-busy={busy || undefined} onClick={() => fire(target)}>
          {busy ? `${step.label} …` : armed ? ARM_LINE : `${step.label}: ${nameOf(target)}`}
        </button>
      )}
      <div className="bsel-foot-row">
        <button type="button" className="w95-btn" disabled={busy} onClick={() => go(at + 1)}>
          Skip
        </button>
        {onLater !== undefined && (
          <button type="button" className="w95-btn" onClick={onLater}>
            Later
          </button>
        )}
      </div>
    </div>
  );
  return (
    <BoothLayer
      title={
        <span className="booth-layer-title">
          <span aria-hidden>🎮</span> PLAYER SELECT · {objective.title}
        </span>
      }
      label={`Player select: ${objective.title}`}
      onClose={onClose}
      foot={foot}
    >
      <div className="bsel">
        <div className="bsel-moves" role="tablist" aria-label="Moves">
          <span className="bsel-moves-k" aria-hidden>
            MOVE
          </span>
          {steps.map((s, i) => (
            <button key={s.id} type="button" role="tab" aria-selected={i === at} className={`w95-btn bsel-move ${i === at ? "current" : ""} ${done[i] != null ? "done" : ""}`} onClick={() => go(i)}>
              {["①", "②", "③", "④", "⑤", "⑥"][i] ?? i + 1} {s.glyph}
              {done[i] != null ? " ✓" : ""}
            </button>
          ))}
        </div>
        {reply !== "" && !reply.startsWith("Not done") && (
          <p className="bsel-reply" role="status">
            {reply}
          </p>
        )}
        {finished ? (
          <div className="bsel-done w95-inset">
            <p>(i) Done.</p>
            {[...new Set(done.filter((x): x is string => x !== null))].map((id) => (
              <p key={id}>
                ✓ {nameOf(id)}: {steps.filter((_, i) => done[i] === id).map((s) => s.glyph).join(" · ")}
              </p>
            ))}
            {staff.map((t, n) => (
              <p key={n} className="booth-staff">
                {t}
              </p>
            ))}
          </div>
        ) : step !== undefined ? (
          <>
            <p className="bsel-prompt">{step.prompt}</p>
            <p className="bsel-helper">{stepHelper(step, at)}</p>
            {same !== null && (
              <div className="bsel-same">
                <PersonAvatar name={nameOf(same)} size="md" />
                <span className="bsel-same-name">SAME: {nameOf(same).toUpperCase()}</span>
                <button type="button" className="w95-btn booth-default bsel-same-go" disabled={busy} onClick={() => fire(same)}>
                  {sameLabel(step)}
                </button>
              </div>
            )}
            <GuestTiles list={atHand} everyone={guests} chosen={chosen} greyed={greyed} disabled={busy} onPick={setChosen} />
          </>
        ) : null}
      </div>
    </BoothLayer>
  );
}
