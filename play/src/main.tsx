import { createRoot } from "react-dom/client";
import { ChunkBoundary, ChunkFailed } from "./lazy-chunk.tsx";
import { cardFromSearch, withoutCard } from "./rejoin.ts";
import { resumeFromSearch, withoutResume } from "./resume.ts";
import { App } from "./ui.tsx";
import "./styles.css";

// A re-pair QR (`?pair=<code>`, N-02) carries a one-time credential: take it and
// strip it from the address bar before anything renders.
const resume = resumeFromSearch(window.location.search);
if (resume !== null) {
  try {
    window.history.replaceState(null, "", `${window.location.pathname}${withoutResume(window.location.search)}`);
  } catch {
    /* fine */
  }
}

// A badge or cast card (wave 23) is a credential too: same.
const card = cardFromSearch(window.location.search);
if (card !== null) {
  try {
    window.history.replaceState(null, "", `${window.location.pathname}${withoutCard(window.location.search)}`);
  } catch {
    /* fine */
  }
}

const el = document.getElementById("root");
// Wave 26 integration: one throw anywhere (a render, an effect cleanup) must
// never leave a guest on a blank page on show night — a Reload instead.
if (el)
  createRoot(el).render(
    <ChunkBoundary fallback={() => <ChunkFailed what={/* DRAFT w26 (integration): UI copy */ "The app"} />}>
      <App resume={resume} card={card} />
    </ChunkBoundary>,
  );
