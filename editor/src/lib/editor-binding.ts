//! The identity of the document a CodeMirror view is bound to.
//!
//! `Editor.tsx` keys its `<CodeMirror>` on `editorViewKey(...)` so React
//! **remounts** the component — building a fresh `EditorView` — whenever the
//! bound document changes, instead of reconfiguring the existing one.
//!
//! That is not a nicety, it is a correctness requirement of
//! `y-codemirror.next`. `yCollab()` composes two module-level `ViewPlugin`s
//! (`ySync`, `yUndoManager`) that capture their `Y.Text` / `Y.UndoManager`
//! in the constructor and never re-read the facet afterwards. CodeMirror
//! keeps a plugin *instance* alive across a `StateEffect.reconfigure` (the
//! plugin spec object is the same singleton), so handing a live view a new
//! `yCollab(...)` leaves it writing every keystroke into the PREVIOUSLY
//! bound file's `Y.Text`. That write round-trips through `collab.ts`'s
//! `onText` handler and overwrites the previous file's store contents — and,
//! on the next persist, its server copy — with the text of the file on
//! screen, while the file on screen never reaches its own doc. Switching
//! back then shows the clobbered text, because the store's copy now matches
//! what the view is already displaying.

/** A stable id per bound document object, assigned on first sight. */
const docIds = new WeakMap<object, number>()
let nextDocId = 0

/**
 * The React `key` for the editor view bound to `path` + `doc`.
 *
 * Distinct paths always key apart; so do two different documents for the
 * same path (a `Y.Text` recreated after `dropCollabDoc`, or a file that
 * gains a live doc after its tab opened). A plain, collab-less file keys on
 * its path alone.
 */
export function editorViewKey(path: string | null, doc?: object | null): string {
  return `${path ?? ''}::${docKeyFor(doc)}`
}

function docKeyFor(doc: object | null | undefined): string {
  if (!doc) return 'plain'
  let id = docIds.get(doc)
  if (id === undefined) {
    id = ++nextDocId
    docIds.set(doc, id)
  }
  return `live${id}`
}
