//! The Wallet card on the Run page (wave 5 E2): the director's hand on the
//! story's currency when the approver's booth or the minter's phone is
//! away. The header names the currency, approver and minter, with the
//! stimulus count and **Pay stimulus**; then every open transfer with
//! Approve / Deny / Cancel as the server allows them and a countdown off
//! the story clock (a held one approves itself after five minutes), open
//! requests and offers with Cancel, **Approve all held**, the minter's
//! freezes in force with **Lift** (her reserve grants are counted in the
//! header), and the balances.
//! Everything goes through `CockpitState.walletAct` → `/api/mod/wallet/*`,
//! journaled `by` the director. Rules in pure `cockpit/wallet.ts`.

import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { CockpitPhase, WalletAction, storyNow, useCockpit } from '@/store/cockpit'
import { confirmAction } from '@/store/dialog'
import {
  countdown,
  deadlineLabel,
  freezeByName,
  freezesInForce,
  heldTransfers,
  requestCancellable,
  stimulusAmount,
  txActions,
  walletBalances,
} from '@/components/cockpit/wallet'

const btn = 'rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40'
const ACTION_LABEL: Record<string, string> = { approve: '✓ Approve', deny: '⛔ Deny', cancel: '↩ Cancel' }

const shown = (id: string | null): string => (id === null ? '—' : id.replace(/_/g, ' '))

/** The local backend's note: there is no WalletBook in the browser. */
export function WalletLocalNote() {
  return (
    <p className="mt-2 text-xs text-zinc-500" data-testid="run-wallet-local">
      🪙 A story's wallet (<span className="font-mono">currency:</span>) runs on the event server — rehearse it on a server project.
    </p>
  )
}

export function WalletCard() {
  const wallet = useCockpit((s) => s.wallet)
  const clock = useCockpit((s) => s.storyClock)
  const running = useCockpit((s) => s.phase === CockpitPhase.Open)
  const roster = useCockpit((s) => s.roster)
  const world = useCockpit((s) => s.world)
  const walletAct = useCockpit((s) => s.walletAct)
  const [busy, setBusy] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [wall, setWall] = useState(() => Date.now())
  const open = wallet?.open
  const hasDeadlines = open !== undefined && open.transfers.length + open.requests.length + open.offers.length + (wallet?.frozen?.length ?? 0) > 0
  // Tick the countdowns between snapshots (they come at most twice a second,
  // and not at all while nothing changes).
  useEffect(() => {
    if (!hasDeadlines) return
    const t = setInterval(() => setWall(Date.now()), 1000)
    return () => clearInterval(t)
  }, [hasDeadlines])
  const balances = useMemo(() => (wallet === null ? [] : walletBalances(roster, world, wallet.slot)), [wallet, roster, world])
  if (wallet === null) return null

  const now = storyNow(clock, running, wall)
  const held = heldTransfers(wallet)
  const frozen = freezesInForce(wallet, now)
  const left = Math.max(0, wallet.stimulus.limit - wallet.stimulus.uses)
  const minterName = wallet.minterPerson !== null ? (roster.find((r) => r.id === wallet.minterPerson)?.name ?? wallet.minterPerson) : null
  const act = async (key: string, action: WalletAction, arg?: string | number) => {
    if (busy !== null) return
    setBusy(key)
    try {
      await walletAct(action, arg)
    } finally {
      setBusy(null)
    }
  }
  const payStimulus = async () => {
    const n = stimulusAmount(amount)
    if (n === null) return
    const ok = await confirmAction({
      title: `Pay a ${n} ${wallet.name} stimulus?`,
      body: `Every eligible program receives ${n} ${wallet.name}. It uses one of the minter's ${wallet.stimulus.limit} (${left} left).`,
      confirmLabel: 'Pay stimulus',
    })
    if (ok) await act('stimulus', WalletAction.Stimulus, n)
    if (ok) setAmount('')
  }
  const lift = async (id: string, name: string) => {
    const ok = await confirmAction({
      title: `Lift the freeze on ${name}?`,
      body: `${name}'s ${wallet.name} moves again at once, and their phone says you lifted it.`,
      confirmLabel: 'Lift the freeze',
    })
    if (ok) await act(`${id}:unfreeze`, WalletAction.Unfreeze, id)
  }
  const approveHeld = async () => {
    const ok = await confirmAction({
      title: `Approve ${held.length} held transfer${held.length === 1 ? '' : 's'}?`,
      body: `Each goes through as approved by you, as if ${shown(wallet.approver)} had pressed Approve.`,
      confirmLabel: 'Approve all held',
    })
    if (ok) await act('held', WalletAction.ApproveHeld)
  }
  const { transfers, requests, offers } = wallet.open

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-3" data-testid="run-wallet">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500">Wallet · 🪙 {wallet.name}</span>
        <span className="text-xs text-zinc-500">
          approver <span className="text-zinc-300">{shown(wallet.approver)}</span> · minter <span className="text-zinc-300">{shown(wallet.minter)}</span>
          {minterName !== null && <span className="text-zinc-600"> ({minterName})</span>}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-xs">
          <span className={clsx(left === 0 ? 'text-zinc-600' : 'text-zinc-400')} data-testid="run-wallet-stimulus-count">
            stimulus {wallet.stimulus.uses}/{wallet.stimulus.limit} used
          </span>
          {wallet.grants !== undefined && (
            <span className="text-zinc-500" data-testid="run-wallet-grant-count">
              · 🎁 grants {wallet.grants.uses}/{wallet.grants.limit}
            </span>
          )}
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="numeric"
            placeholder="amount"
            className="w-16 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
            data-testid="run-wallet-stimulus-amount"
          />
          <button
            className={btn}
            disabled={busy !== null || left === 0 || stimulusAmount(amount) === null}
            onClick={() => void payStimulus()}
            title={left === 0 ? 'No stimulus left' : 'Pay every eligible program (when the minter’s phone is gone)'}
            data-testid="run-wallet-stimulus"
          >
            💰 Pay stimulus
          </button>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-400">Open transfers</span>
        {held.length > 0 && (
          <button className={clsx(btn, 'ml-auto border-amber-700 text-amber-200')} disabled={busy !== null} onClick={() => void approveHeld()} data-testid="run-wallet-approve-held">
            ✓ Approve all held ({held.length})
          </button>
        )}
      </div>
      {transfers.length === 0 ? (
        <p className="text-xs text-zinc-600">Nothing waiting — every transfer has settled.</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1" data-testid="run-wallet-transfers">
          {transfers.map((t) => {
            const due = countdown(t.settleAt, now)
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-2 rounded border border-zinc-800 px-2 py-1 text-xs" data-testid="run-wallet-transfer" data-state={t.state}>
                <span className="text-zinc-100">
                  {t.fromName} → {t.toName}
                </span>
                <span className="tabular-nums text-zinc-300">
                  {t.amount} {wallet.name}
                </span>
                <span
                  className={clsx('rounded px-1', t.state === 'held' ? 'bg-amber-950/60 text-amber-200' : 'text-zinc-500')}
                  title={t.state === 'held' ? 'Flagged by the approver’s audit: both phones show it held until it is approved, denied, or approves itself' : undefined}
                >
                  {t.state === 'held' ? '🚩 held' : t.state}
                </span>
                {due !== null && (
                  <span className="tabular-nums text-zinc-500">
                    {deadlineLabel(t.state)} {due}
                  </span>
                )}
                <span className="ml-auto inline-flex gap-1">
                  {txActions(t).map((a) => (
                    <button key={a} className={btn} disabled={busy !== null} onClick={() => void act(`${t.id}:${a}`, a, t.id)} data-testid={`run-wallet-${a}`}>
                      {ACTION_LABEL[a]}
                    </button>
                  ))}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {frozen.length > 0 && (
        <>
          <div className="mt-3 text-xs text-zinc-400">Frozen</div>
          <ul className="mt-1 flex flex-col gap-1" data-testid="run-wallet-frozen">
            {frozen.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 rounded border border-zinc-800 px-2 py-1 text-xs">
                <span className="text-zinc-100">🧊 {f.targetName}</span>
                <span className="text-zinc-500">by {freezeByName(f, roster)}</span>
                {countdown(f.until, now) !== null && <span className="tabular-nums text-zinc-500">thaws in {countdown(f.until, now)}</span>}
                <button className={clsx(btn, 'ml-auto')} disabled={busy !== null} onClick={() => void lift(f.id, f.targetName)} data-testid="run-wallet-unfreeze">
                  ☀ Lift
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {(requests.length > 0 || offers.length > 0) && (
        <>
          <div className="mt-3 text-xs text-zinc-400">Open requests and offers</div>
          <ul className="mt-1 flex flex-col gap-1" data-testid="run-wallet-asks">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded border border-zinc-800 px-2 py-1 text-xs">
                <span className="text-zinc-100">
                  🙏 {r.fromName} asks {r.toName}
                </span>
                <span className="tabular-nums text-zinc-300">
                  {r.amount} {wallet.name}
                </span>
                {countdown(r.expiresAt, now) !== null && <span className="tabular-nums text-zinc-500">expires in {countdown(r.expiresAt, now)}</span>}
                {requestCancellable(r.state) ? (
                  <button className={clsx(btn, 'ml-auto')} disabled={busy !== null} onClick={() => void act(`${r.id}:cancel`, WalletAction.Cancel, r.id)} data-testid="run-wallet-cancel">
                    {ACTION_LABEL.cancel}
                  </button>
                ) : (
                  <span className="ml-auto text-zinc-500">{r.state}</span>
                )}
              </li>
            ))}
            {offers.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2 rounded border border-zinc-800 px-2 py-1 text-xs">
                <span className="text-zinc-100">
                  💱 {o.fromName} {o.side === 'sell' ? 'sells' : 'buys'} “{o.entryTitle}” {o.side === 'sell' ? 'to' : 'from'} {o.toName}
                </span>
                <span className="tabular-nums text-zinc-300">
                  {o.amount} {wallet.name}
                </span>
                {countdown(o.expiresAt, now) !== null && <span className="tabular-nums text-zinc-500">expires in {countdown(o.expiresAt, now)}</span>}
                <button className={clsx(btn, 'ml-auto')} disabled={busy !== null} onClick={() => void act(`${o.id}:cancel`, WalletAction.Cancel, o.id)} data-testid="run-wallet-cancel">
                  {ACTION_LABEL.cancel}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {balances.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-zinc-400">Balances ({balances.length})</summary>
          <ul className="mt-1 grid grid-cols-2 gap-x-4 sm:grid-cols-3" data-testid="run-wallet-balances">
            {balances.map((b) => (
              <li key={b.id} className="flex justify-between text-zinc-300">
                <span className="truncate">{b.name}</span>
                <span className="tabular-nums text-zinc-400">{b.balance}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
