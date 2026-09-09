//! The Director page's named-argument line for a fired signal.

import type { SignalArgs } from '@/lib/api'

/**
 * Parse the director's `key: value, key2: value2` argument line into the
 * named args a signal binds (`fire x with level: 3`). Numbers and
 * booleans are typed; everything else stays a string. Returns `null`
 * for an empty line, and `undefined` when the line doesn't parse.
 */
export function parseSignalArgs(line: string): SignalArgs | null | undefined {
  const trimmed = line.trim()
  if (trimmed === '') return null
  const out: SignalArgs = {}
  for (const part of trimmed.split(',')) {
    const i = part.indexOf(':')
    if (i === -1) return undefined
    const key = part.slice(0, i).trim()
    const raw = part.slice(i + 1).trim()
    if (!/^[A-Za-z_][\w-]*$/.test(key) || raw === '') return undefined
    out[key] =
      raw === 'true' ? true
      : raw === 'false' ? false
      : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw)
      : raw.replace(/^"(.*)"$/, '$1')
  }
  return out
}
