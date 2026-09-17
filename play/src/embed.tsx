//! The participant app, embeddable: `<PlayEmbed>` mounts the real guest or
//! performer app — the same components a phone runs — into its own shadow
//! root, on a session the host hands in (the editor's Run → Players page
//! mints one per pane through `/api/mod/impersonate`). Many can sit side by
//! side: each gets its own in-memory session, theme, crawl memory, key scope
//! and a two-pane breakpoint from its OWN width, and the stylesheet is
//! re-scoped from the page (`:root`, `body`, `vh`, viewport `@media`) to
//! the pane (`.play-root`, container units / queries) so nothing leaks in
//! or out of the shadow boundary.

import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GuestApp } from "./guest.tsx";
import { createCrawl, memoryStore, PlayHostContext, type PlayHost } from "./host.ts";
import { PerformerApp } from "./performer.tsx";
import { scopeCss } from "./embed-css.ts";
import rawCss from "./styles.css?inline";

/** A session the host already holds for this participant. */
export type EmbedSession =
  | { role: "guest"; token: string; id: string; name: string; eventId: string; title?: string }
  | { role: "prime"; token: string; character: string; eventId: string; title?: string };

/** The width the two-pane (sidebar + stage) layout starts at — `WIDE`. */
const WIDE_PX = 820;

let scoped: string | null = null;
const paneCss = (): string => (scoped ??= scopeCss(rawCss));

function EmbeddedApp({
  session,
  frame,
  onEnded,
}: {
  session: EmbedSession;
  frame: HTMLElement;
  onEnded: (role: "guest" | "prime", notice: string | null) => void;
}) {
  const [wide, setWide] = useState(() => frame.clientWidth >= WIDE_PX);
  useEffect(() => {
    const ro = new ResizeObserver(() => setWide(frame.clientWidth >= WIDE_PX));
    ro.observe(frame);
    return () => ro.disconnect();
  }, [frame]);
  const root = useRef<HTMLDivElement>(null);
  const ended = useRef(onEnded);
  ended.current = onEnded;
  // Stable per pane: the storage (seeded with the handed-in session) and the
  // crawl memory must survive a resize re-render.
  const stable = useMemo(
    () => ({
      storage: memoryStore(
        session.role === "guest"
          ? { "loom.guest": { id: session.id, name: session.name, token: session.token, eventId: session.eventId, title: session.title } }
          : { "loom.prime": { token: session.token, character: session.character, admin: false, eventId: session.eventId, title: session.title } },
      ),
      crawl: createCrawl(),
    }),
    [session],
  );
  const host = useMemo<PlayHost>(
    () => ({
      embedded: true,
      storage: stable.storage,
      crawl: stable.crawl,
      themeRoot: () => root.current,
      keyTarget: () => frame,
      ownsPage: false,
      sound: false,
      wide,
      onEnded: (role, notice) => ended.current(role, notice),
    }),
    [stable, frame, wide],
  );
  return (
    <PlayHostContext.Provider value={host}>
      <div ref={root} className="play-root">
        {session.role === "guest" ? <GuestApp onLeave={() => {}} /> : <PerformerApp onLeave={() => {}} />}
      </div>
    </PlayHostContext.Provider>
  );
}

/**
 * One participant's play app, isolated in a shadow root. Remount (change
 * `key`) to hand in a new session. Keystrokes stay inside the pane — they
 * never reach the host page's shortcuts.
 */
export function PlayEmbed({
  session,
  onEnded,
  className,
}: {
  session: EmbedSession;
  /** The participant left or a run transition cut the session. */
  onEnded: (role: "guest" | "prime", notice: string | null) => void;
  className?: string;
}) {
  const hostEl = useRef<HTMLDivElement>(null);
  const reactRoot = useRef<{ root: Root; frame: HTMLElement } | null>(null);
  const ended = useRef(onEnded);
  ended.current = onEnded;

  useEffect(() => {
    const el = hostEl.current;
    if (el === null) return;
    const shadow = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    shadow.replaceChildren();
    const style = document.createElement("style");
    style.textContent = paneCss();
    const frame = document.createElement("div");
    frame.className = "play-frame";
    // Focusable, so a click anywhere in the pane scopes the keyboard to it.
    frame.tabIndex = -1;
    shadow.append(style, frame);
    const root = createRoot(frame);
    reactRoot.current = { root, frame };
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener("keydown", stop);
    el.addEventListener("keyup", stop);
    el.addEventListener("keypress", stop);
    return () => {
      el.removeEventListener("keydown", stop);
      el.removeEventListener("keyup", stop);
      el.removeEventListener("keypress", stop);
      reactRoot.current = null;
      // Unmounting a root synchronously while the parent commits warns.
      setTimeout(() => root.unmount(), 0);
    };
  }, []);

  useEffect(() => {
    const r = reactRoot.current;
    if (r === null) return;
    r.root.render(<EmbeddedApp session={session} frame={r.frame} onEnded={(role, notice) => ended.current(role, notice)} />);
  }, [session]);

  return <div ref={hostEl} className={className} />;
}
