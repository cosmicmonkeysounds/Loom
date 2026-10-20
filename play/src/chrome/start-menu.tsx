//! The ⊞ Start menu (wave 13): the list that rises out of the taskbar's
//! Start button — who you are on its banner, then the role's items. Two
//! kinds of item ask before they act, each in its own way:
//!
//! - `confirm` (Leave, switching sides): the item turns into a question in
//!   place, with a button that says the item's own words and a Cancel.
//! - `arm` (a story button marked `arm: true`): core's arm model, the one the
//!   pass sheet, the NOW sheet and the director's phone use (`../arm.ts`) —
//!   the first tap arms it (black, "Tap again to fire"), a second tap on the
//!   same item ≥ 300 ms and < 4 s later fires, and it disarms itself after
//!   4 s, when the page is left, or when the menu closes.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ARM_LINE, useArmButtons } from "../arm.ts";

export interface StartItem {
  id: string;
  label: string;
  icon?: string;
  onClick: () => void;
  danger?: boolean;
  /** Ask first ("Leave the event?") — the menu confirms in place. */
  confirm?: string;
  /** Arm, then fire (a story button's `arm: true`), through core's arm model. */
  arm?: boolean;
}

/** The Start menu's next state after a tap on `item` while `asking` holds
 *  the item awaiting its confirmation (pure — `test/start-menu.test.tsx`):
 *  an item with a `confirm` asks first; a second tap on the same item fires
 *  it; anything else fires at once. (An `arm` item never comes here: it
 *  goes through the arm model, see `startPress`.) */
export function startTap(asking: string | null, item: Pick<StartItem, "id" | "confirm">): { asking: string | null; fire: boolean } {
  if (item.confirm !== undefined && asking !== item.id) return { asking: item.id, fire: false };
  return { asking: null, fire: true };
}

/** Which way a tap on `item` goes (pure): the arm model, the in-place
 *  question, or straight through. `arm` wins over `confirm`. */
export function startPress(item: Pick<StartItem, "confirm" | "arm">): "arm" | "confirm" | "fire" {
  if (item.arm === true) return "arm";
  return item.confirm !== undefined ? "confirm" : "fire";
}

/** One row of the menu (exported for `test/start-menu.test.tsx`): the item,
 *  armed-looking while armed, or its question while it asks. */
export function StartMenuRow({ item, armed, asking, onPick, onCancel }: { item: StartItem; armed: boolean; asking: boolean; onPick: () => void; onCancel: () => void }) {
  if (asking && item.confirm !== undefined) {
    return (
      <div className="start-menu-confirm" role="group" aria-label={item.confirm}>
        <span className="start-menu-ask">{item.confirm}</span>
        <div className="start-menu-confirm-row">
          <button type="button" role="menuitem" className={`w95-btn${item.danger ? " danger" : ""}`} onClick={onPick}>
            {item.label}
          </button>
          <button type="button" className="w95-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      className={`start-menu-item${item.danger ? " danger" : ""}${armed ? " armed" : ""}`}
      aria-pressed={item.arm === true ? armed : undefined}
      onClick={onPick}
    >
      <span className="start-menu-icon" aria-hidden>
        {item.icon ?? ""}
      </span>
      <span className="start-menu-label">
        {item.label}
        {armed && <span className="arm-line">{ARM_LINE}</span>}
      </span>
    </button>
  );
}

/** The open menu. Mounted only while open, so its question and its armed
 *  item never outlive it. */
export function StartMenu({
  items,
  header,
  brand,
  onClose,
}: {
  items: StartItem[];
  header?: ReactNode;
  brand?: string;
  /** Close the menu (an item fired). */
  onClose: () => void;
}) {
  const [asking, setAsking] = useState<string | null>(null);
  const arm = useArmButtons();
  const box = useRef<HTMLDivElement>(null);
  // Opened: focus the first item.
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, []);
  const fire = (it: StartItem) => {
    onClose();
    it.onClick();
  };
  const pick = (it: StartItem) => {
    switch (startPress(it)) {
      case "arm":
        setAsking(null);
        return arm.tap(it.id, true, () => fire(it));
      case "confirm": {
        const next = startTap(asking, it);
        if (!next.fire) return setAsking(next.asking);
        return fire(it);
      }
      default:
        return fire(it);
    }
  };
  return (
    <div ref={box} className="start-menu" role="menu" aria-label="Start">
      {brand !== undefined && (
        <div className="start-menu-band" aria-hidden>
          <span>{brand}</span>
        </div>
      )}
      <div className="start-menu-items">
        {header !== undefined && <div className="start-menu-head">{header}</div>}
        {items.map((it) => (
          <StartMenuRow key={it.id} item={it} armed={arm.armed === it.id} asking={asking === it.id} onPick={() => pick(it)} onCancel={() => setAsking(null)} />
        ))}
      </div>
    </div>
  );
}
