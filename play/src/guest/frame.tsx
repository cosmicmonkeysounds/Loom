//! The guest's frame (wave 13, wave 18): what sits around the window on
//! every screen — the NOW title bar wired to the moments layer, the taskbar
//! (⊞ Start · ▣ Mission · 💬 Chats · 🎟 Pass · 📷 Scan) and its Start menu,
//! the tray's balance, the one-time "Get alerts" balloon, and the big
//! buttons Mission draws for an objective. `guest/app.tsx` lays them out as
//! `[TitleBar][MomentsAndPins][window or room][Taskbar]`.

import { useState, type ComponentProps, type ReactElement } from "react";
import { ARM_LINE, type ArmButtons } from "../arm.ts";
import { TrayBalloon, TraySlot } from "../chrome/balloon.tsx";
import type { StartItem, TaskbarButton } from "../chrome/taskbar.tsx";
import { TrayItem } from "../chrome/taskbar.tsx";
import { TitleBar } from "../chrome/title-bar.tsx";
import { Icon, IconTitle } from "../chrome/icons.tsx";
import { useNowMoment } from "../moments/provider.tsx";
import type { LiveCard } from "../moments/model.ts";
import { cardGlyph, trayCards } from "../stream/settled.ts";
import { optionalCard, supersededCards, type WidgetResult } from "../widgets.tsx";
import { usePlayHost } from "../host.ts";
import type { Push } from "../push.ts";
import { iosPushCopy, PushRow } from "../push-card.tsx";
import { showPushCard } from "../push.ts";
import type { Channel, GuestView, Interaction, ObjectiveView, WalletView } from "../types.ts";
import { factionModeOf, factionsOffered } from "../sides/mode.ts";
import { GroupPill, PersonAvatar, Sheet } from "../ui/primitives.tsx";
import { useWakeLock } from "../wake-lock.ts";

// --- the NOW title bar ---------------------------------------------------------

/** The flash a loud objective's moment asks of the NOW bar (its key is `o:<id>`, its text "title\nbrief"). */
export function nowFlashOf(m: { key: string; text: string } | null): { id: string; title: string; brief: string } | null {
  if (m === null || !m.key.startsWith("o:")) return null;
  const [title = "", ...rest] = m.text.split("\n");
  return { id: m.key.slice(2), title, brief: rest.join("\n") };
}

/** The guest's NOW title bar, wired to the moments layer: a loud objective
 *  going live flashes it open (never a second copy as a banner); opening
 *  the objective is reading it. Inside `MomentsProvider`. */
export function NowBar({ news: mission = null, ...props }: Omit<ComponentProps<typeof TitleBar>, "flash"> & { news?: { id: string; title: string } | null }) {
  const news = useNowMoment();
  return (
    <TitleBar
      {...props}
      // Wave 47: a house banner that said what Mission says blinks it instead.
      flash={nowFlashOf(news.moment) ?? (mission !== null ? { id: mission.id, title: mission.title, brief: "NEW MISSION" } : null)}
      onOpen={(o) => {
        news.seen(true);
        props.onOpen(o);
      }}
    />
  );
}

/** The top bar's left slot (wave 18, GUEST-SPEC §1.1): your picture, 44 × 44 → the Me sheet. */
export function MeButton({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <button type="button" className="title-bar-me" data-tour="me" aria-label="Me" title={name} onClick={onOpen}>
      <PersonAvatar name={name} size="sm" />
    </button>
  );
}

/** The live cards waiting on the guest, room by room (the tray's own rule),
 *  for a moment's exits (`moments/exits.ts` `exitsOf`). */
export function liveCardsOf(list: readonly Channel[], answered: ReadonlyMap<number, WidgetResult>): LiveCard[] {
  const out: LiveCard[] = [];
  for (const c of list) {
    if (c.kind === "codex" || c.kind === "quests" || c.kind === "wallet") continue;
    const roots = c.messages.filter((m) => m.parentSeq == null);
    for (const m of trayCards(roots, answered, supersededCards(roots))) out.push({ glyph: cardGlyph(m.widget!), channel: c.id, seq: m.seq, ...(optionalCard(m.widget!) ? { optional: true as const } : {}) });
  }
  return out;
}

// --- the Start menu ----------------------------------------------------------

/** The Start menu's banner: your picture, your name, your side, where you
 *  are — a button to the Me sheet (wave 18) when `onMe` is given. */
export function GuestStartHeader({ name, faction, where, onMe }: { name: string; faction: string | null; where: string; onMe?: () => void }) {
  const body = (
    <>
      <PersonAvatar name={name} size="lg" />
      <div className="start-who-body">
        <strong className="start-who-name">{name}</strong>
        <span className="start-who-tags">
          <GroupPill group={faction} />
        </span>
        <span className="start-who-where">{where}</span>
      </div>
    </>
  );
  if (onMe === undefined) return <div className="start-who">{body}</div>;
  return (
    <button type="button" className="start-who start-who-btn" aria-label={`Me: ${name}`} onClick={onMe}>
      {body}
      <span className="start-who-go" aria-hidden>
        ›
      </span>
    </button>
  );
}

/** "📍 The Desktop", "🔒 captured", "⛔ restricted", "📍 nowhere yet". */
export function whereLine(o: { captured: boolean; restricted: boolean; location: string | null }): string {
  if (o.captured) return "🔒 captured";
  if (o.restricted) return "⛔ restricted";
  return o.location !== null ? `📍 ${o.location}` : "📍 nowhere yet";
}

/** The Leave item's question. */
export function leaveQuestion(name: string): string {
  return `Leave the event? This phone stops being ${name}. You stay ${name} — to come back, scan your badge or ask a host.`;
}

/** Will the alerts sheet have anything to say on this phone? */
export function pushOffered(push: Pick<Push, "state">): boolean {
  return push.state !== "unsupported" && push.state !== "off";
}

export interface GuestStartInput {
  name: string;
  faction: string | null;
  /** The story's `who: guest` buttons (Bathroom Mode…). */
  interactions: readonly Interaction[];
  /** The story has sides open, or the guest has a crew: "Sides & crews". */
  sides: boolean;
  /** Wave 18b, faction mode (`founding:`): the item reads "Factions". */
  factions?: boolean;
  people: boolean;
  /** Wave 44 (C7): `🎬 Credits` while the story has rolled them (`creditsStartItem`). */
  credits?: StartItem | null;
  /** Wave 53 (C4): the phone's voice switch (`voiceStartItem`). */
  voice?: StartItem | null;
  open: {
    act: (i: Interaction) => void;
    sides: () => void;
    people: () => void;
    notifications: () => void;
    help: () => void;
    leave: () => void;
  };
}

/** Start's sides item off the view (wave 18b): offered whenever a faction
 *  is listed, you have a crew, or you may found one — in the show founding
 *  opens at the Truther Download while the declared sides stay hidden, so
 *  the list may hold nothing yet — and labelled "Factions" in faction mode.
 *  `guest/app.tsx` spreads it into `guestStartItems`. */
export function startSidesOf(view: GuestView | null | undefined): Pick<GuestStartInput, "sides" | "factions"> {
  return { sides: factionsOffered(view), factions: factionModeOf(view) };
}

/** A story button's label split into the menu's icon column and its words:
 *  "🚻 Bathroom Mode" → {icon: "🚻", label: "Bathroom Mode"}. */
export function splitIcon(label: string): { icon?: string; label: string } {
  const m = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s+(.+)$/u.exec(label);
  return m === null ? { label } : { icon: m[1]!, label: m[2]! };
}

/** The guest's Start menu, top to bottom (pure — `test/start-menu.test.tsx`,
 *  GUEST-SPEC §8.2): the story's own buttons first (they are what a guest
 *  comes here for), then 🎬 Credits once the story has rolled them (wave
 *  44), Sides & crews, People, Notifications, the phone's voice (wave 53),
 *  Help, and Leave last, behind its confirmation — at most six items past
 *  the story's and the credits. Your picture, the wake lock and alerts moved to the Me sheet;
 *  switching sides to the Sides sheet. An `arm: true` button arms, then
 *  fires, through core's arm model (`chrome/start-menu.tsx`). */
export function guestStartItems(o: GuestStartInput): StartItem[] {
  const items: StartItem[] = o.interactions.map((i) => ({
    id: `act:${i.id}`,
    ...splitIcon(i.label),
    onClick: () => o.open.act(i),
    ...(i.arm === true ? { arm: true } : {}),
  }));
  if (o.credits != null) items.push(o.credits);
  if (o.sides) items.push({ id: "sides", label: o.factions === true ? "Factions" : "Sides & crews", icon: <Icon name="door" />, onClick: o.open.sides });
  if (o.people) items.push({ id: "people", label: "People", icon: <Icon name="people" />, onClick: o.open.people });
  items.push({ id: "notifications", label: "Notifications", icon: <Icon name="bell" />, onClick: o.open.notifications });
  if (o.voice != null) items.push(o.voice);
  items.push({ id: "help", label: "Help", icon: <Icon name="help" />, onClick: o.open.help });
  items.push({ id: "leave", label: "Leave the event", icon: <Icon name="leave" />, onClick: o.open.leave, danger: true, confirm: leaveQuestion(o.name) });
  return items;
}

/** The wake lock's switch for the Start menu (null in an embedded pane). */
export function useStartWake(): { supported: boolean; on: boolean; toggle: () => void } | null {
  const host = usePlayHost();
  const lock = useWakeLock(host.storage);
  return host.embedded ? null : lock;
}

// --- the taskbar's buttons ---------------------------------------------------

export interface GuestTaskbarInput {
  now: ObjectiveView | null;
  /** The window the taskbar shows pressed (null: none, e.g. Notifications). */
  pressed: "mission" | "chats" | null;
  /** A Chats row has a dot. */
  chatsDot: boolean;
  /** The NOW objective changed since Mission was last on screen. */
  missionNew: boolean;
  mission: () => void;
  chats: () => void;
  pass: () => void;
  scan: () => void;
}

/** The guest's taskbar windows and tools (wave 18, GUEST-SPEC §1.2):
 *  ▣ Mission · 💬 Chats (pressed like Win95 task buttons) · 🎟 Pass (the
 *  navy primary) · 📷 Scan, each an icon over its word, the word kept at
 *  every width. Pass / Scan light when the NOW objective names them. */
export function guestTaskbarButtons(o: GuestTaskbarInput): TaskbarButton[] {
  const wants = new Set(o.now?.buttons ?? []);
  return [
    { id: "mission", label: "Mission", icon: <Icon name="mission" size={20} />, onClick: o.mission, stacked: true, tour: "mission", title: "What to do now", pressed: o.pressed === "mission", ...(o.missionNew ? { mark: "!" } : {}) },
    { id: "chats", label: "Chats", icon: <Icon name="reply" size={20} />, onClick: o.chats, stacked: true, tour: "chats", title: "Places and people", pressed: o.pressed === "chats", dot: o.chatsDot },
    { id: "pass", label: "Pass", icon: <Icon name="pass" size={20} />, onClick: o.pass, primary: true, stacked: true, tour: "pass", title: "Show your pass", active: wants.has("pass") },
    { id: "scan", label: "Scan", icon: <Icon name="scan" size={20} />, onClick: o.scan, stacked: true, tour: "scan", title: "Scan a code on the wall", active: wants.has("scan") },
  ];
}

// --- the tray ----------------------------------------------------------------

/** The balance as a tray item: `🪙 100` (`🧊` while frozen); a tap opens a
 *  balloon with the holds and the way to the Wallet room. */
export function BalanceTray({ view, frozen, onOpen }: { view: WalletView; frozen: boolean; onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <TraySlot>
      <TrayItem icon={<Icon name={frozen ? "frozen" : "coin"} />} text={String(view.balance)} title={`${view.balance} ${view.name}`} tone={frozen ? "dim" : undefined} onClick={() => setOpen((v) => !v)} />
      {open && (
        <TrayBalloon title={`${view.balance} ${view.name}`} onClose={() => setOpen(false)} label="Your wallet">
          {view.escrowed > 0 && <div className="tray-balloon-line">{view.escrowed} on hold</div>}
          {frozen && <div className="tray-balloon-line">Frozen — you can't send for now.</div>}
          <button
            type="button"
            className="w95-btn tray-balloon-go"
            onClick={() => {
              setOpen(false);
              onOpen();
            }}
          >
            Open the Wallet ›
          </button>
        </TrayBalloon>
      )}
    </TraySlot>
  );
}

/** The one-time "Get alerts" offer, as a balloon from the tray (never a
 *  bar over the rooms). It waits for an answer: only Turn on, Not now (OK)
 *  or Escape put it away for good — a tap on a room or a scroll leaves it
 *  up, so the offer is never lost to the first tap after the tour. */
export function AlertsBalloon({ push, why, title }: { push: Push; why: string; title?: string | null }) {
  if (!showPushCard(push.state, push.dismissed)) return null;
  const ios = iosPushCopy(push.state, false, title);
  return (
    <TrayBalloon title={<IconTitle icon="bell">{ios?.head ?? "Get alerts"}</IconTitle>} onClose={push.dismiss} timeoutMs={null} closeOnTapAway={false} label="Get alerts" floating>
      <div className="tray-balloon-line">{ios?.body ?? why}</div>
      <div className="tray-balloon-row">
        {ios === null && (
          <button
            type="button"
            className="w95-btn tray-balloon-go"
            onClick={() => {
              push.enable();
              push.dismiss();
            }}
          >
            Turn on
          </button>
        )}
        <button type="button" className="w95-btn" onClick={push.dismiss}>
          {ios === null ? "Not now" : "OK"}
        </button>
      </div>
    </TrayBalloon>
  );
}

// --- sheets the Start menu opens ---------------------------------------------

/** 🔔 The alerts switch and where it stands. */
export function AlertsSheet({ push, title, onClose }: { push: Push; title?: string | null; onClose: () => void }) {
  return (
    <Sheet title={<IconTitle icon="bell">Alerts</IconTitle>} onClose={onClose}>
      <PushRow push={push} title={title} />
    </Sheet>
  );
}

/** Mission's big button for an objective's `buttons:` id (pure over its
 *  inputs — `test/frame.test.tsx`): `pass` opens the full-screen pass,
 *  `scan` the scan sheet, a story button fires through the arm model (an
 *  `arm: true` one needs its two taps); an id the guest can't press is no
 *  button. */
export function objectiveButton({
  interactions,
  arm,
  onPass,
  onScan,
  onAct,
}: {
  interactions: readonly Interaction[];
  arm: ArmButtons;
  onPass: () => void;
  onScan: () => void;
  onAct: (i: Interaction) => void;
}): (id: string) => ReactElement | null {
  return (id) => {
    if (id === "pass")
      return (
        <button type="button" className="choice primary objective-go mission-big" onClick={onPass}>
          <Icon name="pass" size={20} /> SHOW MY PASS
        </button>
      );
    if (id === "scan")
      return (
        <button type="button" className="choice primary objective-go mission-big" onClick={onScan}>
          <Icon name="scan" size={20} /> SCAN A CODE
        </button>
      );
    const i = interactions.find((x) => x.id === id);
    if (i === undefined) return null;
    return (
      <button
        type="button"
        className={`choice mission-big${arm.armed === i.id ? " armed" : ""}`}
        title={i.description ?? undefined}
        aria-pressed={arm.armed === i.id || undefined}
        onClick={() => arm.tap(i.id, i.arm, () => onAct(i))}
      >
        {i.label}
        {arm.armed === i.id && <span className="arm-line">{ARM_LINE}</span>}
      </button>
    );
  };
}
