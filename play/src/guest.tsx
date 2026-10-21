//! Barrel (wave 13): the guest app moved into `guest/` — `app.tsx` (the
//! app, `useCutscene`), `register.tsx` (the sign-in) and
//! `sheets.tsx` (profile, pass, People, the identity card). Every old name
//! still resolves here; new code imports the concrete module.

export { GuestApp, useCutscene } from "./guest/app.tsx";
