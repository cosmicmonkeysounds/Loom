//! "Already playing? Get back in" (wave 23) — on the join screen, for a
//! guest whose session this browser lost: scan or type their badge, or ask
//! a host to let them be their program again. Every path ends in the same
//! Person (`session.adopt`), never a second program. A badge another phone
//! holds is refused (`held.tsx`, wave 59). The calls and copy are
//! `rejoin-calls.ts`'s. A lazy part (`register.tsx`): never in the first load.

import { useEffect, useRef, useState } from "react";
import { guestCameraProblem } from "../guest-scan-sheet.tsx";
import type { CameraState } from "../scan.ts";
import { CameraScanner } from "../scanner.tsx";
import { usePlayHost } from "../host.ts";
import { HeldPanel } from "../held.tsx";
import { rememberClaim } from "../claim.ts";
import { badgeFromText, heldOf, rememberBadge, type HeldCard } from "../rejoin.ts";
import { resolveCode } from "../session/shared.ts";
import { ASK_POLL_MS, askHost, askLine, cancelAsk, enterBy, filterNames, joinedNames, payOwed, pollAsk, type Ask, type AskState } from "../rejoin-calls.ts";
import type { AdoptedGuest } from "../resume.ts";

/** The panel's step. */
type Step = { kind: "menu" } | { kind: "scan" } | { kind: "names"; eventId: string; title?: string; names: string[] } | { kind: "waiting"; ask: Ask; state: AskState } | { kind: "held"; card: HeldCard };

/** This panel only reads guest badges, so a refused one never comes back a booth. */
const noBooth = () => {};

export const BADGE_BLANK = "That badge isn't linked to anyone yet — pick your program below and it links to you.";
export const NEED_CODE = "Type the event code above first (it's on the signs around the house).";

export function GetBackIn({ code, open, onOpen, onIn, onBlankBadge }: { code: string; open: boolean; onOpen: (open: boolean) => void; onIn: (guest: AdoptedGuest) => void; onBlankBadge: () => void }) {
  const host = usePlayHost();
  const setOpen = onOpen;
  const [step, setStep] = useState<Step>({ kind: "menu" });
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [cam, setCam] = useState<CameraState>("off");
  const reading = useRef(false);
  const eventCode = code.trim();

  const tryBadge = async (raw: string) => {
    const badge = badgeFromText(raw);
    // Wave 59: a printed code knows its event and its program, so a typed one
    // needs no event code: it opens its QR's link.
    if (host.ownsPage && !/^[a-z][a-z0-9+.-]*:/iu.test(raw.trim())) {
      setBusy(true);
      const printed = (await resolveCode(raw.trim()))?.printed;
      setBusy(false);
      if (printed !== undefined) return window.location.replace(printed);
    }
    if (badge === null) {
      setNote("That isn't a badge code — it's the 8 letters and numbers under the badge's QR.");
      return;
    }
    if (eventCode === "") return setNote(NEED_CODE);
    setBusy(true);
    setNote("🪪 Checking your badge…");
    try {
      await payOwed(host.storage);
      const r = await enterBy(eventCode, { badge });
      if (r.kind === "in") return onIn(r.guest);
      rememberBadge(host.storage, eventCode, badge);
      rememberClaim(host.storage, eventCode, r.claim);
      onBlankBadge();
      setStep({ kind: "menu" });
      setOpen(false);
      setNote("");
    } catch (e) {
      const shown = heldOf(e);
      if (shown !== null) {
        setNote("");
        setStep({ kind: "held", card: { code: eventCode, by: { badge }, ...shown } });
      } else setNote(e instanceof Error ? e.message : "That badge didn't work.");
    } finally {
      setBusy(false);
      reading.current = false;
    }
  };

  const openNames = async () => {
    if (eventCode === "") return setNote(NEED_CODE);
    setBusy(true);
    setNote("");
    try {
      const r = await joinedNames(eventCode);
      setStep({ kind: "names", eventId: r.eventId, ...(r.title !== undefined ? { title: r.title } : {}), names: r.names });
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't get the list — try again.");
    } finally {
      setBusy(false);
    }
  };

  const ask = async (name: string, ev: { eventId: string; title?: string }) => {
    setBusy(true);
    setNote("");
    try {
      const a = await askHost(eventCode, name, ev);
      setStep({ kind: "waiting", ask: a, state: { kind: "pending" } });
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't ask — try again.");
    } finally {
      setBusy(false);
    }
  };

  // While asking: poll until a host answers (or the ask runs out).
  const waitingAsk = step.kind === "waiting" && step.state.kind === "pending" ? step.ask : null;
  useEffect(() => {
    if (waitingAsk === null) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const state = await pollAsk(waitingAsk);
      // Before `live`: that poll moved the Person here (`held.tsx`).
      if (state.kind === "approved") return onIn(state.guest);
      if (!live) return;
      if (state.kind !== "pending") return setStep({ kind: "waiting", ask: waitingAsk, state });
      timer = setTimeout(() => void tick(), ASK_POLL_MS);
    };
    timer = setTimeout(() => void tick(), ASK_POLL_MS);
    return () => {
      live = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, [waitingAsk, onIn]);

  if (!open) {
    return (
      <div className="rejoin">
        <button type="button" className="choice ghost rejoin-open" onClick={() => setOpen(true)}>
          🔁 Already playing? Get back in
        </button>
      </div>
    );
  }

  const back = () => {
    setStep({ kind: "menu" });
    setNote("");
  };
  if (step.kind === "held") return <HeldPanel card={step.card} onGuest={onIn} onBooth={noBooth} onBack={back} />;
  const problem = guestCameraProblem(cam);
  return (
    <div className="rejoin rejoin-panel cast-pick" role="group" aria-label="Get back in">
      <div className="sheet-h">Get back in as your program</div>
      {step.kind === "menu" && (
        <>
          <p className="pick-hint">Lost the page, or opened the party in another browser? You're still you — here's how to get back in.</p>
          <button type="button" className="choice primary" disabled={busy} onClick={() => setStep({ kind: "scan" })}>
            🪪 Scan my badge
          </button>
          <form
            className="rejoin-typed"
            onSubmit={(e) => {
              e.preventDefault();
              void tryBadge(typed);
            }}
          >
            <input placeholder="…or type the code under its QR" value={typed} autoCapitalize="characters" autoCorrect="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
            <button type="submit" className="choice ghost" disabled={busy || typed.trim() === ""}>
              Go
            </button>
          </form>
          <button type="button" className="choice ghost" disabled={busy} onClick={() => void openNames()}>
            🙋 No badge? Ask a host
          </button>
          <p className="pick-hint">Got an invitation? Scan it again with your phone's camera.</p>
          <button type="button" className="link" onClick={() => setOpen(false)}>
            I'm new tonight
          </button>
        </>
      )}
      {step.kind === "scan" && (
        <>
          <div className="rejoin-cam">
            <CameraScanner
              onState={setCam}
              onCode={(text) => {
                if (reading.current || badgeFromText(text) === null) return;
                reading.current = true;
                void tryBadge(text);
              }}
            />
          </div>
          {problem !== null ? <p className="err">{problem}</p> : <p className="pick-hint">{cam === "live" ? "Point the camera at the QR on your badge." : "Starting the camera…"}</p>}
          <button type="button" className="link" onClick={back}>
            ‹ Back
          </button>
        </>
      )}
      {step.kind === "names" && (
        <>
          <p className="pick-hint">Tap the program you are. A host will check it's you.</p>
          <input placeholder="Search programs" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="rejoin-names" role="list">
            {filterNames(step.names, q).map((n) => (
              <button key={n} type="button" role="listitem" className="choice ghost rejoin-name" disabled={busy} onClick={() => void ask(n, step)}>
                {n}
              </button>
            ))}
            {step.names.length === 0 && <p className="pick-hint">Nobody has joined yet — join as new below.</p>}
          </div>
          <button type="button" className="link" onClick={back}>
            ‹ Back
          </button>
        </>
      )}
      {step.kind === "waiting" && (
        <>
          <p className="sub" role="status">
            {askLine(step.state, step.ask.name)}
          </p>
          {step.state.kind === "pending" ? (
            <button
              type="button"
              className="link"
              onClick={() => {
                cancelAsk(step.ask);
                back();
              }}
            >
              Cancel
            </button>
          ) : (
            <button type="button" className="choice ghost" onClick={() => void ask(step.ask.name, step.ask)}>
              Ask again
            </button>
          )}
        </>
      )}
      {note !== "" && (
        <p className="pick-hint" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
