//! Run → House: the page's shared Tailwind classes (the Mind page's palette)
//! and labels.

import type { DeskStepKind } from '@loom/core/house-desk'

export const panel = 'rounded-xl border border-zinc-800 bg-zinc-950'
export const heading = 'text-[10px] font-semibold uppercase tracking-widest text-zinc-500'
export const btn = 'rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40'
export const btnPrimary = 'rounded bg-indigo-600 px-2 py-0.5 text-xs text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40'
export const btnDanger = 'rounded border border-red-800 bg-red-950/40 px-2 py-0.5 text-xs text-red-100 hover:bg-red-900/50 disabled:opacity-50'
export const input = 'min-w-0 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-indigo-500'
export const label = 'text-[10px] uppercase tracking-wide text-zinc-500'

/** A chip's colours by tone. */
export const TONE_CHIP = {
  ok: 'border-emerald-800/70 bg-emerald-950/40 text-emerald-200',
  warn: 'border-amber-800/70 bg-amber-950/40 text-amber-200',
  bad: 'border-red-800/70 bg-red-950/40 text-red-200',
} as const

export const TONE_TEXT = { ok: 'text-emerald-300', warn: 'text-amber-300', bad: 'text-red-300' } as const

/** A step kind in the pickers. */
export const KIND_LABEL: Record<DeskStepKind, string> = {
  sound: '🔊 sound',
  say: '📢 say',
  look: '💡 look',
  light: '💡 light',
  stop: '■ stop sounds',
  event: '⚡ story event',
  speech: '🗣 wait for speech',
  wait: '⏱ wait',
}
