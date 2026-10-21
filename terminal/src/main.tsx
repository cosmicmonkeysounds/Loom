import { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { loadConfig } from "./config.ts";
import "@fontsource/vt323";
import "./styles.css";

// `?preview=list` / `?preview=<scene>` (wave 17): the cutscene workbench, a
// lazy chunk of its own — in dev, or on a terminal already set up with the
// moderator passcode (a guest can't open it on a fresh tablet).
const preview = new URLSearchParams(window.location.search).get("preview");
const Preview = lazy(() => import("./cutscene/preview.tsx").then((m) => ({ default: m.Preview })));

const el = document.getElementById("root");
if (el)
  createRoot(el).render(
    preview !== null && (import.meta.env.DEV || loadConfig() !== null) ? (
      <Suspense fallback={null}>
        <Preview />
      </Suspense>
    ) : (
      <App />
    ),
  );
