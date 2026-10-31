// Wave 58: Play fills the screen wherever the browser lets it. A browser only
// goes fullscreen on a tap, so the first tap does it, and a tap after anything
// that dropped it (the back gesture, the camera app, leaving and coming back)
// does it again. An iPhone's Safari has no fullscreen for a page at all: there
// `canRequest` is false and nothing happens; only its Home Screen app loses the
// bars. An installed app is already full: the manifest's `display_override`.
//
// The request spends the tap's user activation, and a file picker, a share
// sheet or a permission prompt needs that same activation. So the listener sits
// on `document` in the bubble phase, after React's handlers (they run at the
// root), and leaves alone a tap a button has already spent.
//
// A mouse is asked once: Esc on a laptop means it. Only `main.tsx` starts this,
// so Run → Players, which mounts the app in a shadow root, never does.

interface FullscreenTarget {
  requestFullscreen?: (options?: { navigationUI?: "hide" | "show" | "auto" }) => Promise<void> | void;
  /** iPad Safari. */
  webkitRequestFullscreen?: () => void;
}

interface FullscreenDoc {
  documentElement: FullscreenTarget;
  fullscreenEnabled?: boolean;
  webkitFullscreenEnabled?: boolean;
  fullscreenElement?: unknown;
  webkitFullscreenElement?: unknown;
  addEventListener(type: string, listener: (event: { pointerType?: string }) => void, options?: { capture?: boolean; passive?: boolean }): void;
  removeEventListener(type: string, listener: (event: { pointerType?: string }) => void, options?: { capture?: boolean }): void;
}

export interface FullscreenEnv {
  document: FullscreenDoc;
  navigator?: { standalone?: boolean; userActivation?: { isActive: boolean } };
  matchMedia?: (query: string) => { matches: boolean };
}

/** Can this page ask at all? False on an iPhone's Safari and in a framed page. */
export function canRequest(doc: FullscreenDoc): boolean {
  const root = doc.documentElement;
  if (typeof root.requestFullscreen === "function") return doc.fullscreenEnabled !== false;
  return typeof root.webkitRequestFullscreen === "function" && doc.webkitFullscreenEnabled !== false;
}

/** Already filling the screen: fullscreen now, or an installed app. */
export function isFull(env: FullscreenEnv): boolean {
  const doc = env.document;
  if (doc.fullscreenElement || doc.webkitFullscreenElement) return true;
  if (env.navigator?.standalone === true) return true;
  return env.matchMedia?.("(display-mode: fullscreen)").matches === true || env.matchMedia?.("(display-mode: standalone)").matches === true;
}

/** Ask for fullscreen. Never throws: a refusal changes nothing on the page. */
export function requestFull(doc: FullscreenDoc): void {
  const root = doc.documentElement;
  try {
    if (typeof root.requestFullscreen === "function") {
      void Promise.resolve(root.requestFullscreen({ navigationUI: "hide" })).catch(() => {});
    } else {
      root.webkitRequestFullscreen?.();
    }
  } catch {
    /* fine */
  }
}

/** Should this tap ask? `pointer` is the tap's `pointerType`; `asked` says a mouse
 *  has had its one go. */
export function shouldRequest(env: FullscreenEnv, pointer: string, asked: boolean): boolean {
  if (!canRequest(env.document) || isFull(env)) return false;
  if (env.navigator?.userActivation?.isActive === false) return false;
  if (pointer === "touch" || pointer === "pen") return true;
  return pointer === "mouse" && !asked;
}

/** Listen for taps, for as long as the page lives. Returns the undo (tests). */
export function startFullscreen(env: FullscreenEnv): () => void {
  const doc = env.document;
  if (!canRequest(doc)) return () => {};
  let pointer = "";
  let asked = false;
  const onPointer = (event: { pointerType?: string }): void => {
    pointer = event.pointerType ?? "";
  };
  const onClick = (): void => {
    if (!shouldRequest(env, pointer, asked)) return;
    if (pointer === "mouse") asked = true;
    requestFull(doc);
  };
  doc.addEventListener("pointerdown", onPointer, { capture: true, passive: true });
  doc.addEventListener("click", onClick);
  return () => {
    doc.removeEventListener("pointerdown", onPointer, { capture: true });
    doc.removeEventListener("click", onClick);
  };
}
