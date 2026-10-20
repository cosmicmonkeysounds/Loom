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
import { boothHost, cardButtons, cardGuestFacts, cardReadKey, factChips, faceSettled, foldOpensItself, inFlightGate, pressOutcome, type CardButton, type OutcomeLine } from "./model.ts";

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
function cardError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/doors are closed/i.test(msg)) return "The doors aren't open yet — the buttons work once they are.";
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
        if (readFor.current === key) setErr(cardError(e));
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestId, nightKey]);

  // C3: the row's flags are the ones on plus failed gates; the card's read has them all.
  const guest: PrimeGuest | null = cardGuestFacts(row, card?.guest ?? null);
  const name = guest?.name ?? guestId;
  const where = guest?.location ? (view?.channels.find((c) => c.id === `loc:${guest.location}`)?.title ?? guest.location) : null;
  const chips = guest !== null ? factChips(guest, where) : [];
  const buttons = cardButtons(view?.interactions ?? [], objectives, card, character, admin || boothHost(session.auth, view));
  const lore = view?.codex ?? [];
  const restLive = buttons.rest.some((b) => b.live);
  const allOpen = all ?? foldOpensItself(buttons, card !== null);
  const shown = new Set((outcome ?? []).filter((l) => l.kind === "reply").map((l) => l.text));
  const past = (card?.readouts ?? []).filter((r) => !shown.has(r.text.trim()));

  const press = (b: CardButton) => {
    const i = b.interaction;
    if (busy !== null || !faceSettled(landedAt.current, Date.now())) return;
    arm.tap(i.id, i.arm, () => {
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
          setErr(e instanceof Error ? e.message : String(e));
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
        setErr(e instanceof Error ? e.message : String(e));
      },
    );
  };

  // The Win95 default button: the first face button an objective asks for.
  const defaultId = buttons.face.find((b) => b.named === true)?.interaction.id ?? null;
  const btn = (b: CardButton, size: "face" | "all") => {
    const i = b.interaction;
    const armed = arm.armed === i.id;
    const sub = armed ? ARM_LINE : !b.live ? `Not on offer now${i.description ? ` · ${i.description}` : ""}` : i.description;
    return (
      <button
        key={i.id}
        type="button"
        className={`w95-btn booth-btn ${size === "face" ? "booth-face-btn" : "booth-all-btn"}${size === "face" && i.id === defaultId ? " booth-default" : ""} ${armed ? "armed" : ""} ${b.live ? "" : "off"}`}
        aria-pressed={armed || undefined}
        aria-busy={busy === i.id || undefined}
        disabled={busy !== null}
        onClick={() => press(b)}
      >
        <span className="booth-btn-label">{busy === i.id ? `${i.label} …` : i.label}</span>
        {sub && <span className="booth-btn-sub">{sub}</span>}
      </button>
    );
  };

  return (
    <div className="booth-card">
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
      <div className="booth-face">
        {buttons.face.map((b) => btn(b, "face"))}
        {buttons.face.length === 0 && card !== null && (
          <p className="booth-none">
            {restLive && (objectives ?? []).length > 0
              ? allOpen
                ? `Nothing your objective needs on ${name} right now — the other buttons are below.`
                : `Nothing your objective needs on ${name} right now.`
              : restLive
                ? `Nothing to lead with on ${name} — the buttons are below.`
                : `Nothing for ${character} to press on ${name} right now.`}
          </p>
        )}
      </div>
      <div className="booth-utils">
        <button type="button" className="w95-btn" onClick={onOpenThread}>
          💬 Message
        </button>
        {lore.length > 0 && (
          <button type="button" className="w95-btn" onClick={() => setSharing(true)}>
            📓 Share lore…
          </button>
        )}
        <button type="button" className="w95-btn" onClick={rescan} disabled={scanning} aria-busy={scanning || undefined}>
          {scanning ? "📡 Scanning…" : "📡 Scan again"}
        </button>
        {admin && view?.legacyCapture && (
          <button type="button" className="w95-btn" onClick={() => void session.moderate(guestId, guest?.captured ? "release" : "capture")}>
            {guest?.captured ? "🔓 Release" : "🔒 Capture"}
          </button>
        )}
      </div>
      {past.length > 0 && (
        <div className="booth-earlier">
          <button type="button" className="booth-fold" aria-expanded={earlier} onClick={() => setEarlier((v) => !v)}>
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
          <button type="button" className="booth-fold" aria-expanded={allOpen} onClick={() => setAll(!allOpen)}>
            {allOpen ? "▾" : "▸"} All buttons… ({buttons.rest.length})
          </button>
          {allOpen && <div className="booth-all-list">{buttons.rest.map((b) => btn(b, "all"))}</div>}
        </div>
      )}
      {onNext !== undefined && (
        <button type="button" className="w95-btn booth-next" onClick={onNext}>
          📷 Next guest
        </button>
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
    <BoothLayer title={`🪪 ${name}`} label={`${name}'s card`} onClose={onClose}>
      <GuestCardBody session={session} guestId={guestId} seed={seed} admin={admin} onOpenThread={onOpenThread} />
    </BoothLayer>
  );
}
