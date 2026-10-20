//! The guest's frame (wave 13): what sits around the conversation on every
//! screen — the NOW title bar's objective sheet, the taskbar's Start menu
//! (who you are + everything the old identity card and ☰ sheet held), the
//! tray's balance, and the one-time "Get alerts" balloon. `guest/app.tsx`
//! lays them out as `[TitleBar][PinnedRail][Shell][Taskbar]`.

import { useState, type ComponentProps, type ReactElement } from "react";
import { ARM_LINE, useArmButtons, type ArmButtons } from "../arm.ts";
import { TrayBalloon, TraySlot } from "../chrome/balloon.tsx";
import type { StartItem, TaskbarButton } from "../chrome/taskbar.tsx";
import { TrayItem } from "../chrome/taskbar.tsx";
import { TitleBar } from "../chrome/title-bar.tsx";
import { Icon } from "../chrome/icons.tsx";
import { useNowMoment } from "../moments/provider.tsx";
import type { LiveCard } from "../moments/model.ts";
import { cardGlyph, trayCards } from "../stream/settled.ts";
import { supersededCards, type WidgetResult } from "../widgets.tsx";
import { usePlayHost } from "../host.ts";
import type { Push } from "../push.ts";
import { iosPushCopy, PushRow } from "../push-card.tsx";
import { showPushCard } from "../push.ts";
import { withThe } from "../rooms/spaces.ts";
import type { Channel, Interaction, ObjectiveView, WalletView } from "../types.ts";
import { ObjectiveCard } from "../ui/objective.tsx";
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
export function NowBar(props: Omit<ComponentProps<typeof TitleBar>, "flash">) {
  const news = useNowMoment();
  return (
    <TitleBar
      {...props}
      flash={nowFlashOf(news.moment)}
      onOpen={(o) => {
        news.seen(true);
        props.onOpen(o);
      }}
    />
  );
}

/** The live cards waiting on the guest, room by room (the tray's own rule),
 *  for a moment's "Take me there" (`exitRoomFor`). */
export function liveCardsOf(list: readonly Channel[], answered: ReadonlyMap<number, WidgetResult>): LiveCard[] {
  const out: LiveCard[] = [];
  for (const c of list) {
    if (c.kind === "codex" || c.kind === "quests" || c.kind === "wallet") continue;
    const roots = c.messages.filter((m) => m.parentSeq == null);
    for (const m of trayCards(roots, answered, supersededCards(roots))) out.push({ glyph: cardGlyph(m.widget!), channel: c.id, seq: m.seq });
  }
  return out;
}

// --- the Start menu ----------------------------------------------------------

/** The Start menu's banner: your picture, your name, your side, where you are. */
export function GuestStartHeader({ name, faction, where }: { name: string; faction: string | null; where: string }) {
  return (
    <div className="start-who">
      <PersonAvatar name={name} size="lg" />
      <div className="start-who-body">
        <strong className="start-who-name">{name}</strong>
        <span className="start-who-tags">
          <GroupPill group={faction} />
        </span>
        <span className="start-who-where">{where}</span>
      </div>
    </div>
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
  return `Leave the event? This phone stops being ${name}.`;
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
  /** Public sides to defect to (none while restricted). */
  defectTo: readonly string[];
  wake: { supported: boolean; on: boolean } | null;
  push: boolean;
  people: boolean;
  open: {
    picture: () => void;
    wake: () => void;
    alerts: () => void;
    people: () => void;
    help: () => void;
    act: (i: Interaction) => void;
    defect: (to: string) => void;
    leave: () => void;
  };
}

/** A story button's label split into the menu's icon column and its words:
 *  "🚻 Bathroom Mode" → {icon: "🚻", label: "Bathroom Mode"}. */
export function splitIcon(label: string): { icon?: string; label: string } {
  const m = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s+(.+)$/u.exec(label);
  return m === null ? { label } : { icon: m[1]!, label: m[2]! };
}

/** The guest's Start menu, top to bottom (pure — `test/start-menu.test.tsx`):
 *  the story's own buttons first (they are what a guest comes here for),
 *  then people and help, the phone's settings, switching sides, and Leave
 *  last, behind its confirmation. An `arm: true` button arms, then fires,
 *  through core's arm model (`chrome/start-menu.tsx`). */
export function guestStartItems(o: GuestStartInput): StartItem[] {
  const items: StartItem[] = o.interactions.map((i) => ({
    id: `act:${i.id}`,
    ...splitIcon(i.label),
    onClick: () => o.open.act(i),
    ...(i.arm === true ? { arm: true } : {}),
  }));
  if (o.people) items.push({ id: "people", label: "People", icon: <Icon name="people" />, onClick: o.open.people });
  items.push({ id: "help", label: "Help", icon: <Icon name="help" />, onClick: o.open.help });
  items.push({ id: "picture", label: "Change your picture", icon: <Icon name="picture" />, onClick: o.open.picture });
  if (o.wake !== null && o.wake.supported) {
    items.push({ id: "wake", label: o.wake.on ? "Screen stays on — tap to allow sleep" : "Keep my screen on", icon: <Icon name={o.wake.on ? "screen-on" : "screen-off"} />, onClick: o.open.wake });
  }
  if (o.push) items.push({ id: "alerts", label: "Get alerts", icon: <Icon name="bell" />, onClick: o.open.alerts });
  if (o.faction !== null) {
    for (const to of o.defectTo) items.push({ id: `defect:${to}`, label: `Leave ${withThe(o.faction)} for ${withThe(to)}`, icon: <Icon name="defect" />, onClick: () => o.open.defect(to), confirm: `Switch to ${withThe(to)}?` });
  }
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

/** 🎟 Pass (the guest's main button) and 📷 Scan, lit when the current
 *  objective names them. */
export function guestTaskbarButtons(o: { now: ObjectiveView | null; pass: () => void; scan: () => void }): TaskbarButton[] {
  const wants = new Set(o.now?.buttons ?? []);
  return [
    { id: "pass", label: "Pass", icon: <Icon name="pass" />, onClick: o.pass, primary: true, tour: "pass", title: "Show your pass", active: wants.has("pass") },
    { id: "scan", label: "Scan", icon: <Icon name="scan" />, onClick: o.scan, labelled: true, tour: "scan", title: "Scan a code on the wall", active: wants.has("scan") },
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
    <TrayBalloon title={`🔔 ${ios?.head ?? "Get alerts"}`} onClose={push.dismiss} timeoutMs={null} closeOnTapAway={false} label="Get alerts" floating>
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
    <Sheet title="🔔 Alerts" onClose={onClose}>
      <PushRow push={push} title={title} />
    </Sheet>
  );
}

/** The NOW sheet's button for an objective's `buttons:` id (pure over its
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
        <button type="button" className="choice primary" onClick={onPass}>
          🎟 Show my pass
        </button>
      );
    if (id === "scan")
      return (
        <button type="button" className="choice primary" onClick={onScan}>
          📷 Scan a code
        </button>
      );
    const i = interactions.find((x) => x.id === id);
    if (i === undefined) return null;
    return (
      <button
        type="button"
        className={`choice${arm.armed === i.id ? " armed" : ""}`}
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

/** ▣ What to do now: every live objective, the first one open, each with
 *  the buttons it names (≤ 3) — the pass, the scanner, the story's own. */
export function ObjectiveSheet({
  objectives,
  interactions,
  onPass,
  onScan,
  onAct,
  onClose,
}: {
  objectives: readonly ObjectiveView[];
  interactions: readonly Interaction[];
  onPass: () => void;
  onScan: () => void;
  onAct: (i: Interaction) => void;
  onClose: () => void;
}) {
  const arm = useArmButtons();
  const button = objectiveButton({ interactions, arm, onPass, onScan, onAct });
  return (
    <Sheet title="▣ What to do now" onClose={onClose} tall>
      <div className="objective-stack">
        {objectives.map((o, n) => (
          <ObjectiveCard key={o.id} objective={o} compact={n > 0} renderButton={button} />
        ))}
      </div>
    </Sheet>
  );
}
