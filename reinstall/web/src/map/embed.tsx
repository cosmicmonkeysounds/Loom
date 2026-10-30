//! The house map editor, embeddable: `<MapEmbed>` mounts the real `MapEditor`
//! (the same one as `/reinstall/map`) in its own shadow root, as
//! `@loom/play/embed` does the participant app. Run → House → 🗺 Map in the
//! editor loads this chunk lazily, so three.js never joins the editor's
//! first load. An iframe is not an option: the server sends `frame-ancestors
//! 'none'`.
//!
//! The host hands in a moderator token (the Run's `codes.mod` through
//! `/api/mod/login`): the author's session is the unlock, so nothing here
//! asks for a passcode.
//!
//! **Keys.** `MapEditor` listens on the window, ahead of the host page, and
//! takes a key only while `active()` says the map is what's showing, and only
//! one that landed in the map or on nothing at all (`document.body`). What
//! it answers to stops there; the same keys, and anything typed, stop at this
//! shadow host when they come from a field in the map, whose own handlers run
//! first, so a ⌘Z in an inspector field is that field's undo and never the
//! host's. The host's other shortcuts (⌘1, ⌘P…) pass through.
//!
//! **Connections.** On screen it polls without holding a socket; off screen
//! (`shown` false: a host keeping it mounted for its draft) it holds nothing.
//! The host page has long-lived streams of its own, and HTTP/1.1 gives an
//! origin six.

import { useCallback, useEffect, useMemo, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import fontCss from "@fontsource/vt323/index.css?inline";
import { defaultConfig } from "../config.ts";
import rawCss from "../styles.css?inline";
import audioCss from "./audio.css?inline";
import { mapPaneCss } from "./embed-css.ts";
import lightsCss from "./lights.css?inline";
import { MapEditor } from "./MapEditor.tsx";
import { projectBarExtras } from "./ProjectBar.tsx";
import { isTyping, keyOrigin, mapAnswersKey } from "./unlock.ts";

export interface MapEmbedProps {
  eventId: string;
  /** A moderator token for this event. A new one keeps the map and its draft. */
  token: string;
  /** The event's title. */
  title: string;
  /** Is the map on screen? False: it takes no keys and holds no connections. Default: yes. */
  shown?: boolean;
  /** Something over the map (a dialog) has the keys for now. */
  keysOff?: () => boolean;
  /** The server's address when it isn't this page's. */
  apiBase?: string;
  /** The event server's origin, for the links the map hands out. */
  linkOrigin?: string;
  /** The server stopped honouring `token`. */
  onRevoked?: () => void;
  className?: string;
}

let paneCss: string | null = null;
const css = (): string => (paneCss ??= mapPaneCss(`${rawCss}\n${audioCss}\n${lightsCss}`));

/** `@font-face` doesn't apply inside a shadow root: the pixel font goes on the document, once. */
let fontsIn = false;
function addFonts(): void {
  if (fontsIn) return;
  fontsIn = true;
  const style = document.createElement("style");
  style.dataset["loom"] = "map-fonts";
  style.textContent = fontCss;
  document.head.append(style);
}

function isNode(t: EventTarget | null): t is Node {
  return typeof Node !== "undefined" && t instanceof Node;
}

export function MapEmbed({ eventId, token, title, shown = true, keysOff, apiBase, linkOrigin, onRevoked, className }: MapEmbedProps) {
  const hostEl = useRef<HTMLDivElement>(null);
  const reactRoot = useRef<{ root: Root; frame: HTMLElement } | null>(null);
  const latest = useRef({ keysOff, onRevoked });
  latest.current = { keysOff, onRevoked };

  useEffect(() => {
    const el = hostEl.current;
    if (el === null) return;
    addFonts();
    const shadow = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    shadow.replaceChildren();
    const style = document.createElement("style");
    style.textContent = css();
    const frame = document.createElement("div");
    frame.className = "map-frame";
    // Focusable, so a click anywhere in the map brings the keyboard here.
    frame.tabIndex = -1;
    shadow.append(style, frame);
    const root = createRoot(frame);
    reactRoot.current = { root, frame };
    const stop = (e: KeyboardEvent) => {
      const typed = isTyping(keyOrigin(e)) && !e.metaKey && !e.ctrlKey;
      if (typed || mapAnswersKey(e)) e.stopPropagation();
    };
    el.addEventListener("keydown", stop);
    return () => {
      el.removeEventListener("keydown", stop);
      reactRoot.current = null;
      // Unmounting a root synchronously while the parent commits warns.
      setTimeout(() => root.unmount(), 0);
    };
  }, []);

  // Stable, or the editor's stream reopens at every render.
  const revoked = useCallback(() => latest.current.onRevoked?.(), []);

  const config = useMemo(() => defaultConfig({ eventId, token, title, name: "Run → House", ...(apiBase !== undefined ? { apiBase } : {}) }), [eventId, token, title, apiBase]);

  useEffect(() => {
    const r = reactRoot.current;
    if (r === null) return;
    const keysFor = (origin: EventTarget | null) => {
      if (!shown || latest.current.keysOff?.() === true) return false;
      return origin === document.body || origin === document.documentElement || (isNode(origin) && r.frame.contains(origin));
    };
    r.root.render(<MapEditor key={config.eventId} config={config} unlocked keysFor={keysFor} connections={shown ? "short" : "off"} toolbarExtras={projectBarExtras} onRevoked={revoked} {...(linkOrigin !== undefined ? { linkOrigin } : {})} />);
  }, [config, linkOrigin, shown, revoked]);

  // Coming on screen, the keys come here: the tab that brought it stays focused
  // otherwise, and its keys would be the host's (⌘Z, the story's undo).
  useEffect(() => {
    if (shown) reactRoot.current?.frame.focus({ preventScroll: true });
  }, [shown]);

  return <div ref={hostEl} className={className} />;
}
