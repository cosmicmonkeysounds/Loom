//! The house map's own page (`/reinstall/map`): a device set up with the
//! moderator passcode, then `MapEditor`. Opened with `?code=<mod>` (Run →
//! House's *Open in a new tab ↗*) it signs in with that code, scrubs it from
//! the address bar and, having just been given the passcode, doesn't ask
//! for it again this page load.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Setup } from "../app.tsx";
import { dropConfig, hintsFromSearch, loadConfig, provision, saveConfig, withoutSecrets, type ReinstallConfig } from "../config.ts";
import { Desktop, Window } from "../wizard.tsx";
import { MapEditor } from "./MapEditor.tsx";
import type { MapToolbarContext } from "./tools.ts";
import "./audio.css";
import "./lights.css";

export interface MapAppProps {
  /** Extra toolbar controls (the project bar), handed the editor's state. */
  toolbarExtras?: (ctx: MapToolbarContext) => ReactNode;
}

export function MapApp({ toolbarExtras }: MapAppProps = {}) {
  const [config, setConfig] = useState<ReinstallConfig | null>(() => loadConfig());
  const [notice, setNotice] = useState<string | null>(null);
  const [link, setLink] = useState<"none" | "signing-in" | "signed-in">(() => (hintsFromSearch(window.location.search).code === "" ? "none" : "signing-in"));

  useEffect(() => {
    const hints = hintsFromSearch(window.location.search);
    const search = withoutSecrets(window.location.search);
    if (search !== window.location.search) window.history.replaceState(null, "", `${window.location.pathname}${search}`);
    if (hints.code === "") return;
    void provision(hints.code, hints).then(
      (fresh) => {
        // The event and its token are the link's; this device stays this device.
        const stored = loadConfig();
        const next = stored === null ? fresh : { ...stored, eventId: fresh.eventId, token: fresh.token, title: fresh.title };
        saveConfig(next);
        setConfig(next);
        setLink("signed-in");
      },
      (e: Error) => {
        setNotice(e.message);
        setConfig(null);
        setLink("none");
      },
    );
  }, []);

  if (link === "signing-in") {
    return (
      <Desktop>
        <Window title="House map" icon="🗺">
          <p className="pad">Signing in…</p>
        </Window>
      </Desktop>
    );
  }
  if (config === null) {
    return (
      <Desktop>
        <Setup
          current={null}
          notice={notice ?? "The map needs this device set up with the moderator passcode."}
          onDone={(c) => {
            saveConfig(c);
            setConfig(c);
          }}
          onForget={() => {}}
        />
      </Desktop>
    );
  }
  return (
    <MapEditor
      config={config}
      unlocked={link === "signed-in"}
      {...(toolbarExtras !== undefined ? { toolbarExtras } : {})}
      onRevoked={() => {
        dropConfig();
        setNotice("This device's access was revoked — enter the moderator passcode again.");
        setLink("none");
        setConfig(null);
      }}
    />
  );
}
