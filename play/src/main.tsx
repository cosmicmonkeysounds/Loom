import { createRoot } from "react-dom/client";
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

const el = document.getElementById("root");
if (el) createRoot(el).render(<App resume={resume} />);
