//! The booth's scanner (wave 13): the taskbar's 📷 Scan opens it with the
//! camera already on and a typed-id box under it. A pass the camera reads
//! (or an id typed) is scanned at once and that guest's card opens in its
//! place — the story's reply on it, the buttons that matter now on its
//! face. Wave 37 (C1): × means done. The window's ×, Escape or the phone's
//! Back over a card, a confrontation or CAPTURED leaves the scanner (back
//! where it was opened), and so does the confrontation's *Not now*. Only a
//! door worker (`queue`) gets "📷 Next guest", which brings the live camera
//! back, so a door queue goes pass after pass. The camera stays mounted
//! (and running) under the card, so the next guest never waits for it to
//! restart; passes it reads while a card is up are dropped, and the pass
//! that was just closed is ignored for a moment (`closedGate`, kept by the
//! booth across scanner openings), so closing a card never re-opens it.
//! While it is open the pop-outs are quiet (`PopOutQuiet`, C4). Wave 58: a
//! codex QR (or its code, typed) lands in the character's own Codex with a
//! line under the camera, which stays on for the next one; a held QR counts
//! once (`lastCode`), so it never eats the wrong-code limit. Everything in
//! here that says so is `DRAFT w58`. Wave 59: a typed code asks the server what
//! it is first (`session.printed`): a printed badge, room or sign comes back as
//! its QR's link and reads like that QR under the camera.

import { showClockOf } from "../show-clock.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PrimeSession } from "../session/prime.ts";
import { BADGE_NOT_LINKED, cameraProblem, parseScan, scanProblem, typedTarget, type CameraState } from "../scan.ts";
import { CameraScanner } from "../scanner.tsx";
import { CardTitle, GuestCardBody, type CardSeed } from "./card.tsx";
import { BoothLayer } from "./layer.tsx";
import { BOOTH_TYPED_NOTHING, cameraOn, closedGate, passAccepted, redeemHeld, redeemNote, scanError, scanTitle } from "./model.ts";
import { Icon } from "../chrome/icons.tsx";
import { ConfrontScreen } from "./confront.tsx";
import { unmarkIdOf } from "./card.tsx";
import { confrontFor, type Confront } from "./popouts/model.ts";
import { PopOutQuiet } from "./popouts/rung.ts";
import { looseWanted, wantedOf } from "./wire.ts";

/** How long a just-closed card's pass is ignored by the camera. */
export const CLOSED_PASS_MS = 4000;

/** The typed-id fallback (no camera, plain http, a pass that won't read).
 *  `onScan` answers whether the scan went through: the typed id is cleared
 *  only then, so a scan turned down (a paused show) keeps it for the retry. */
export function Scanner({ onScan, busy = false }: { onScan: (id: string) => Promise<boolean> | void; busy?: boolean }) {
  const [manual, setManual] = useState("");
  const typed = () => {
    const target = typedTarget(manual);
    if (!target) return;
    const sent = onScan(target);
    if (sent === undefined) setManual("");
    else
      void sent.then((ok) => {
        if (ok) setManual((now) => (typedTarget(now) === target ? "" : now));
      });
  };
  return (
    <form
      className="booth-typed"
      onSubmit={(e) => {
        e.preventDefault();
        typed();
      }}
    >
      <label className="booth-typed-label" htmlFor="booth-typed-id">
        Or type a pass id or a codex code
      </label>
      <div className="booth-typed-row">
        <input
          id="booth-typed-id"
          className="w95-inset"
          placeholder="g-1a2b3c"
          value={manual}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          onChange={(e) => setManual(e.target.value)}
        />
        <button type="submit" className="w95-btn" disabled={busy || manual.trim() === ""}>
          Scan
        </button>
      </div>
    </form>
  );
}

/** The live camera's hint. Only door work (`queue`) has a next guest
 *  waiting (C3); anyone else's × leaves after each card. */
export function scanHint(queue: boolean): string {
  return queue ? "Hold a pass or a codex QR up to the camera. It stays on for the next guest." : "Hold a pass or a codex QR up to the camera.";
}

/** The booth's just-closed-pass gate (`closedGate`); `PerformerApp` keeps
 *  one for the whole sign-in, so leaving and reopening the scanner with the
 *  same pass still held up never re-fires its scan. */
export type PassGate = ReturnType<typeof closedGate>;

/**
 * The scanner window. `open` cards come from a scan; `onOpenThread` opens a
 * guest's thread (and closes the scanner).
 */
export function ScannerScreen({
  session,
  admin,
  onClose,
  onOpenThread,
  gate: sharedGate,
  onCardGuest,
  caption,
  onBoard,
  queue = false,
  onPress,
  onOpenCodex,
}: {
  session: PrimeSession;
  admin: boolean;
  onClose: () => void;
  onOpenThread: (guestId: string) => void;
  gate?: PassGate;
  /** The guest a scan is for (its target at once, the card's guest on the reply): the moments layer drops readouts about them while the card shows them. */
  onCardGuest?: (guestId: string) => void;
  /** Wave 18: opened from a claim — "📷 Scan Minesweeper's pass". */
  caption?: string;
  /** Open the Wanted board (the CAPTURED screen's Board button). */
  onBoard?: () => void;
  /** Wave 37 (C3): door work (an Antivirus, or opened from the Door queue):
   *  the card and CAPTURED offer 📷 Next guest. Without it they don't (the
   *  taskbar's Scan is one tap after ×). */
  queue?: boolean;
  /** Wave 37 (C14): a face button on the scanned card is about to be pressed. */
  onPress?: (id: string) => void;
  /** Wave 58: leave the scanner for the character's Codex. */
  onOpenCodex?: () => void;
}) {
  const [cam, setCam] = useState<CameraState>("off");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<{ id: string; seed: CardSeed; confront?: Confront; said?: string[] } | null>(null);
  // Wave 58: an entry just landed, so 📓 Open my Codex shows.
  const [landed, setLanded] = useState(false);
  // The code last answered: the camera reports a held QR again every few
  // seconds, and a held wrong code would burn the limiter.
  const lastCode = useRef<string | null>(null);
  const ownGate = useMemo(() => closedGate(CLOSED_PASS_MS), []);
  const gate = sharedGate ?? ownGate;
  const problem = cameraProblem(cam);
  const live = cameraOn(true, card !== null);
  const scanBox = useRef<HTMLDivElement>(null);
  // Any way out over a card gates its pass (C1): the window's ×, the
  // phone's Back (the booth closes the layer, so this unmounts), the
  // taskbar, a thread or the board. `closed` is idempotent.
  const cardRef = useRef(card);
  cardRef.current = card;
  useEffect(
    () => () => {
      if (cardRef.current !== null) gate.closed(cardRef.current.id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // While a card is up the camera section is inert (no Tab stop, no tap).
  useEffect(() => {
    const el = scanBox.current;
    if (el === null) return;
    if (card !== null) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }, [card]);

  const doRedeem = (code: string, missed?: string): Promise<boolean> => {
    setErr("");
    setLanded(false);
    setNote("🔓 Unlocking…");
    setBusy(true);
    return session.redeem(code).then(
      (r) => {
        setBusy(false);
        lastCode.current = code;
        setNote(redeemNote(r, missed));
        setLanded(redeemHeld(r));
        return redeemHeld(r);
      },
      (e) => {
        setBusy(false);
        setNote("");
        setErr(scanError(e, session.view));
        return false;
      },
    );
  };
  // `typed`: not known to be a pass, so `unknown guest` means try it as a code.
  const doScan = (id: string, badge = false, typed = false): Promise<boolean> => {
    if (!id || busy) return Promise.resolve(false);
    setErr("");
    setLanded(false);
    setNote(badge ? "Scanning the badge…" : `Scanning ${id}…`);
    setBusy(true);
    if (!badge) onCardGuest?.(id);
    return session.scan(id).then(
      (r) => {
        setBusy(false);
        setNote("");
        onCardGuest?.(r.guest.id);
        // Wave 18 (§4.3): an in-person scan of a wanted program is the confrontation.
        const confront = confrontFor(r, wantedOf(session.view), session.view?.interactions ?? [], "scanner");
        setCard({
          id: r.guest.id,
          seed: { card: r.card, replies: r.responses, ...(r.said !== undefined ? { said: r.said } : {}), ...(r.staff !== undefined ? { staff: r.staff } : {}), ...(r.refused !== undefined ? { refused: r.refused } : {}) },
          ...(confront !== null ? { confront, said: (r.said ?? []).map((l) => l.text) } : {}),
        });
        return true;
      },
      (e) => {
        const nobody = /unknown guest/iu.test(e instanceof Error ? e.message : "");
        if (typed && nobody) return doRedeem(id, BOOTH_TYPED_NOTHING);
        setBusy(false);
        setNote("");
        // Wave 23: a blank badge resolves to nobody yet.
        setErr(badge && nobody ? BADGE_NOT_LINKED : scanError(e, session.view));
        return false;
      },
    );
  };
  // The typed box: an id goes to `/api/scan` alone, a whole link reads as it
  // would scanned. Anything else may be printed on something, which the
  // server knows; else it may be a pass or a codex code, and a real code can
  // have a badge's shape, so it tries the pass first and falls through.
  const doTyped = async (text: string): Promise<boolean> => {
    const hit = parseScan(text);
    if (hit.kind === "wall" && hit.unlock !== null) return busy ? false : doRedeem(hit.unlock, BOOTH_TYPED_NOTHING);
    if (hit.kind === "guest") return doScan(text);
    if (busy) return false;
    let link: string | null;
    try {
      link = await session.printed(text);
    } catch (e) {
      setErr(scanError(e, session.view));
      return false;
    }
    if (link === null) return doScan(text, false, true);
    const read = parseScan(link);
    if (read.kind === "guest") return doScan(read.id, read.badge === true);
    if (read.kind === "wall" && read.unlock !== null) return doRedeem(read.unlock, BOOTH_TYPED_NOTHING);
    setErr("");
    setNote(scanProblem(read) ?? "");
    return true;
  };
  const onCode = (raw: string) => {
    if (card !== null) return; // the camera runs on under the card; its reads wait
    const hit = parseScan(raw);
    if (hit.kind === "wall" && hit.unlock !== null) {
      if (!busy && hit.unlock !== lastCode.current) void doRedeem(hit.unlock);
      return;
    }
    if (hit.kind !== "guest") {
      setNote(scanProblem(hit) ?? "");
      return;
    }
    if (!passAccepted(card !== null, busy, gate.allows(hit.id))) return;
    void doScan(hit.id, hit.badge === true);
  };
  const next = () => {
    if (card !== null) gate.closed(card.id);
    setCard(null);
    // A browser may have paused the hidden preview; wake it for the next pass.
    void scanBox.current?.querySelector("video")?.play()?.catch(() => {});
  };
  // × means done (C1): over a card the pass is gated (still held to the
  // lens), then the scanner leaves; on the camera it just leaves. (The
  // unmount gates it too; doing it here first keeps the order plain.)
  const leave = () => {
    if (card !== null) gate.closed(card.id);
    onClose();
  };

  const name = card === null ? "" : (card.seed.card?.guest.name ?? session.view?.guests.find((g) => g.id === card.id)?.name ?? card.id);
  return (
    <BoothLayer
      title={card !== null ? <CardTitle name={name} /> : <span className="booth-layer-title"><Icon name="scan" /> {scanTitle(caption)}</span>}
      label={card !== null ? `${name}'s card` : "Scanner"}
      onClose={leave}
      tone={card?.confront !== undefined ? "alarm" : undefined}
      dock={false}
    >
      {/* Wave 37 (C4): face to face, nothing floats: what arrives waits until × (camera included). */}
      <PopOutQuiet />
      <div className={`booth-scan ${card !== null ? "behind" : ""}`} ref={scanBox} aria-hidden={card !== null || undefined}>
        <div className={`booth-cam ${cam}`}>
          {live && !problem && <CameraScanner onCode={onCode} onState={setCam} />}
          {problem !== null ? (
            <p className="booth-cam-msg">{problem}</p>
          ) : cam !== "live" ? (
            <p className="booth-cam-msg">Starting the camera…</p>
          ) : null}
        </div>
        <p className="booth-scan-hint" role="status" aria-live="polite">
          {note !== "" ? note : cam === "live" ? scanHint(queue) : " "}
        </p>
        {landed && onOpenCodex !== undefined && (
          <div className="booth-utils">
            <button type="button" className="w95-btn booth-util" onClick={onOpenCodex}>
              📓 Open my Codex
            </button>
          </div>
        )}
        {err && (
          <div className="booth-err" role="alert">
            {err}
          </div>
        )}
        <Scanner onScan={doTyped} busy={busy} />
      </div>
      {card !== null && card.confront !== undefined && (
        <div className="booth-card">
          <div className="booth-card-scroll">
            <ConfrontScreen
              key={card.id}
              c={card.confront}
              me={session.auth?.character ?? ""}
              said={card.said}
              unmarkId={card.seed.card !== undefined ? unmarkIdOf(card.seed.card.live, session.view?.interactions ?? []) : null}
              board={looseWanted(session.view).filter((w) => w.id !== card.id).length}
              caughtBy={(wantedOf(session.view) ?? []).find((w) => w.id === card.id && w.captured)?.claimedBy ?? null}
              showClock={showClockOf(session.view)}
              press={(id) => session.act(id, card.id)}
              onNotNow={leave}
              onNext={queue ? next : undefined}
              onBoard={onBoard}
            />
          </div>
        </div>
      )}
      {card !== null && card.confront === undefined && (
        <GuestCardBody
          key={card.id}
          session={session}
          guestId={card.id}
          seed={card.seed}
          admin={admin}
          onOpenThread={() => {
            gate.closed(card.id);
            onOpenThread(card.id);
          }}
          onNext={queue ? next : undefined}
          onLeave={leave}
          onPress={onPress}
          onBoard={onBoard}
        />
      )}
    </BoothLayer>
  );
}
