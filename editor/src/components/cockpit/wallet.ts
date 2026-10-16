//! The Wallet card's rules (Run page, wave 5 E2) — pure, so they test
//! without React. The card reads `CockpitState.wallet` (`ModView.wallet`,
//! the server's `WalletBook.modView()`): which buttons an open transfer
//! gets (the server's `checkApprove` / `checkDeny` / `checkCancel`, so a
//! button never offers what the route would refuse), the countdowns off
//! the story clock, and the balances off the roster.

import type { WalletCard } from '@loom/core/sim'
import type { WalletModView, WalletTxView } from '@loom/core/views'
import { WalletAction, type RosterRow, type StoryClock, type WorldEntry } from '@/store/cockpit'

/** The director's buttons on one open transfer: a held one can be approved,
 *  denied or cancelled; a pending one (inside its deny window) denied or
 *  cancelled — it settles on its own, so there is nothing to approve. */
export function txActions(t: Pick<WalletTxView, 'state'>): WalletAction[] {
  if (t.state === 'held') return [WalletAction.Approve, WalletAction.Deny, WalletAction.Cancel]
  if (t.state === 'pending') return [WalletAction.Deny, WalletAction.Cancel]
  return []
}

/** A request is cancellable while it is open (not once its payer is paying). */
export function requestCancellable(state: string): boolean {
  return state === 'open'
}

/** Held transfers, oldest first — what "Approve all held" clears. */
export function heldTransfers(view: WalletModView | null): WalletTxView[] {
  return (view?.open.transfers ?? []).filter((t) => t.state === 'held')
}

/** The story clock now: the last snapshot's reading plus the wall time since
 *  — unless the run is paused, when the story clock stands still. */
export function storyNow(clock: StoryClock | null, running: boolean, wallNow: number): number | null {
  if (clock === null) return null
  return running ? clock.ms + Math.max(0, wallNow - clock.at) : clock.ms
}

/** `m:ss` until a story-clock deadline (`0:00` once it's due); null when
 *  either side is unknown. */
export function countdown(deadline: number | null | undefined, now: number | null): string | null {
  if (deadline === null || deadline === undefined || now === null) return null
  const s = Math.max(0, Math.ceil((deadline - now) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** What a transfer's deadline means, for the countdown's label. */
export function deadlineLabel(state: string): string {
  return state === 'held' ? 'auto-approves in' : state === 'pending' ? 'settles in' : 'due in'
}

export interface WalletBalance {
  id: string
  name: string
  balance: number
}

/** Every guest's balance (the currency's slot — `score` is the roster's own
 *  column, any other slot is read off the world as `<id>.<slot>`), richest
 *  first, then by name. */
export function walletBalances(roster: RosterRow[], world: WorldEntry[], slot: string): WalletBalance[] {
  const byPath = slot === 'score' ? null : new Map(world.map((w) => [w.path, w.value]))
  return roster
    .map((r) => {
      let balance = r.score
      if (byPath !== null) {
        const n = Number(byPath.get(`${r.id}.${slot}`))
        balance = Number.isFinite(n) ? n : 0
      }
      return { id: r.id, name: r.name, balance }
    })
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name))
}

/** One freeze in force (`ModView.wallet.frozen`, the minter's 🧊). */
export type WalletFreeze = NonNullable<WalletModView['frozen']>[number]

/** The freezes still in force at `now`, soonest thaw first (an old server
 *  sends no list; one past its deadline is about to be swept). */
export function freezesInForce(view: WalletModView | null, now: number | null): WalletFreeze[] {
  return (view?.frozen ?? []).filter((f) => now === null || f.until > now).sort((a, b) => a.until - b.until)
}

/** Who imposed a freeze, for the Frozen row: the roster's name for a
 *  person id (the minter's guest freezes from her phone, and the book
 *  records her id), else the id as written (`Director`). */
export function freezeByName(f: Pick<WalletFreeze, 'by'>, roster: Pick<RosterRow, 'id' | 'name'>[]): string {
  return roster.find((r) => r.id === f.by)?.name ?? f.by.replace(/_/g, ' ')
}

/** A stimulus amount typed into the box: a whole number ≥ 1, else null (the
 *  server checks the currency's `max`). */
export function stimulusAmount(text: string): number | null {
  const n = Number(text.trim())
  return Number.isInteger(n) && n >= 1 ? n : null
}

/** The compact tag a Wallet-room card shows in the cockpit chat: what it is,
 *  where it stands, who pays whom and how much (the card's own text is
 *  written from its owner's side, "You sent…", so the tag names both). */
export function walletCardTag(card: WalletCard): string {
  const parties = card.kind === 'stimulus' ? card.fromName : `${card.fromName} → ${card.toName}`
  const entry = card.kind === 'offer' ? ` · “${card.entryTitle ?? card.entry ?? 'a fact'}”` : ''
  // A freeze moves no coin: its card carries amount 0.
  if (card.kind === 'freeze') return `🧊 freeze · ${card.step} · ${parties}`
  return `💰 ${card.kind} · ${card.step} · ${parties} · ${card.amount} ${card.unit}${entry}`
}
