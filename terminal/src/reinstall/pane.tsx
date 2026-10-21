//! The reinstall app's flow on the tent laptop (wave 18b): `ReinstallFlow`
//! (`@loom/reinstall/flow.tsx` — the choose card, the begin, the game)
//! mounted full screen in its own shadow root, so the reinstall app's
//! stylesheet (re-scoped by `scope-css.ts`) and the terminal's never meet.
//!
//! A React root of its own inside the shadow root (as the play app's
//! `embed.tsx` does), never a portal: React's listeners then sit inside the
//! shadow tree and see the real targets. The flow is re-rendered into it
//! with every render of the pane, so `held` and the stations follow live;
//! a new `run` mounts a fresh flow. Keys reach the game as they always do
//! (`window` listeners: the shadow boundary retargets, never stops them).

import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReinstallFlow } from "@loom/reinstall/flow.tsx";
import rawCss from "@loom/reinstall/styles.css?inline";
import { scopeReinstallCss } from "./scope-css.ts";

type FlowProps = Parameters<typeof ReinstallFlow>[0];

let scoped: string | null = null;
const paneCss = (): string => (scoped ??= scopeReinstallCss(rawCss));

export function ReinstallPane({ run, ...flow }: FlowProps & { run: number }) {
  const host = useRef<HTMLDivElement>(null);
  const root = useRef<Root | null>(null);
  useEffect(() => {
    const el = host.current;
    if (el === null) return;
    const shadow = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    shadow.replaceChildren();
    const style = document.createElement("style");
    style.textContent = paneCss();
    const frame = document.createElement("div");
    frame.className = "ri-root";
    shadow.append(style, frame);
    const r = createRoot(frame);
    root.current = r;
    return () => {
      root.current = null;
      // Unmounting a root synchronously while the parent commits warns.
      window.setTimeout(() => r.unmount(), 0);
    };
  }, []);
  useEffect(() => {
    root.current?.render(<ReinstallFlow key={run} {...flow} />);
  });
  return <div ref={host} className="ri-pane" />;
}
