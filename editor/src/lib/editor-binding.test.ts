import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { editorViewKey } from './editor-binding'

/**
 * The invariant these guard: the editor's view key must change whenever the
 * document CodeMirror is bound to changes. If it doesn't, React reuses the
 * EditorView, `yCollab`'s ViewPlugins stay bound to the previous file's
 * `Y.Text`, and typing in one file overwrites another's contents.
 */
describe('editorViewKey', () => {
  const ytext = () => new Y.Doc().getText('content')

  it('is stable for the same path + document', () => {
    const a = ytext()
    expect(editorViewKey('proj/a.loom', a)).toBe(editorViewKey('proj/a.loom', a))
  })

  it('differs between two files with live docs', () => {
    expect(editorViewKey('proj/a.loom', ytext())).not.toBe(editorViewKey('proj/b.loom', ytext()))
  })

  it('differs when the same path is rebound to a new document', () => {
    // e.g. `dropCollabDoc` + reopen, or a tab that opened before its
    // collab doc synced and later gained one.
    const path = 'proj/a.loom'
    expect(editorViewKey(path, ytext())).not.toBe(editorViewKey(path, ytext()))
  })

  it('differs when a file gains (or loses) a live doc', () => {
    const path = 'proj/a.loom'
    expect(editorViewKey(path, null)).not.toBe(editorViewKey(path, ytext()))
  })

  it('keys collab-less files on the path alone', () => {
    expect(editorViewKey('folder/a.loom', null)).toBe(editorViewKey('folder/a.loom', null))
    expect(editorViewKey('folder/a.loom', null)).not.toBe(editorViewKey('folder/b.loom', null))
  })
})
