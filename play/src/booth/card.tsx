//! A guest's card in the booth (wave 13): opened at once by a scan, or from
//! 🗂 Guests, a readout, a name or a room's who's-here list. It leads with
//! the facts (Not cleared, ⛔, 🔒, 📍, the story's flags), then at most
//! three story buttons — the ones the character's live objectives name and
//! the server says are live for this guest — then the story's reply to the
//! press, and every other button under "All buttons… (n)" with its
//! description. `arm: true` buttons arm on the first tap and fire on the
//! second.

import { useEffect, useRef, useState } from "react";
import { PersonAvatar, PickerSheet } from "../ui/primitives.tsx";
import { ARM_LINE, useArmButtons } from "../arm.ts";
import type { PrimeSession } from "../session/prime.ts";
import type { GuestCardView, PrimeGuest } from "../types.ts";
import { BoothLayer } from "./layer.tsx";
import { cardButtons, factChips, faceSettled, type CardButton } from "./model.ts";

// `splitInteractions` lives in `model.ts` now; the barrel re-exports it from here.
export { splitInteractions } from "./model.ts";

/** What a scan (or a press) already said: the server's card and the story's reply. */
export interface CardSeed {
  card?: GuestCardView;
  replies?: string[];
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
  const [replies, setReplies] = useState<string[] | null>(seed?.replies !== undefined && seed.replies.length > 0 ? seed.replies : null);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [earlier, setEarlier] = useState(false);
  const [sharing, setSharing] = useState(false);
  const arm = useArmButtons();
  // When the card was last replaced: taps inside `FACE_SETTLE_MS` of it are
  // dropped (the face re-flowed, so the finger now sits on another button).
  const landedAt = useRef<number | null>(null);
  const landed = () => {
    landedAt.current = Date.now();
  };
  const view = session.view;
  const character = session.auth?.character ?? "";
  const objectives = view?.objectives;
  // Re-read the card when the night moves (an objective opens or ticks a
  // box): a card left open on the counter never offers yesterday's buttons.
  const nightKey = JSON.stringify([(objectives ?? []).map((o) => [o.id, o.checklist.map((c) => c.done)]), view?.night?.step ?? null, view?.night?.phase ?? null]);
  // The key the card on screen was read for; a scan's own card counts.
  const readFor = useRef<string | null>(seed?.card !== undefined ? `${guestId}|${nightKey}` : null);
  useEffect(() => {
    const key = `${guestId}|${nightKey}`;
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

  const guest: PrimeGuest | null = card?.guest ?? view?.guests.find((g) => g.id === guestId) ?? null;
  const name = guest?.name ?? guestId;
  const where = guest?.location ? (view?.channels.find((c) => c.id === `loc:${guest.location}`)?.title ?? guest.location) : null;
  const chips = guest !== null ? factChips(guest, where) : [];
  const buttons = cardButtons(view?.interactions ?? [], objectives, card, character, admin || session.auth?.host === true);
  const lore = view?.codex ?? [];
  const past = (card?.readouts ?? []).filter((r) => replies === null || !replies.includes(r.text));

  const press = (b: CardButton) => {
    const i = b.interaction;
    if (busy !== null || !faceSettled(landedAt.current, Date.now())) return;
    arm.tap(i.id, i.arm, () => {
      setBusy(i.id);
      setErr("");
      setDone(null);
      session.act(i.id, guestId).then(
        (r) => {
          setBusy(null);
          landed();
          const said = r.replies ?? [];
          setReplies(said.length > 0 ? said : null);
          setDone(said.length > 0 ? null : `✔ ${i.label}`);
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
    setErr("");
    setDone(null);
    session.scan(guestId).then(
      (r) => {
        landed();
        setReplies(r.responses.length > 0 ? r.responses : null);
        setDone(r.responses.length > 0 ? null : "✔ Scanned");
        if (r.card !== undefined) setCard(r.card);
      },
      (e) => setErr(e instanceof Error ? e.message : String(e)),
    );
  };

  const btn = (b: CardButton, size: "face" | "all") => {
    const i = b.interaction;
    const armed = arm.armed === i.id;
    const sub = armed ? ARM_LINE : !b.live ? `Not on offer now${i.description ? ` · ${i.description}` : ""}` : i.description;
    return (
      <button
        key={i.id}
        type="button"
        className={`w95-btn booth-btn ${size === "face" ? "booth-face-btn" : "booth-all-btn"} ${armed ? "armed" : ""} ${b.live ? "" : "off"}`}
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
      {(replies !== null || done !== null) && (
        <div className="booth-reply w95-inset" role="status" aria-live="polite">
          {replies !== null ? replies.map((r, n) => <p key={n}>{r}</p>) : <p>{done}</p>}
        </div>
      )}
      {err && (
        <div className="booth-err" role="alert">
          {err}
        </div>
      )}
      <div className="booth-face">
        {buttons.face.map((b) => btn(b, "face"))}
        {buttons.face.length === 0 && card !== null && <p className="booth-none">Nothing for {character} to press on {name} right now.</p>}
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
        <button type="button" className="w95-btn" onClick={rescan}>
          📡 Scan again
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
          <button type="button" className="booth-fold" aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? "▾" : "▸"} All buttons… ({buttons.rest.length})
          </button>
          {all && <div className="booth-all-list">{buttons.rest.map((b) => btn(b, "all"))}</div>}
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
