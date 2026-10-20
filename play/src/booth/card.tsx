//! A guest's card in the booth (wave 13): opened at once by a scan, or from
//! 🗂 Guests, a readout, a name or a room's who's-here list. It leads with
//! the facts (Not cleared, ⛔, 🔒, 📍, the story's flags), then at most
//! three story buttons — the ones the character's live objectives name and
//! the server says are live for this guest — then the story's reply to the
//! press, and every other button under "All buttons… (n)" with its
//! description. `arm: true` buttons arm on the first tap and fire on the
//! second.

import { useEffect, useMemo, useRef, useState } from "react";
import { PersonAvatar, PickerSheet } from "../ui/primitives.tsx";
import { usePlayHost } from "../host.ts";
import { ARM_LINE, useArmButtons } from "../arm.ts";
import type { PrimeSession } from "../session/prime.ts";
import type { GuestCardView, PrimeGuest } from "../types.ts";
import { BoothLayer } from "./layer.tsx";
import { armsFirst, boothHost, cardButtons, cardGuestFacts, cardReadKey, defaultFaceId, destructive, faceGroups, factChips, faceSettled, foldOpensItself, heldFace, inFlightGate, pressOutcome, scanError, scanRepeated, SCAN_REPEATED, type CardButton, type OutcomeLine } from "./model.ts";
import { Icon } from "../chrome/icons.tsx";
import { BoothIcon } from "./icons.tsx";

// `splitInteractions` lives in `model.ts` now; the barrel re-exports it from here.
export { splitInteractions } from "./model.ts";

/** What a scan (or a press) already said: the server's card, the story's
 *  reply, the character's lines to the guest and the staff-room refusal
 *  (C1). `replies` present = this card opens on a scan's outcome. */
export interface CardSeed {
  card?: GuestCardView;
  replies?: string[];
  said?: Array<{ from: string; text: string }>;
  staff?: string[];
  refused?: boolean;
}

/** The fetch error a performer can act on (the doors, a guest who left). */
function cardError(e: unknown, view?: Parameters<typeof scanError>[1]): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/doors are closed/i.test(msg)) return scanError(e, view).replace(/scan again/u, "the buttons work again");
  if (/unknown guest/i.test(msg)) return "That guest isn't in the event any more.";
  return msg;
}

/**
 * The card's body — used inside the scanner (the camera waits under it) and
 * inside its own window (`GuestCard`). `onNext` = back to the camera.
 */
export function GuestCardBody({
  session,
  guestId,
  seed,
  admin,
  onOpenThread,
  onNext,
}: {
  session: PrimeSession;
  guestId: string;
  seed?: CardSeed;
  admin: boolean;
  onOpenThread: () => void;
  onNext?: () => void;
}) {
  const [card, setCard] = useState<GuestCardView | null>(seed?.card ?? null);
  // What the last press / scan came to (C1): replies, the character's
  // lines, a refusal, or "no reply from the story". A card opened from a
  // scan leads with that scan's.
  const [outcome, setOutcome] = useState<OutcomeLine[] | null>(seed?.replies !== undefined ? pressOutcome(seed, "scan") : null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // "📡 Scan again" — one at a time: every scan is journaled and runs the
  // story's scan hook, so taps while one is on its way are ignored.
  const [scanning, setScanning] = useState(false);
  const scanGate = useMemo(() => inFlightGate(), []);
  // The "All buttons…" fold: null = not touched (it opens by itself when
  // the face is empty, the fold holds a live button and is short).
  const [all, setAll] = useState<boolean | null>(null);
  const [earlier, setEarlier] = useState(false);
  const [sharing, setSharing] = useState(false);
  // The face as it stood at the last press (top to bottom), held still while
  // the outcome lands above it (`heldFace`); a re-scan lets it go.
  const [frozen, setFrozen] = useState<string[] | null>(null);
  const arm = useArmButtons();
  const host = usePlayHost();
  // Escape closes the "Share lore…" picker first (the booth window leaves
  // Escape alone while a sheet is open inside it) — on the host's key
  // target, so it works in a Run → Players pane too.
  useEffect(() => {
    if (!sharing) return;
    const target = host.keyTarget();
    const onKey = (e: Event) => {
      if ((e as KeyboardEvent).key === "Escape") setSharing(false);
    };
    target?.addEventListener("keydown", onKey);
    return () => target?.removeEventListener("keydown", onKey);
  }, [sharing, host]);
  // When the card was last replaced: taps inside `FACE_SETTLE_MS` of it are
  // dropped (the face re-flowed, so the finger now sits on another button).
  const landedAt = useRef<number | null>(null);
  const landed = () => {
    landedAt.current = Date.now();
  };
  const view = session.view;
  const character = session.auth?.character ?? "";
  const objectives = view?.objectives;
  // The guest's live row: another booth sending them to the Internet, a
  // check-in, a flag the story set shows here at once.
  const row = view?.guests.find((g) => g.id === guestId) ?? null;
  // Re-read the card when the night moves (an objective opens or ticks a
  // box) or the guest's row changes (someone else acted on them): a card
  // left open on the counter never offers yesterday's buttons.
  const nightKey = cardReadKey(guestId, objectives, view?.night, row);
  // The key the card on screen was read for; a scan's own card counts.
  const readFor = useRef<string | null>(seed?.card !== undefined ? nightKey : null);
  useEffect(() => {
    const key = nightKey;
    if (readFor.current === key) return;
    readFor.current = key;
    session.card(guestId).then(
      (c) => {
        if (readFor.current !== key) return;
        landed();
        setCard(c);
      },
      (e) => {
        if (readFor.current === key) setErr(cardError(e, session.view));
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestId, nightKey]);

  // C3: the row's flags are the ones on plus failed gates; the card's read has them all.
  const guest: PrimeGuest | null = cardGuestFacts(row, card?.guest ?? null);
  const name = guest?.name ?? guestId;
  const where = guest?.location ? (view?.channels.find((c) => c.id === `loc:${guest.location}`)?.title ?? guest.location) : null;
  const chips = guest !== null ? factChips(guest, where) : [];
  const read = cardButtons(view?.interactions ?? [], objectives, card, character, admin || boothHost(session.auth, view));
  const buttons = heldFace(read.face, read.rest, frozen, view?.interactions ?? []);
  const lore = view?.codex ?? [];
  const restLive = buttons.rest.some((b) => b.live);
  const allOpen = all ?? foldOpensItself(read, card !== null);
  // Every control on the card ignores a tap inside the settle after the
  // card was replaced — Next guest and the utility row too, so a second tap
  // never lands on whatever moved under the finger.
  const settled = () => faceSettled(landedAt.current, Date.now());
  const guard = (f: () => void) => () => {
    if (settled()) f();
  };
  const shown = new Set((outcome ?? []).filter((l) => l.kind === "reply").map((l) => l.text));
  const past = (card?.readouts ?? []).filter((r) => !shown.has(r.text.trim()));

  const press = (b: CardButton) => {
    const i = b.interaction;
    if (busy !== null || !settled()) return;
    arm.tap(i.id, armsFirst(i), () => {
      setFrozen(buttons.face.map((x) => x.interaction.id));
      setBusy(i.id);
      setErr("");
      setOutcome(null);
      session.act(i.id, guestId).then(
        (r) => {
          setBusy(null);
          landed();
          setOutcome(pressOutcome(r, "press"));
          if (r.card !== undefined) setCard(r.card);
        },
        (e) => {
          setBusy(null);
          landed();
          setErr(cardError(e, session.view));
        },
      );
    });
  };
  const rescan = () => {
    // A burst of taps is one scan: none while one is on its way, none in
    // the settle after its reply (the same guard as the face buttons).
    if (!faceSettled(landedAt.current, Date.now())) return;
    const pending = scanGate.run(() => session.scan(guestId));
    if (pending === null) return;
    setScanning(true);
    setErr("");
    setOutcome(null);
    setFrozen(null);
    const settle = () => setScanning(false);
    pending.then(
      (r) => {
        settle();
        landed();
        setOutcome(pressOutcome({ replies: r.responses, said: r.said, staff: r.staff, refused: r.refused }, "scan"));
        if (r.card !== undefined) setCard(r.card);
      },
      (e) => {
        settle();
        landed();
        if (scanRepeated(e)) setOutcome([SCAN_REPEATED]);
        else setErr(cardError(e, session.view));
      },
    );
  };

  // The Win95 default button: the first harmless face button an objective asks for.
  const defaultId = defaultFaceId(buttons.face);
  const btn = (b: CardButton & { gone?: true }, size: "face" | "all") => {
    const i = b.interaction;
    const armed = arm.armed === i.id;
    const harm = destructive(i);
    const sub = armed ? ARM_LINE : b.gone === true ? "Done: not on offer now" : !b.live ? `Not on offer now${i.description ? ` · ${i.description}` : ""}` : i.description;
    return (
      <button
        key={i.id}
        type="button"
        className={`w95-btn booth-btn ${size === "face" ? "booth-face-btn" : "booth-all-btn"}${size === "face" && i.id === defaultId ? " booth-default" : ""}${harm ? " harm" : ""} ${armed ? "armed" : ""} ${b.live ? "" : "off"}`}
        aria-pressed={armed || undefined}
        aria-busy={busy === i.id || undefined}
        disabled={busy !== null || b.gone === true}
        onClick={() => press(b)}
      >
        <span className="booth-btn-label">{busy === i.id ? `${i.label} …` : i.label}</span>
        {sub && <span className="booth-btn-sub">{sub}</span>}
      </button>
    );
  };
  const face = faceGroups(buttons.face);
  const restGroups = faceGroups(buttons.rest);
  const harmGroup = (list: readonly CardButton[], size: "face" | "all") =>
    list.length > 0 && (
      <div className="booth-harm" role="group" aria-label={`Marks or captures ${name}`}>
        <span className="booth-harm-head">
          <BoothIcon name="warning" /> Marks or captures {name}: tap twice
        </span>
        {list.map((b) => btn(b, size))}
      </div>
    );
  const none = buttons.face.length === 0 && card !== null && (
    <p className="booth-none">
      {restLive && (objectives ?? []).length > 0
        ? allOpen
          ? `Nothing your objective needs on ${name} right now — the other buttons are below.`
          : `Nothing your objective needs on ${name} right now.`
        : restLive
          ? `Nothing to lead with on ${name} — the buttons are below.`
          : `Nothing for ${character} to press on ${name} right now.`}
    </p>
  );

  return (
    <div className="booth-card">
      <div className="booth-card-scroll">
        <div className="booth-card-who">
          <PersonAvatar name={name} size="md" />
          <div className="booth-card-name">
            <strong>{name}</strong>
            <span className="booth-card-id">
              {guest?.faction ?? "unaligned"} · {guestId}
            </span>
          </div>
        </div>
        {chips.length > 0 && (
          <ul className="booth-facts" aria-label="Facts">
            {chips.map((c) => (
              <li key={c.text} className={`booth-fact ${c.tone}`}>
                {c.text}
              </li>
            ))}
          </ul>
        )}
        {outcome !== null && <Outcome lines={outcome} />}
        {err && (
          <div className="booth-err" role="alert">
            {err}
          </div>
        )}
        {none}
        <div className="booth-utils">
          <button type="button" className="w95-btn booth-util" onClick={guard(onOpenThread)}>
            <BoothIcon name="message" /> Message
          </button>
          {lore.length > 0 && (
            <button type="button" className="w95-btn booth-util" onClick={guard(() => setSharing(true))}>
              <BoothIcon name="lore" /> Share lore…
            </button>
          )}
          <button type="button" className="w95-btn booth-util" onClick={rescan} disabled={scanning} aria-busy={scanning || undefined}>
            <BoothIcon name="rescan" /> {scanning ? "Scanning…" : "Scan again"}
          </button>
          {admin && view?.legacyCapture && (
            <button type="button" className="w95-btn booth-util" onClick={guard(() => void session.moderate(guestId, guest?.captured ? "release" : "capture"))}>
              {guest?.captured ? "🔓 Release" : "🔒 Capture"}
            </button>
          )}
        </div>
        {past.length > 0 && (
          <div className="booth-earlier">
            <button type="button" className="booth-fold" aria-expanded={earlier} onClick={guard(() => setEarlier((v) => !v))}>
              {earlier ? "▾" : "▸"} Earlier readouts ({past.length})
            </button>
            {earlier && (
              <ul className="booth-earlier-list">
                {past.map((r) => (
                  <li key={r.seq}>{r.text}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {buttons.rest.length > 0 && (
          <div className="booth-all">
            <button type="button" className="booth-fold" aria-expanded={allOpen} onClick={guard(() => setAll(!allOpen))}>
              {allOpen ? "▾" : "▸"} All buttons… ({buttons.rest.length})
            </button>
            {allOpen && (
              <div className="booth-all-list">
                {restGroups.safe.map((b) => btn(b, "all"))}
                {harmGroup(restGroups.harm, "all")}
              </div>
            )}
          </div>
        )}
      </div>
      {/* The face and Next guest sit on the window's bottom edge, in thumb
          reach, and hold still after a press (the outcome lands above). */}
      {(buttons.face.length > 0 || onNext !== undefined) && (
        <div className="booth-card-foot">
          {buttons.face.length > 0 && (
            <div className="booth-face">
              {harmGroup(face.harm, "face")}
              {face.safe.map((b) => btn(b, "face"))}
            </div>
          )}
          {onNext !== undefined && (
            <button type="button" className="w95-btn booth-next" onClick={guard(onNext)}>
              <Icon name="scan" /> Next guest
            </button>
          )}
        </div>
      )}
      {sharing && (
        <PickerSheet
          title={`Share with ${name}…`}
          items={lore.map((e) => ({ id: e.id, label: e.title, sub: e.about ?? undefined }))}
          onPick={(id) => void session.shareCodex(id, guestId)}
          onClose={() => setSharing(false)}
        />
      )}
    </div>
  );
}

/** What the last press or scan came to: the story's reply, the character's
 *  own line to the guest, a refusal from the staff room, or "no reply". */
export function Outcome({ lines }: { lines: readonly OutcomeLine[] }) {
  const refused = lines.some((l) => l.kind === "staff" && l.refused);
  const none = lines.every((l) => l.kind === "none");
  return (
    <div className={`booth-reply ${none ? "none" : "w95-inset"}${refused ? " refused" : ""}`} role="status" aria-live="polite">
      {lines.map((l, n) =>
        l.kind === "said" ? (
          <p key={n} className="booth-said">
            <span className="booth-said-from">{l.from !== "" ? `${l.from}:` : "Said:"}</span> {l.text}
          </p>
        ) : l.kind === "staff" ? (
          <p key={n} className={l.refused ? "booth-refusal" : "booth-staff"}>
            {l.refused && <BoothIcon name="warning" className="booth-refusal-ico" />}
            <span className="booth-refusal-tag">{l.refused ? "Not done:" : "Staff room:"}</span> {l.text}
          </p>
        ) : (
          <p key={n} className={l.kind === "none" ? "booth-noreply" : undefined}>
            {l.text}
          </p>
        ),
      )}
    </div>
  );
}

/** A guest's card in its own window (opened from Guests, a readout, a name). */
export function GuestCard({
  session,
  guestId,
  seed,
  admin,
  onClose,
  onOpenThread,
}: {
  session: PrimeSession;
  guestId: string;
  seed?: CardSeed;
  admin: boolean;
  onClose: () => void;
  onOpenThread: () => void;
}) {
  const name = session.view?.guests.find((g) => g.id === guestId)?.name ?? seed?.card?.guest.name ?? guestId;
  return (
    <BoothLayer title={<CardTitle name={name} />} label={`${name}'s card`} onClose={onClose}>
      <GuestCardBody session={session} guestId={guestId} seed={seed} admin={admin} onOpenThread={onOpenThread} />
    </BoothLayer>
  );
}

/** A card window's caption: the drawn ID card, then the guest's name. */
export function CardTitle({ name }: { name: string }) {
  return (
    <span className="booth-layer-title">
      <BoothIcon name="card" /> {name}
    </span>
  );
}
