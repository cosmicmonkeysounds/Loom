//! The wallet's sheets (send / request / offer / stimulus / grant /
//! freeze), moved out of `wallet.tsx` so the guest's first load never
//! carries them: a phone opens one rarely, and `wallet-sheets-lazy.tsx`
//! fetches this module then (recheck: the first-load gate).

import { useState } from "react";
import { PickerSheet, Sheet, type PickItem } from "./ui/primitives.tsx";
import type { WalletView } from "./types.ts";
import { mmss, parseAmount, secondsLeft } from "./wallet.tsx";

// --- the sheets -----------------------------------------------------------------------------

export interface WalletPerson {
  id: string;
  name: string;
  /** Wave 18b: their badges (🚻 Bathroom Mode), shown beside the name. */
  badges?: ReadonlyArray<{ glyph: string; label: string }>;
}

function AmountField({ max, unit, onSubmit, verb }: { max: number; unit: string; onSubmit: (n: number) => void; verb: string }) {
  const [text, setText] = useState("");
  const n = parseAmount(text, max);
  return (
    <form
      className="wallet-amount-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (n !== null) onSubmit(n);
      }}
    >
      <label className="wallet-amount-label">
        Amount
        <input
          className="wallet-amount-input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder={`1–${max}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <span className="muted"> {unit}</span>
      </label>
      {text !== "" && n === null && <div className="muted wallet-hint">A whole number from 1 to {max}.</div>}
      <button className="choice primary" type="submit" disabled={n === null}>
        {verb}
      </button>
    </form>
  );
}

/** Pick a person, then an amount. `mode: "send"` = "Send 50 Truthcoin to
 *  Winamp"; `mode: "request"` = "Ask Winamp for 50 Truthcoin"; `mode:
 *  "grant"` = the minter's "Grant Winamp 50 Truthcoin" from the reserve. */
export function PeopleAmountSheet({
  mode,
  view,
  people,
  onDone,
  onClose,
}: {
  mode: "send" | "request" | "grant";
  view: WalletView;
  people: WalletPerson[];
  onDone: (personId: string, amount: number) => void;
  onClose: () => void;
}) {
  const [who, setWho] = useState<WalletPerson | null>(null);
  const grants = view.minter?.grants;
  const grantsLeft = grants === undefined ? 0 : grants.limit - grants.uses;
  if (mode === "grant" && grantsLeft < 1) {
    return (
      <Sheet title="🎁 Grant" onClose={onClose}>
        <div className="muted pad">No grants left tonight.</div>
      </Sheet>
    );
  }
  if (who === null) {
    const items: PickItem[] = people.map((p) => ({ id: p.id, label: p.name, avatar: true, ...(p.badges !== undefined && p.badges.length > 0 ? { badges: p.badges } : {}) }));
    return (
      <PickerSheet
        title={mode === "send" ? "Send to…" : mode === "grant" ? "🎁 Grant to…" : "Ask…"}
        items={items}
        empty="Nobody else is here yet."
        keepOpen
        onPick={(id) => {
          const p = people.find((x) => x.id === id);
          if (p) setWho(p);
        }}
        onClose={onClose}
      />
    );
  }
  const max = mode === "send" ? Math.min(view.maxTransfer, view.balance) : view.maxTransfer;
  const title = mode === "send" ? `Send ${view.name} to ${who.name}` : mode === "grant" ? `🎁 Grant ${who.name} ${view.name}` : `Ask ${who.name} for ${view.name}`;
  const hint =
    mode === "send"
      ? `You have ${view.balance} ${view.name}.`
      : mode === "grant"
        ? `Minted from the reserve — nothing leaves your balance. ${grantsLeft} ${grantsLeft === 1 ? "grant" : "grants"} left tonight.`
        : `They will see a card with Pay / Decline. It expires if nobody answers.`;
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="muted pad">{hint}</div>
      {max < 1 ? (
        <div className="muted pad">You have nothing to send.</div>
      ) : (
        <AmountField
          max={max}
          unit={view.name}
          verb={mode === "send" ? `Send to ${who.name}` : mode === "grant" ? `Grant ${who.name}` : `Ask ${who.name}`}
          onSubmit={(n) => {
            onDone(who.id, n);
            onClose();
          }}
        />
      )}
    </Sheet>
  );
}

export interface WalletEntry {
  id: string;
  title: string;
}

/** The entry an offer posts and the title the sheet shows: a sale posts
 *  the held entry's id (a title often differs from its id, and the server
 *  resolves ids); a buy posts the typed title as typed. */
export interface OfferChoice {
  entry: string;
  title: string;
}
export function sellChoice(e: WalletEntry): OfferChoice {
  return { entry: e.id, title: e.title };
}
export function buyChoice(typed: string): OfferChoice {
  return { entry: typed.trim(), title: typed.trim() };
}

/** Trade a fact: sell one you hold, or buy one by title (resolved on the
 *  server), to a counterparty, for an amount. A frozen viewer can only
 *  sell (a buy moves their coin out). */
export function OfferSheet({
  view,
  people,
  codex,
  onDone,
  onClose,
  frozen = false,
}: {
  view: WalletView;
  people: WalletPerson[];
  codex: WalletEntry[];
  onDone: (personId: string, entry: string, side: "buy" | "sell", amount: number) => void;
  onClose: () => void;
  frozen?: boolean;
}) {
  const [side, setSide] = useState<"buy" | "sell">("sell");
  // `typed` is the buy box; `choice` is what the offer will post + show.
  const [typed, setTyped] = useState<string>("");
  const [choice, setChoice] = useState<OfferChoice>({ entry: "", title: "" });
  const [who, setWho] = useState<WalletPerson | null>(null);
  const [stage, setStage] = useState<"entry" | "who" | "amount">("entry");
  if (stage === "who") {
    return (
      <PickerSheet
        title={side === "sell" ? "Offer it to…" : "Buy it from…"}
        items={people.map((p) => ({ id: p.id, label: p.name, avatar: true }))}
        empty="Nobody else is here yet."
        keepOpen
        onPick={(id) => {
          const p = people.find((x) => x.id === id);
          if (p) {
            setWho(p);
            setStage("amount");
          }
        }}
        onClose={onClose}
      />
    );
  }
  if (stage === "amount" && who !== null) {
    const max = side === "buy" ? Math.min(view.maxTransfer, view.balance) : view.maxTransfer;
    return (
      <Sheet title={side === "sell" ? `Sell “${choice.title}” to ${who.name}` : `Buy “${choice.title}” from ${who.name}`} onClose={onClose}>
        <div className="muted pad">{side === "sell" ? `${who.name} pays you when they accept.` : `Your ${view.name} is held until ${who.name} answers.`}</div>
        {max < 1 ? (
          <div className="muted pad">You have nothing to offer.</div>
        ) : (
          <AmountField
            max={max}
            unit={view.name}
            verb={side === "sell" ? "Offer it" : "Offer to buy"}
            onSubmit={(n) => {
              onDone(who.id, choice.entry, side, n);
              onClose();
            }}
          />
        )}
      </Sheet>
    );
  }
  return (
    <Sheet title="Trade a fact" onClose={onClose} tall={codex.length > 6}>
      <div className="wallet-side">
        <button className={`choice ${side === "sell" ? "primary" : "ghost"}`} onClick={() => setSide("sell")}>
          Sell one I hold
        </button>
        <button className={`choice ${side === "buy" ? "primary" : "ghost"}`} onClick={() => setSide("buy")} disabled={frozen}>
          Buy one by title
        </button>
      </div>
      {frozen && <div className="muted pad">🧊 Your {view.name} is frozen — you can sell, not buy, until it thaws.</div>}
      {side === "sell" ? (
        codex.length === 0 ? (
          <div className="muted pad">You hold no entries to sell.</div>
        ) : (
          codex.map((e) => (
            <button
              key={e.id}
              className="choice ghost pick"
              onClick={() => {
                setChoice(sellChoice(e));
                setStage("who");
              }}
            >
              <span className="pick-label">{e.title}</span>
            </button>
          ))
        )
      ) : (
        <form
          className="wallet-amount-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim() !== "") {
              setChoice(buyChoice(typed));
              setStage("who");
            }
          }}
        >
          <label className="wallet-amount-label">
            The entry's title
            <input className="wallet-entry-input" type="text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Exactly as it is titled" autoFocus />
          </label>
          <button className="choice primary" type="submit" disabled={typed.trim() === ""}>
            Next
          </button>
        </form>
      )}
    </Sheet>
  );
}

/** The minter's stimulus: an amount every eligible program receives. */
export function StimulusSheet({ view, onDone, onClose }: { view: WalletView; onDone: (amount: number) => void; onClose: () => void }) {
  const left = view.minter ? view.minter.limit - view.minter.uses : 0;
  return (
    <Sheet title="💰 Stimulus" onClose={onClose}>
      <div className="muted pad">
        {left > 0 ? `Pays every eligible program the same amount, minted from nothing. ${left} ${left === 1 ? "use" : "uses"} left tonight.` : "No stimulus left tonight."}
      </div>
      {left > 0 && (
        <AmountField
          max={view.maxTransfer}
          unit={view.name}
          verb="Pay everyone"
          onSubmit={(n) => {
            onDone(n);
            onClose();
          }}
        />
      )}
    </Sheet>
  );
}

/** The minter's 🧊 Freeze: pick a program, then confirm. Someone already
 *  frozen shows their thaw countdown and can't be frozen again. */
export function FreezeSheet({
  view,
  people,
  clock,
  onDone,
  onClose,
}: {
  view: WalletView;
  people: WalletPerson[];
  clock: number;
  onDone: (personId: string) => void;
  onClose: () => void;
}) {
  const [who, setWho] = useState<WalletPerson | null>(null);
  const frozen = view.minter?.frozen ?? [];
  const thaws = (id: string): string | null => {
    const f = frozen.find((x) => x.target === id);
    return f === undefined ? null : `🧊 thaws in ${mmss(secondsLeft(f.until, clock))}`;
  };
  const mins = Math.max(1, Math.round((view.minter?.freezeMs ?? 600_000) / 60_000));
  if (who === null) {
    const items: PickItem[] = people.map((p) => {
      const sub = thaws(p.id);
      return { id: p.id, label: p.name, avatar: true, ...(sub !== null ? { sub } : {}) };
    });
    return (
      <PickerSheet
        title="🧊 Freeze whose coin?"
        items={items}
        empty="Nobody else is here yet."
        keepOpen
        onPick={(id) => {
          const p = people.find((x) => x.id === id);
          if (p) setWho(p);
        }}
        onClose={onClose}
      />
    );
  }
  const already = thaws(who.id);
  return (
    <Sheet title={`🧊 Freeze ${who.name}`} onClose={onClose}>
      <div className="muted pad">
        {already !== null ? `${who.name} is already frozen (${already.replace("🧊 ", "")}).` : `For ${mins} min ${who.name} can't send, pay or buy with ${view.name}. Coin still comes in.`}
      </div>
      {already === null && (
        <button
          className="choice primary"
          onClick={() => {
            onDone(who.id);
            onClose();
          }}
        >
          Freeze for {mins} min
        </button>
      )}
    </Sheet>
  );
}

