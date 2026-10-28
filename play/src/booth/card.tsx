//! A guest's card in the booth (wave 13): opened at once by a scan, or from
//! 🗂 Guests, a readout, a name or a room's who's-here list. It leads with
//! the facts a performer acts on (🔒, Marked, ⛔, 📍), then at most three
//! story buttons — the ones the character's live objectives name and the
//! server says are live for this guest (a host also gets the ones live
//! because of this guest) — then the story's reply to the press. Since
//! wave 21 there is no "All buttons…", no earlier readouts and no raw id:
//! a performer sees what the night asks of them, never the story's
//! machinery. `arm: true` buttons arm on the first tap and fire on the
//! second.

import { showClockOf } from "../show-clock.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { PersonAvatar, PickerSheet } from "../ui/primitives.tsx";
import { GuestBadges } from "./badges.tsx";
import { usePlayHost } from "../host.ts";
import { ARM_LINE, useArmButtons } from "../arm.ts";
import type { PrimeSession } from "../session/prime.ts";
import type { GuestCardView, PrimeGuest } from "../types.ts";
import { BoothLayer } from "./layer.tsx";
import { armsFirst, boothHost, goneLine, cardButtons, cardGuestFacts, cardReadKey, defaultFaceId, destructive, faceGroups, factChips, faceSettled, heldFace, inFlightGate, pressOutcome, scanError, scanRepeated, SCAN_REPEATED, type CardButton, type OutcomeLine } from "./model.ts";
import { Icon } from "../chrome/icons.tsx";
import { BoothIcon } from "./icons.tsx";
import { ConfrontScreen } from "./confront.tsx";
import { confrontFor, leadingGlyph, type Confront } from "./popouts/model.ts";
import { PopOutQuiet } from "./popouts/rung.ts";
import { WantedBanner } from "./wanted/poster.tsx";
import { isPlayer, looseWanted, wantedOf } from "./wire.ts";

/** The card's 🩹 unmark button among the live ids (the confrontation's "Not them…"). */
export function unmarkIdOf(live: readonly string[], interactions: readonly { id: string; label: string }[]): string | null {
  const byId = new Map(interactions.map((i) => [i.id, i.label]));
  return live.find((id) => leadingGlyph(byId.get(id) ?? "") === "🩹") ?? null;
}

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
 * inside its own window (`GuestCard`). `onNext` = back to the camera (door
 * work only, wave 37 C3); `onLeave` = the scanner's × (C1).
 */
export function GuestCardBody({
  session,
  guestId,
  seed,
  admin,
  onOpenThread,
  onNext,
  confront: confrontMode,
  onBoard,
  onConfrontDone,
  onLeave,
  onPress,
}: {
  session: PrimeSession;
  guestId: string;
  seed?: CardSeed;
  admin: boolean;
  onOpenThread: () => void;
  onNext?: () => void;
  /** Wave 18 (§4.3): open on the confrontation (a remote one: two taps), e.g. from a `🛡` pop-out. */
  confront?: "rescan";
  /** Open the Wanted board (the captured screen's Board button). */
  onBoard?: () => void;
  /** Where the confrontation's Not now goes (default: `onLeave`, else back to the card). */
  onConfrontDone?: () => void;
  /** Wave 37 (C1): leave the scanner (its ×): a confrontation's Not now from a scan's card. */
  onLeave?: () => void;
  /** Wave 37 (C14): a face button is about to be pressed (the booth notes its own fire). */
  onPress?: (id: string) => void;
}) {
  const [card, setCard] = useState<GuestCardView | null>(seed?.card ?? null);
  // What the last press / scan came to (C1): replies, the character's
  // lines, a refusal, or "no reply from the story". A card opened from a
  // scan leads with that scan's.
  const player = isPlayer(session.view);
  const [outcome, setOutcome] = useState<OutcomeLine[] | null>(seed?.replies !== undefined ? pressOutcome(seed, "scan", { player }) : null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // "📡 Scan again" — one at a time: every scan is journaled and runs the
  // story's scan hook, so taps while one is on its way are ignored.
  const [scanning, setScanning] = useState(false);
  const scanGate = useMemo(() => inFlightGate(), []);
  const [sharing, setSharing] = useState(false);
  // The face as it stood at the last press (top to bottom), held still while
  // the outcome lands above it (`heldFace`); a re-scan lets it go.
  const [frozen, setFrozen] = useState<string[] | null>(null);
  // The press that froze it: only that spent row reads "Done" (`goneLine`).
  const [pressedId, setPressedId] = useState<string | null>(null);
  const arm = useArmButtons();
  const host = usePlayHost();
  // Wave 18: the confrontation over the card (a rescan of a wanted program,
  // or a card opened in confront mode); `said` = the scan's SAY IT lines.
  const [confront, setConfront] = useState<{ c: Confront; said: string[] } | null>(null);
  const [claiming, setClaiming] = useState(false);
  const confrontAsked = useRef(confrontMode === "rescan");
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

  // A card opened in confront mode shows the confrontation once its read lands.
  useEffect(() => {
    if (!confrontAsked.current || card === null) return;
    confrontAsked.current = false;
    const c = confrontFor({ guest: { id: guestId }, card }, wantedOf(view), view?.interactions ?? [], "rescan");
    if (c !== null) setConfront({ c, said: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);
  const wantedRow = (wantedOf(view) ?? []).find((w) => w.id === guestId && !w.captured) ?? null;

  // C3: the row's flags are the ones on plus failed gates; the card's read has them all.
  const guest: PrimeGuest | null = cardGuestFacts(row, card?.guest ?? null);
  const name = guest?.name ?? guestId;
  const where = guest?.location ? (view?.channels.find((c) => c.id === `loc:${guest.location}`)?.title ?? guest.location) : null;
  const chips = guest !== null ? factChips(guest, where) : [];
  const read = cardButtons(view?.interactions ?? [], objectives, card, character, admin || boothHost(session.auth, view), { player });
  const buttons = heldFace(read.face, read.rest, frozen, view?.interactions ?? []);
  const lore = view?.codex ?? [];
  // Every control on the card ignores a tap inside the settle after the
  // card was replaced — Next guest and the utility row too, so a second tap
  // never lands on whatever moved under the finger.
  const settled = () => faceSettled(landedAt.current, Date.now());
  const guard = (f: () => void) => () => {
    if (settled()) f();
  };

  const press = (b: CardButton) => {
    const i = b.interaction;
    if (busy !== null || !settled()) return;
    arm.tap(i.id, armsFirst(i), () => {
      setFrozen(buttons.face.map((x) => x.interaction.id));
      setPressedId(i.id);
      setBusy(i.id);
      setErr("");
      setOutcome(null);
      onPress?.(i.id);
      session.act(i.id, guestId).then(
        (r) => {
          setBusy(null);
          landed();
          setOutcome(pressOutcome(r, "press", { player }));
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
        setOutcome(pressOutcome({ replies: r.responses, said: r.said, staff: r.staff, refused: r.refused }, "scan", { player }));
        if (r.card !== undefined) setCard(r.card);
        // Wave 18 (§4.3): Scan again on a wanted program is a remote confrontation (two taps).
        const c = confrontFor(r, wantedOf(session.view), session.view?.interactions ?? [], "rescan");
        if (c !== null) setConfront({ c, said: (r.said ?? []).map((l) => l.text) });
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
  const btn = (b: CardButton & { gone?: true }) => {
    const i = b.interaction;
    const armed = arm.armed === i.id;
    const harm = destructive(i);
    const sub = armed ? ARM_LINE : b.gone === true ? goneLine(i.id, pressedId) : !b.live ? `Not on offer now${i.description ? ` · ${i.description}` : ""}` : i.description;
    return (
      <button
        key={i.id}
        type="button"
        className={`w95-btn booth-btn booth-face-btn${i.id === defaultId ? " booth-default" : ""}${harm ? " harm" : ""} ${armed ? "armed" : ""} ${b.live ? "" : "off"}`}
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
  const harmGroup = (list: readonly CardButton[]) =>
    list.length > 0 && (
      <div className="booth-harm" role="group" aria-label={`Marks or captures ${name}`}>
        <span className="booth-harm-head">
          <BoothIcon name="warning" /> Marks or captures {name}: tap twice
        </span>
        {list.map((b) => btn(b))}
      </div>
    );
  const none = buttons.face.length === 0 && card !== null && (
    <p className="booth-none">
      {noneLine({ player, name, character, objectives: (objectives ?? []).length })}
    </p>
  );

  if (confront !== null) {
    return (
      <div className="booth-card">
        <div className="booth-card-scroll">
          <PopOutQuiet />
          <ConfrontScreen
            c={confront.c}
            me={character}
            said={confront.said}
            unmarkId={card !== null ? unmarkIdOf(card.live, view?.interactions ?? []) : null}
            board={looseWanted(view).filter((w) => w.id !== guestId).length}
            caughtBy={(wantedOf(view) ?? []).find((w) => w.id === guestId && w.captured)?.claimedBy ?? null}
            showClock={showClockOf(view)}
            press={(id) => session.act(id, guestId)}
            onNotNow={() => {
              setConfront(null);
              (onConfrontDone ?? onLeave)?.();
            }}
            onNext={
              onNext !== undefined
                ? () => {
                    setConfront(null);
                    onNext();
                  }
                : undefined
            }
            onBoard={onBoard}
          />
        </div>
      </div>
    );
  }
  const claim = () => {
    if (claiming) return;
    setClaiming(true);
    session.act("claim_escort", guestId).then(
      () => setClaiming(false),
      (e) => {
        setClaiming(false);
        setErr(cardError(e, session.view));
      },
    );
  };

  return (
    <div className="booth-card">
      <div className="booth-card-scroll">
        {/* Wave 37 (C4): face to face, nothing floats: a pop-out waits (unshown, untimed, silent) until the card closes. */}
        <PopOutQuiet />
        <div className="booth-card-who">
          <PersonAvatar name={name} size="md" />
          <div className="booth-card-name">
            <strong>
              {name}
              <GuestBadges id={guestId} />
            </strong>
            <span className="booth-card-id">
              {guest?.faction ?? "unaligned"}
            </span>
          </div>
        </div>
        {wantedRow !== null && <WantedBanner w={wantedRow} me={character} busy={claiming} onClaim={(view?.interactions ?? []).some((i) => i.id === "claim_escort") ? claim : undefined} />}
        {chips.length > 0 && (
          <ul className="booth-facts" aria-label="Facts">
            {chips.map((c) => (
              <li key={c.text} className={`booth-fact ${c.tone}`}>
                {c.text}
              </li>
            ))}
          </ul>
        )}
        {/* C12: the result first; what the story said folds under it (a new press remounts it, folded). */}
        {outcome !== null && <Outcome lines={outcome} foldSaid />}
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
      </div>
      {/* The face and Next guest sit on the window's bottom edge, in thumb
          reach, and hold still after a press (the outcome lands above). */}
      {(buttons.face.length > 0 || onNext !== undefined) && (
        <div className="booth-card-foot">
          {buttons.face.length > 0 && (
            <div className="booth-face">
              {harmGroup(face.harm)}
              {face.safe.map((b) => btn(b))}
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

/** The card's line when its face is empty (wave 21: there is no fold below it). */
export function noneLine({ player, name, character, objectives }: { player: boolean; name: string; character: string; objectives: number }): string {
  if (player) return `Nothing to do with ${name} right now.`;
  return objectives > 0 ? `Nothing your objective needs on ${name} right now.` : `Nothing for ${character} to press on ${name} right now.`;
}

/** Wave 37 (C12): which lines show at once and which fold behind *What
 *  the story said*. With `foldSaid`, the character's `said` lines (the
 *  guest's Tube narration) fold once there is a result to lead with (a
 *  reply or a staff line that is not a refusal); said lines alone stay
 *  open (they are the result), and so do they beside a refusal: on a host
 *  booth a refused press may say why only through the character's line. */
export function outcomeSplit(lines: readonly OutcomeLine[], foldSaid: boolean): { shown: OutcomeLine[]; folded: OutcomeLine[] } {
  const lead = lines.some((l) => l.kind === "reply" || (l.kind === "staff" && !l.refused));
  if (!foldSaid || !lead) return { shown: [...lines], folded: [] };
  return { shown: lines.filter((l) => l.kind !== "said"), folded: lines.filter((l) => l.kind === "said") };
}

function SaidLine({ l }: { l: Extract<OutcomeLine, { kind: "said" }> }) {
  return (
    <p className="booth-said">
      <span className="booth-said-from">{l.from !== "" ? `${l.from}:` : "Said:"}</span> {l.text}
    </p>
  );
}

/** What the last press or scan came to: the story's reply, the character's
 *  own line to the guest, a refusal from the staff room, or "no reply".
 *  `foldSaid` (the card, wave 37 C12): replies in full, said lines folded. */
export function Outcome({ lines, foldSaid = false }: { lines: readonly OutcomeLine[]; foldSaid?: boolean }) {
  const [open, setOpen] = useState(false);
  const { shown, folded } = outcomeSplit(lines, foldSaid);
  const refused = lines.some((l) => l.kind === "staff" && l.refused);
  const none = lines.every((l) => l.kind === "none");
  return (
    <div className={`booth-reply ${none ? "none" : "w95-inset"}${refused ? " refused" : ""}`} role="status" aria-live="polite">
      {shown.map((l, n) =>
        l.kind === "said" ? (
          <SaidLine key={n} l={l} />
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
      {folded.length > 0 && (
        <div className="booth-earlier">
          <button type="button" className="booth-fold" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? "▾" : "▸"} What the story said
          </button>
          {open && folded.map((l, n) => (l.kind === "said" ? <SaidLine key={n} l={l} /> : null))}
        </div>
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
  confront,
  onBoard,
  onPress,
}: {
  session: PrimeSession;
  guestId: string;
  seed?: CardSeed;
  admin: boolean;
  onClose: () => void;
  onOpenThread: () => void;
  confront?: "rescan";
  onBoard?: () => void;
  /** Wave 37 (C14): a face button is about to be pressed. */
  onPress?: (id: string) => void;
}) {
  const name = session.view?.guests.find((g) => g.id === guestId)?.name ?? seed?.card?.guest.name ?? guestId;
  return (
    <BoothLayer title={<CardTitle name={name} />} label={`${name}'s card`} onClose={onClose} dock={false}>
      {/* Keyed per guest: a card's held face, outcome and fold never carry over to another guest. */}
      <GuestCardBody key={guestId} session={session} guestId={guestId} seed={seed} admin={admin} onOpenThread={onOpenThread} confront={confront} onBoard={onBoard} onConfrontDone={confront === "rescan" ? onClose : undefined} onPress={onPress} />
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
