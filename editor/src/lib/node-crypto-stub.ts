//! A browser stand-in for `node:crypto` (dev server + build only; vitest
//! runs on Node and gets the real module). The server's pure modules the
//! editor reuses import it at the top level — `@loom/core/chat` →
//! `core/server/wallet.ts` → `core/server/identity.ts`, for the reserved-
//! program claim HMAC — and Vite's externalized `node:crypto` throws on the
//! first touch of a named import, which aborted the whole module graph
//! before the app mounted. Nothing in the editor ever signs or checks a
//! claim, so every function here only says so.

function unavailable(name: string): never {
  throw new Error(`node:crypto.${name} is not available in the browser`)
}

export function createHmac(): never {
  return unavailable('createHmac')
}

export function timingSafeEqual(): never {
  return unavailable('timingSafeEqual')
}

export function randomBytes(): never {
  return unavailable('randomBytes')
}

export function createHash(): never {
  return unavailable('createHash')
}

export function randomUUID(): never {
  return unavailable('randomUUID')
}

export default { createHmac, timingSafeEqual, randomBytes, createHash, randomUUID }
