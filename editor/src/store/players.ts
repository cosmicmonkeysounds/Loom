//! Run → Players: the **lineup** — which participants this console is
//! playing right now, each in its own embedded play app. A slot names a
//! person (a guest / persona id, or a character) plus the display name it
//! was opened under, so a rehearsal restart — which kills every persona id —
//! can re-seat the same lineup on fresh personas of the same names.
//!
//! Pure UI state (not a backend store), persisted per project in
//! `localStorage` so a reload keeps the floor set. Sessions themselves are
//! never persisted: a pane mints a fresh one every time it mounts.

import { create } from 'zustand'
import { PlayerRole } from '@/store/cockpit'

export interface PlayerSlot {
  /** Stable pane key (survives a re-seat onto a new persona id). */
  key: string
  role: PlayerRole
  /** Guest / persona id, or the character name. */
  id: string
  /** Display name — what a re-seat spawns a new persona as. */
  name: string
}

/** How wide each pane renders. `Wide` crosses the play app's two-pane
 *  breakpoint (sidebar + stage), the narrower two are the phone drill-in. */
export const PaneWidth = {
  Phone: 'phone',
  Tablet: 'tablet',
  Wide: 'wide',
} as const

export type PaneWidth = (typeof PaneWidth)[keyof typeof PaneWidth]

export const PANE_PX: Record<PaneWidth, number> = {
  [PaneWidth.Phone]: 390,
  [PaneWidth.Tablet]: 600,
  [PaneWidth.Wide]: 860,
}

interface Persisted {
  slots: PlayerSlot[]
  width: PaneWidth
}

interface PlayersState extends Persisted {
  /** The project (or local folder) this lineup belongs to. */
  scope: string | null
  /** Bind to a project: load its saved lineup. */
  bind(scope: string | null): void
  /** Seat a participant (no-op when already seated). Returns the slot key. */
  add(role: PlayerRole, id: string, name: string): string
  remove(key: string): void
  /** Re-seat a slot onto a different person (a respawned persona). */
  rebind(key: string, id: string, name?: string): void
  clear(): void
  setWidth(width: PaneWidth): void
}

const storageKey = (scope: string) => `loom.players.${scope}`

function load(scope: string): Persisted {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(scope)) ?? 'null') as Partial<Persisted> | null
    const slots = Array.isArray(raw?.slots)
      ? raw.slots.filter(
          (s): s is PlayerSlot =>
            typeof s?.key === 'string' &&
            typeof s.id === 'string' &&
            typeof s.name === 'string' &&
            (s.role === PlayerRole.Guest || s.role === PlayerRole.Performer),
        )
      : []
    const width = Object.values(PaneWidth).includes(raw?.width as PaneWidth) ? (raw!.width as PaneWidth) : PaneWidth.Phone
    return { slots, width }
  } catch {
    return { slots: [], width: PaneWidth.Phone }
  }
}

let seq = 0
const newKey = () => `pane-${Date.now().toString(36)}-${(seq++).toString(36)}`

export const usePlayers = create<PlayersState>((set, get) => {
  const persist = () => {
    const { scope, slots, width } = get()
    if (scope === null) return
    try {
      localStorage.setItem(storageKey(scope), JSON.stringify({ slots, width }))
    } catch {
      /* storage unavailable — the lineup just won't survive a reload */
    }
  }
  const change = (patch: Partial<Persisted>) => {
    set(patch)
    persist()
  }
  return {
    scope: null,
    slots: [],
    width: PaneWidth.Phone,
    bind: (scope) => {
      if (scope === get().scope) return
      set({ scope, ...(scope === null ? { slots: [], width: PaneWidth.Phone } : load(scope)) })
    },
    add: (role, id, name) => {
      const existing = get().slots.find((s) => s.role === role && s.id === id)
      if (existing) return existing.key
      const key = newKey()
      change({ slots: [...get().slots, { key, role, id, name }] })
      return key
    },
    remove: (key) => change({ slots: get().slots.filter((s) => s.key !== key) }),
    rebind: (key, id, name) =>
      change({ slots: get().slots.map((s) => (s.key === key ? { ...s, id, name: name ?? s.name } : s)) }),
    clear: () => change({ slots: [] }),
    setWidth: (width) => change({ width }),
  }
})

/**
 * Where a guest slot whose person no longer exists (a restart killed the
 * persona) should be re-seated: a live persona of the same name that this
 * console owns and no other pane holds — e.g. the one the cockpit already
 * re-spawned for you — else null (spawn a new one).
 */
export function reseatTarget(
  slot: PlayerSlot,
  roster: ReadonlyArray<{ id: string; name: string; owner?: string | null }>,
  me: string,
  seated: ReadonlyArray<PlayerSlot>,
): string | null {
  const taken = new Set(seated.filter((s) => s.key !== slot.key && s.role === PlayerRole.Guest).map((s) => s.id))
  const hit = roster.find(
    (r) => r.name === slot.name && r.id.startsWith('p') && !taken.has(r.id) && (r.owner == null || r.owner === me),
  )
  return hit?.id ?? null
}
