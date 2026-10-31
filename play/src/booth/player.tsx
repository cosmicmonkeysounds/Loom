//! A player's booth frame pieces (wave 21, CONTRACT P1–P2, P6): the Mission
//! window (the guest's own `MissionWindow`, fed by `boothMissionOf`, whose
//! big buttons are actions — a picker, a target's card, a global press, the
//! scanner captioned for the press), the Chats window (the guest's
//! `ChatsWindow` over `playerChats`) and the taskbar's three windows.
//! `booth/app.tsx` lays them out in the guest frame's shape.

import type { ReactElement } from "react";
import { ARM_LINE, useArmButtons } from "../arm.ts";
import { Icon } from "../chrome/icons.tsx";
import type { TaskbarButton } from "../chrome/taskbar.tsx";
import { MissionWindow } from "../guest/mission.tsx";
import type { Nav } from "../moments/exits.ts";
import type { PrimeView } from "../types.ts";
import { boothActionOf, boothMissionOf, type BoothAction, type BoothMissionCtx } from "./mission-model.ts";
import { armsFirst } from "./model.ts";

/** What a player's Mission can open (the booth binds them). */
export interface PlayerOpeners {
  scan: (caption?: string) => void;
  pick: (objective: string) => void;
  card: (guest: string) => void;
  global: (id: string) => void;
  go: (nav: Nav) => void;
}

/** A big button's words: the story button's label; `scan` reads SCAN A PASS. */
function bigLabel(a: BoothAction, label: string): string {
  return a.kind === "scan" ? "SCAN A PASS" : label;
}

export function PlayerMission({ view, ctx, open }: { view: PrimeView; ctx: BoothMissionCtx; open: PlayerOpeners }) {
  const arm = useArmButtons();
  const model = boothMissionOf(view, ctx);
  const interactions = view.interactions ?? [];
  const renderButton = (id: string): ReactElement | null => {
    const a = boothActionOf(id, view);
    if (a === null) return null;
    const i = interactions.find((x) => x.id === id);
    const label = bigLabel(a, i?.label ?? id);
    const run = () => {
      switch (a.kind) {
        case "scan":
          return open.scan();
        case "pick":
          return open.pick(a.objective);
        case "target":
          return open.card(a.guest);
        case "global":
          return open.global(a.id);
        case "scanFor":
          return open.scan(a.caption);
      }
    };
    // Only a global press fires from here, so only it arms (a harm or `arm: true`).
    const arms = a.kind === "global" && i !== undefined && armsFirst(i);
    const armed = arm.armed === id;
    return (
      <button
        type="button"
        className={`choice mission-big${a.kind === "scan" ? " primary objective-go" : ""}${armed ? " armed" : ""}`}
        title={i?.description ?? undefined}
        aria-pressed={armed || undefined}
        onClick={() => arm.tap(id, arms, run)}
      >
        {a.kind === "scan" && <Icon name="scan" size={20} />} {label}
        {a.kind !== "global" && a.kind !== "scan" && <span aria-hidden> ›</span>}
        {armed && <span className="arm-line">{ARM_LINE}</span>}
      </button>
    );
  };
  return (
    <MissionWindow
      model={model}
      countdowns={view.countdowns}
      clock={view.clock}
      stamp={view}
      captured={false}
      onGo={open.go}
      renderButton={renderButton}
      onInvite={() => {}}
      peopleHere={0}
      onPeople={() => {}}
    />
  );
}

export interface PlayerTaskbarInput {
  pressed: "mission" | "chats" | null;
  chatsDot: boolean;
  scanOpen: boolean;
  mission: () => void;
  chats: () => void;
  scan: () => void;
}

/** A player's taskbar windows (P1): ▣ Mission · 💬 Chats · 📷 Scan (the primary). No Guests. */
export function playerTaskbarButtons(o: PlayerTaskbarInput): TaskbarButton[] {
  return [
    { id: "mission", label: "Mission", icon: <Icon name="mission" size={20} />, onClick: o.mission, stacked: true, tour: "mission", title: "What to do now", pressed: o.pressed === "mission" },
    { id: "chats", label: "Chats", icon: <Icon name="reply" size={20} />, onClick: o.chats, stacked: true, tour: "chats", title: "Notes, messages and rooms", pressed: o.pressed === "chats", dot: o.chatsDot },
    // The title: DRAFT w58.
    { id: "scan", label: "Scan", icon: <Icon name="scan" size={20} />, onClick: o.scan, primary: true, stacked: true, tour: "scan", title: "Scan a pass or a codex QR", active: o.scanOpen },
  ];
}
