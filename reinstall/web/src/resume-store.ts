//! (wave 40) The standalone web device remembers an in-progress walk, so a
//! reload — or coming back to the tab within the server's resume grace — can
//! pick it up ("Are you NAME?"). One walk, keyed by the server base, in
//! localStorage. The tent laptop never stores one: `app.tsx` only wires this
//! for its own device, never the shared terminal that mounts the flow.

const KEY = "loom.reinstall.resume";

export interface StoredWalk {
  token: string;
  name: string;
  session: string;
  /** The server base it belongs to — a walk from another event is ignored. */
  base: string;
}

type Slot = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function safeStorage(): Slot | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function saveResume(walk: StoredWalk, storage: Slot | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(walk));
  } catch {
    /* storage full or denied — resume simply won't be offered */
  }
}

/** The stored walk for this base, or null (none, unreadable, or another base). */
export function loadResume(base: string, storage: Slot | null = safeStorage()): StoredWalk | null {
  try {
    const raw = storage?.getItem(KEY);
    if (raw == null || raw === "") return null;
    const w = JSON.parse(raw) as Partial<StoredWalk>;
    if (typeof w.token === "string" && typeof w.name === "string" && typeof w.session === "string" && w.base === base) {
      return { token: w.token, name: w.name, session: w.session, base: w.base };
    }
  } catch {
    /* unreadable — treat as none */
  }
  return null;
}

export function clearResume(storage: Slot | null = safeStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
}
