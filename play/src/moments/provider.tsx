//! The moments layer (wave 13; the moments lane owns it): one queue of the
//! story's moments, rendered by the interrupt ladder (balloon / sticky /
//! dialog / bsod), the missed count, the busy-surface hold. Mounted in both
//! apps by plumbing in Stage A, behaviour-identical to before: the layer is
//! the old alert banner, nothing is missed, and a hold does nothing.

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_ALERT_LEVEL } from "../../../core/src/delivery.ts";
import type { Alerts } from "../alerts.ts";
import type { AlertLevel, ChatMessage, ObjectiveView } from "../types.ts";
import { AlertBanner } from "./banner.tsx";

export interface MomentsInput {
  role: "guest" | "booth";
  /** Guest id, or the booth's character. */
  me: string;
  /** The sign-in token (keys persisted marks); null when signed out. */
  session: string | null;
  messages: ReadonlyMap<number, ChatMessage>;
  /** The session's `useAlerts` result, whole. Its `alert` / `dismiss` are
   *  the quiet feedback toast (the moments lane may add fields to `Alerts`). */
  alerts: Alerts;
  alertLevel: AlertLevel | undefined;
  objectives: readonly ObjectiveView[] | undefined;
  /** `view.night.phase` (staleness). */
  phase: string | null | undefined;
  clock: number | undefined;
  /** "Take me there". */
  openRoom: (channelId: string) => void;
  /** Booth filter (`boothAlertFilter(character)`); guests pass none. */
  filter?: (m: ChatMessage) => boolean;
  sound: boolean;
}

const MomentsContext = createContext<MomentsInput | null>(null);

export function MomentsProvider(p: MomentsInput & { children: ReactNode }) {
  const { children, ...input } = p;
  return <MomentsContext.Provider value={input}>{children}</MomentsContext.Provider>;
}

/** The overlay (balloon / sticky / dialog / bsod + the toast + the glitch).
 *  Stage A: the alert banner, exactly as the apps rendered it. */
export function MomentsLayer() {
  const input = useContext(MomentsContext);
  if (input === null || input.alerts.alert === null) return null;
  return <AlertBanner text={input.alerts.alert.text} onDismiss={input.alerts.dismiss} />;
}

export function useMoments(): { missed: number; replay: () => void; level: AlertLevel } {
  const input = useContext(MomentsContext);
  return { missed: 0, replay: () => {}, level: input?.alertLevel ?? DEFAULT_ALERT_LEVEL };
}

/** The tray's missed-moments item; null when none. Stage A: always null. */
export function MissedTray() {
  return null;
}

/** A busy surface (the scanner, a guest card, the host drawer, the
 *  full-screen pass, the scan sheet) calls this while open: no `dialog` /
 *  `bsod` shows while any hold is active. Stage A: a no-op. */
export function useMomentsHold(_active: boolean): void {}
