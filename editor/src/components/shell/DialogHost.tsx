// Renders the pending in-app dialog (see `@/store/dialog` for why the
// native `window.prompt`/`confirm`/`alert` are unusable — the desktop
// WKWebView has no prompt at all). Mounted once at the app root, above
// every shell, so stores and context-menu handlers can raise a dialog
// from anywhere.

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { DialogKind, useDialog, type DialogRequest, type DialogResult } from '@/store/dialog'

export function DialogHost() {
  const current = useDialog((s) => s.current)
  const settle = useDialog((s) => s.settle)
  if (!current) return null
  // Keyed on the request id: each dialog gets a fresh view whose input
  // is seeded at mount, so there is no state-sync effect to get wrong.
  return <DialogView key={current.id} req={current.req} onSettle={settle} />
}

function DialogView({
  req,
  onSettle,
}: {
  req: DialogRequest
  onSettle: (r: DialogResult) => void
}) {
  const isPrompt = req.kind === DialogKind.Prompt
  const [value, setValue] = useState(isPrompt ? req.defaultValue : '')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const okRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    inputRef.current?.select()
    ;(inputRef.current ?? okRef.current)?.focus()
  }, [])

  // Dismissing an alert is the same as acknowledging it; a cancelled
  // prompt yields null, a cancelled confirm false.
  const cancelValue: DialogResult =
    req.kind === DialogKind.Alert ? true : req.kind === DialogKind.Prompt ? null : false
  const blocked = isPrompt && req.requireValue && value.trim() === ''

  const accept = () => {
    if (req.kind === DialogKind.Prompt) {
      const v = value.trim()
      if (req.requireValue && v === '') return
      onSettle(v)
    } else onSettle(true)
  }
  const cancel = () => onSettle(cancelValue)
  const danger = req.kind === DialogKind.Confirm && req.danger

  return (
    <div
      className="fixed inset-0 z-[200] grid place-items-center bg-black/60 p-6"
      data-testid="dialog-host"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={req.title}
        className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            cancel()
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.stopPropagation()
            e.preventDefault()
            accept()
          }
        }}
      >
        <h2 className="text-sm font-semibold text-zinc-100">{req.title}</h2>
        {req.body && <p className="mt-2 whitespace-pre-line text-sm text-zinc-400">{req.body}</p>}

        {isPrompt && (
          <input
            ref={inputRef}
            data-testid="dialog-input"
            value={value}
            placeholder={req.placeholder}
            onChange={(e) => setValue(e.target.value)}
            className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-500"
          />
        )}

        <div className="mt-4 flex justify-end gap-2">
          {req.kind !== DialogKind.Alert && (
            <button
              type="button"
              data-testid="dialog-cancel"
              onClick={cancel}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
          )}
          <button
            ref={okRef}
            type="button"
            data-testid="dialog-confirm"
            onClick={accept}
            disabled={blocked}
            className={clsx(
              'rounded-lg px-3 py-1.5 text-sm font-medium disabled:cursor-default disabled:opacity-40',
              danger
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-blue-600 text-white hover:bg-blue-500',
            )}
          >
            {req.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
