// In-app modal dialogs — the replacement for `window.prompt` /
// `window.confirm` / `window.alert`.
//
// Why this exists: the desktop app runs in a WKWebView (Tauri), which
// does NOT implement `window.prompt` — it resolves to `null` with no UI,
// so every "New file…" / "New beat…" / rename flow silently did nothing.
// `confirm`/`alert` are equally unreliable across webviews. Routing all
// of them through one in-app host means a single code path that behaves
// identically in the browser and on desktop (and is themable + testable).
//
// The API is promise-based and callable from non-React code (stores,
// context-menu handlers): `await promptText(...)`, `await confirmAction(...)`,
// `await notify(...)`. `<DialogHost>` renders whatever is pending.

import { create } from 'zustand'

export const DialogKind = {
  Prompt: 'prompt',
  Confirm: 'confirm',
  Alert: 'alert',
} as const
export type DialogKind = (typeof DialogKind)[keyof typeof DialogKind]

export type DialogRequest =
  | {
      kind: typeof DialogKind.Prompt
      title: string
      body?: string
      placeholder?: string
      defaultValue: string
      confirmLabel: string
      /** Reject empty/whitespace input (the common case for names). */
      requireValue: boolean
      danger?: false
    }
  | {
      kind: typeof DialogKind.Confirm
      title: string
      body?: string
      confirmLabel: string
      danger: boolean
    }
  | {
      kind: typeof DialogKind.Alert
      title: string
      body?: string
      confirmLabel: string
    }

/** Prompt resolves to the entered string (or null); confirm to a boolean. */
export type DialogResult = string | boolean | null

type Pending = {
  /** Monotonic id — the host keys its view on it so each request gets a
   *  fresh, correctly-seeded input with no state-sync effect. */
  id: number
  req: DialogRequest
  resolve: (r: DialogResult) => void
}

let nextId = 1

type DialogState = {
  /** The dialog currently on screen, if any. */
  current: Pending | null
  /** Requests raised while another was open, served in order. */
  queue: Pending[]
  push(req: DialogRequest): Promise<DialogResult>
  /** Settle the open dialog and promote the next queued one. */
  settle(result: DialogResult): void
}

export const useDialog = create<DialogState>((set, get) => ({
  current: null,
  queue: [],
  push: (req) =>
    new Promise<DialogResult>((resolve) => {
      const pending: Pending = { id: nextId++, req, resolve }
      if (get().current) set({ queue: [...get().queue, pending] })
      else set({ current: pending })
    }),
  settle: (result) => {
    const { current, queue } = get()
    if (!current) return
    const [next, ...rest] = queue
    set({ current: next ?? null, queue: rest })
    current.resolve(result)
  },
}))

/** Ask for a line of text. Resolves to the trimmed value, or null on cancel. */
export async function promptText(opts: {
  title: string
  body?: string
  placeholder?: string
  defaultValue?: string
  confirmLabel?: string
  /** Allow an empty result through (defaults to refusing it). */
  allowEmpty?: boolean
}): Promise<string | null> {
  const r = await useDialog.getState().push({
    kind: DialogKind.Prompt,
    title: opts.title,
    body: opts.body,
    placeholder: opts.placeholder,
    defaultValue: opts.defaultValue ?? '',
    confirmLabel: opts.confirmLabel ?? 'OK',
    requireValue: !opts.allowEmpty,
  })
  return typeof r === 'string' ? r : null
}

/** Ask a yes/no question. Resolves false on cancel/dismiss. */
export async function confirmAction(opts: {
  title: string
  body?: string
  confirmLabel?: string
  danger?: boolean
}): Promise<boolean> {
  const r = await useDialog.getState().push({
    kind: DialogKind.Confirm,
    title: opts.title,
    body: opts.body,
    confirmLabel: opts.confirmLabel ?? 'Confirm',
    danger: opts.danger ?? false,
  })
  return r === true
}

/** Tell the author something. Resolves once dismissed. */
export async function notify(opts: {
  title: string
  body?: string
  confirmLabel?: string
}): Promise<void> {
  await useDialog.getState().push({
    kind: DialogKind.Alert,
    title: opts.title,
    body: opts.body,
    confirmLabel: opts.confirmLabel ?? 'OK',
  })
}
