//! Barrel (wave 13): the performer app moved into `booth/` — `app.tsx`
//! (the app, `boothHome`), `login.tsx`, `scanner.tsx`, `card.tsx` (the
//! guest card, `splitInteractions`) and `header.tsx`. Every old name still
//! resolves here; new code imports the concrete module.

export { PerformerApp, boothHome } from "./booth/app.tsx";
export { splitInteractions } from "./booth/card.tsx";
