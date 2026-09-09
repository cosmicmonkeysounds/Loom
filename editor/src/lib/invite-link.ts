//! The deep links the server puts in share emails:
//!
//!   <editor>/?invite=<token>   accept a pending invite (no account yet)
//!   <editor>/?project=<id>     open a project you can already access
//!
//! Both are consumed once at boot: the query is stripped from the address
//! bar and the intent parked in `sessionStorage`, so it survives the sign-in
//! / sign-up round-trip (which re-renders the app but never reloads it) and
//! a reload mid-way, but not a new tab.

export type LinkIntent = { kind: 'invite'; token: string } | { kind: 'project'; id: string }

const KEY = 'loom.pending-link'

/** Parse a link intent out of a URL's query string (`null` when none). */
export function parseLinkIntent(search: string): LinkIntent | null {
  const q = new URLSearchParams(search)
  const invite = q.get('invite')?.trim()
  if (invite) return { kind: 'invite', token: invite }
  const project = q.get('project')?.trim()
  if (project) return { kind: 'project', id: project }
  return null
}

/** Strip the consumed params from a URL string, keeping any others. */
export function stripLinkParams(href: string): string {
  const u = new URL(href)
  u.searchParams.delete('invite')
  u.searchParams.delete('project')
  return u.toString()
}

type Storage = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/** Park an intent for after sign-in. */
export function stashLinkIntent(intent: LinkIntent, store: Storage | null = storage()): void {
  store?.setItem(KEY, JSON.stringify(intent))
}

/** The parked intent, if any (does not clear it — call `clearLinkIntent`). */
export function peekLinkIntent(store: Storage | null = storage()): LinkIntent | null {
  const raw = store?.getItem(KEY)
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as LinkIntent
    if (v.kind === 'invite' && typeof v.token === 'string') return v
    if (v.kind === 'project' && typeof v.id === 'string') return v
  } catch {
    /* corrupt → ignore */
  }
  return null
}

export function clearLinkIntent(store: Storage | null = storage()): void {
  store?.removeItem(KEY)
}

/**
 * Boot-time capture: if the address bar carries a link, park it and clean
 * the URL. Returns the intent now pending (from this URL or an earlier one).
 */
export function captureLinkFromLocation(loc: Location = window.location, hist: History = window.history): LinkIntent | null {
  const fromUrl = parseLinkIntent(loc.search)
  if (fromUrl !== null) {
    stashLinkIntent(fromUrl)
    hist.replaceState(hist.state, '', stripLinkParams(loc.href))
    return fromUrl
  }
  return peekLinkIntent()
}
