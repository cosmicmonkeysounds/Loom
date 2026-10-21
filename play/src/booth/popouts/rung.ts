//! The booth's one import of the pop-out rung (BOOTH-SPEC §2.1). Until the
//! moments lane's `play/src/moments/popout.tsx` lands this re-exports the
//! local stand-in; at integration swap the line below to
//! `export * from "../../moments/popout.tsx";` (and drop `PopOutProvider`
//! from `booth/app.tsx` if the moments provider already carries the rung).

export * from "./rung-stub.tsx";
