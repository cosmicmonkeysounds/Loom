import { create } from 'zustand'
import type { Node, Edge } from '@xyflow/react'
import {
  createDirectory,
  createFile,
  createFsObserver,
  queryHandlePermission,
  readDirectoryTree,
  readFileText,
  removeEntry,
  renameHandle,
  requestHandlePermission,
  writeFileText,
  type FsChangeRecord,
  type FsEntry,
} from '@/lib/fs'
import { idbDel, idbGet, idbSet } from '@/lib/idb'
import { isDesktop } from '@/lib/desktop'
import { rehydrateDesktopHandle } from '@/lib/desktop-fs'
import { useSettings } from '@/store/settings'
import { useAuth } from '@/store/auth'
import { projectsApi, type ProjectFile } from '@/lib/api'
import { resetIndexCache, dropIndexedPath, syncBuffer } from '@/lib/lsp-index'
import {
  collabTextFor,
  collabWrite,
  dropCollabDoc,
  openCollabDoc,
  startCollab,
  stopCollab,
} from '@/lib/collab'
import { confirmAction, notify } from '@/store/dialog'

function applyFormat(text: string): string {
  // Trim trailing whitespace on every line, and ensure exactly one final newline.
  const lines = text.split('\n').map((l) => l.replace(/[ \t]+$/g, ''))
  let trimmed = lines.join('\n')
  trimmed = trimmed.replace(/\n+$/, '')
  return trimmed + '\n'
}

export type OpenFile = {
  path: string
  /** Present for local files; server-backed files save through the API. */
  handle?: FileSystemFileHandle
  backend: 'local' | 'server'
  /** The owning project id, for server-backed files. */
  projectId?: string
  contents: string
  dirty: boolean
}

export type RootStatus = 'idle' | 'connected' | 'needs-permission' | 'denied'

export type CursorInfo = { line: number; column: number; selection: number }

const ROOT_HANDLE_KEY = 'root-handle'

type WorkspaceState = {
  root: FsEntry | null
  rootStatus: RootStatus
  /** The open server project (SaaS), or null when editing a local folder. */
  projectId: string | null
  projectName: string | null
  openFiles: Record<string, OpenFile>
  tabOrder: string[]
  activePath: string | null
  recentlyClosed: { path: string; handle?: FileSystemFileHandle }[]
  cursor: CursorInfo | null
  /** `focus: false` scrolls the editor without stealing keyboard focus —
   *  used by canvas-initiated reveals so the graph keeps its key flow. */
  pendingCursor: { path: string; line: number; column: number; token: number; focus: boolean } | null

  nodes: Node[]
  edges: Edge[]

  /** Bumped when a file's live co-editing doc becomes (un)available, so the
   *  editor re-derives its CodeMirror collab binding. */
  collabGen: number

  openRoot: (handle: FileSystemDirectoryHandle) => Promise<void>
  /** Open a server-backed project: load its files into an editable tree. */
  openServerProject: (project: { id: string; name: string }, files: ProjectFile[]) => Promise<void>
  restoreRoot: () => Promise<void>
  requestPermission: () => Promise<void>
  closeRoot: () => Promise<void>
  refreshTree: () => Promise<void>
  openFile: (entry: FsEntry) => Promise<void>
  // Async because a dirty tab asks for confirmation through the in-app
  // dialog host (the desktop webview has no `window.confirm`).
  closeFile: (path: string) => Promise<void>
  closeOthers: (path: string) => Promise<void>
  closeAll: () => Promise<void>
  reopenClosed: () => Promise<void>
  setActive: (path: string) => void
  cycleTab: (delta: number) => void
  activateTabByIndex: (index: number) => void
  updateContents: (path: string, contents: string) => void
  setCursor: (cursor: CursorInfo | null) => void
  revealAt: (entry: FsEntry, line: number, column?: number, opts?: { focus?: boolean }) => Promise<void>
  /** Reveal a 1-based line in the already-open active file (no reopen). */
  revealActive: (line: number, column?: number, opts?: { focus?: boolean }) => void
  saveActive: () => Promise<void>
  saveAll: () => Promise<void>
  createNewFile: (name: string) => Promise<void>
  createFileIn: (dir: FsEntry, name: string) => Promise<void>
  createDirectoryIn: (dir: FsEntry, name: string) => Promise<void>
  deleteEntry: (parent: FsEntry, entry: FsEntry) => Promise<void>
  renameEntry: (parent: FsEntry, entry: FsEntry, newName: string) => Promise<void>

  setNodes: (updater: Node[] | ((prev: Node[]) => Node[])) => void
  setEdges: (updater: Edge[] | ((prev: Edge[]) => Edge[])) => void
}

const nodeStyle = {
  background: '#18181b',
  color: '#e6e6e6',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  fontSize: 12,
  padding: 8,
  minWidth: 140,
} as const

function buildNodeForPath(path: string, index: number): Node {
  return {
    id: path,
    position: { x: 60 + (index % 3) * 220, y: 60 + Math.floor(index / 3) * 140 },
    data: { label: path.split('/').pop() ?? path },
    style: { ...nodeStyle },
  }
}

/** Get-or-create the directory node for a server-relative dir path. */
function ensureServerDir(root: FsEntry, dirPath: string): FsEntry {
  if (dirPath === '' || dirPath === root.path) return root
  const parts = dirPath.split('/')
  let dir = root
  for (let i = 0; i < parts.length; i++) {
    const segPath = parts.slice(0, i + 1).join('/')
    let child = dir.children!.find((c) => c.kind === 'directory' && c.path === segPath)
    if (!child) {
      child = { name: parts[i], path: segPath, kind: 'directory', backend: 'server', children: [] }
      dir.children!.push(child)
    }
    dir = child
  }
  return dir
}

/** Build a synthetic file tree (no handles) for a server-backed project. */
function buildServerTree(name: string, files: ProjectFile[]): FsEntry {
  const root: FsEntry = { name, path: name, kind: 'directory', backend: 'server', children: [] }
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const parts = f.path.split('/')
    const dir = ensureServerDir(root, parts.slice(0, -1).join('/'))
    dir.children!.push({ name: parts[parts.length - 1], path: f.path, kind: 'file', backend: 'server', content: f.content })
  }
  return root
}

/** Every file path in a (sub)tree. */
function collectFilePaths(entry: FsEntry, out: string[] = []): string[] {
  if (entry.kind === 'file') out.push(entry.path)
  for (const c of entry.children ?? []) collectFilePaths(c, out)
  return out
}

/** Every directory node in a tree, by path (root excluded). */
function collectDirs(entry: FsEntry, out: Map<string, FsEntry> = new Map(), isRoot = true): Map<string, FsEntry> {
  if (entry.kind === 'directory' && !isRoot) out.set(entry.path, entry)
  for (const c of entry.children ?? []) collectDirs(c, out, false)
  return out
}

/** Remove the node at `path` from a mutable tree (used pre-reconcile). */
function pruneEntry(root: FsEntry, path: string): void {
  const walk = (dir: FsEntry): boolean => {
    if (!dir.children) return false
    const idx = dir.children.findIndex((c) => c.path === path)
    if (idx >= 0) {
      dir.children.splice(idx, 1)
      return true
    }
    return dir.children.some(walk)
  }
  walk(root)
}

/** Find the first file entry with an exact relative path, depth-first. */
function findFileEntry(entry: FsEntry, path: string): FsEntry | null {
  if (entry.kind === 'file') return entry.path === path ? entry : null
  for (const c of entry.children ?? []) {
    const hit = findFileEntry(c, path)
    if (hit) return hit
  }
  return null
}

/** The first file entry anywhere in the tree (fallback when no main.loom). */
function firstFileEntry(entry: FsEntry): FsEntry | null {
  if (entry.kind === 'file') return entry
  for (const c of entry.children ?? []) {
    const hit = firstFileEntry(c)
    if (hit) return hit
  }
  return null
}

/** Persist one open file to its backend. Server files go through the live
 *  co-editing doc when one exists (the server persists the merged text);
 *  the plain files API stays as the fallback (older server, sync failure). */
async function writeOpenFile(file: OpenFile, formatted: string): Promise<void> {
  if (file.backend === 'server') {
    if (!collabWrite(file.path, formatted)) {
      await projectsApi.putFile(file.projectId!, file.path, formatted)
    }
  } else {
    await writeFileText(file.handle!, formatted)
  }
}

// One live observer per workspace; tied to the current root handle.
let activeObserver: ReturnType<typeof createFsObserver> = null

function stopObserver() {
  if (activeObserver) {
    try { activeObserver.disconnect() } catch { /* ignore */ }
    activeObserver = null
  }
}

export const useWorkspace = create<WorkspaceState>((set, get) => {
  // Re-read a file that changed on disk if it's currently open and clean.
  // (If the user has unsaved edits, we leave them alone — last-write-wins on save.)
  const syncOpenFileFromDisk = async (path: string) => {
    const file = get().openFiles[path]
    if (!file || file.dirty || !file.handle) return
    try {
      const fresh = await readFileText(file.handle)
      if (fresh === file.contents) return
      set((s) => {
        const current = s.openFiles[path]
        if (!current || current.dirty) return {}
        return {
          openFiles: { ...s.openFiles, [path]: { ...current, contents: fresh } },
        }
      })
    } catch {
      // file may have just been deleted; tree refresh will pick it up
    }
  }

  const startObserver = async (root: FsEntry) => {
    stopObserver()
    const rootHandle = root.handle as FileSystemDirectoryHandle
    const rootName = root.name

    let pendingTreeRefresh: ReturnType<typeof setTimeout> | null = null
    const scheduleTreeRefresh = () => {
      if (pendingTreeRefresh) return
      pendingTreeRefresh = setTimeout(() => {
        pendingTreeRefresh = null
        void get().refreshTree()
      }, 50)
    }

    const observer = createFsObserver((records: FsChangeRecord[]) => {
      let structural = false
      for (const r of records) {
        const path = [rootName, ...r.relativePathComponents].join('/')
        if (r.type === 'modified') {
          void syncOpenFileFromDisk(path)
        } else if (r.type === 'disappeared') {
          structural = true
          dropIndexedPath(path) // drop the vanished file from the LSP index
          // close any open file that lived under the removed path
          const open = get().openFiles
          for (const p of Object.keys(open)) {
            if (p === path || p.startsWith(`${path}/`)) {
              set((s) => {
                const { [p]: _, ...rest } = s.openFiles
                const order = s.tabOrder.filter((tp) => tp !== p)
                let nextActive = s.activePath
                if (s.activePath === p) {
                  const idx = s.tabOrder.indexOf(p)
                  nextActive = order[Math.min(idx, order.length - 1)] ?? null
                }
                return { openFiles: rest, tabOrder: order, activePath: nextActive }
              })
            }
          }
        } else {
          structural = true
        }
      }
      if (structural) scheduleTreeRefresh()
    })

    if (!observer) return
    try {
      await observer.observe(rootHandle, { recursive: true })
      activeObserver = observer
    } catch (err) {
      console.warn('FileSystemObserver.observe failed:', err)
    }
  }

  const adoptRoot = async (handle: FileSystemDirectoryHandle) => {
    const tree = await readDirectoryTree(handle)
    set({ root: tree, rootStatus: 'connected' })
    await startObserver(tree)
  }

  // -- live co-editing (server projects) -----------------------------------

  /** A collab doc's text changed (local or remote): follow it in the open
   *  tab (server files are live-synced, never dirty), the synthetic tree,
   *  and the LSP index — so lint + the story graph track co-writers live. */
  const reflectCollabText = (path: string, text: string) => {
    const { root } = get()
    if (root) {
      const entry = findFileEntry(root, path)
      if (entry) entry.content = text
    }
    const file = get().openFiles[path]
    if (file && file.contents !== text) {
      set((s) => {
        const f = s.openFiles[path]
        if (!f || f.contents === text) return {}
        return { openFiles: { ...s.openFiles, [path]: { ...f, contents: text, dirty: false } } }
      })
    }
    syncBuffer(path, text)
  }

  /** Refetch the server project's file list and rebuild the tree: live
   *  collab text overlays the stored rows, empty (not-yet-persisted) folders
   *  survive, vanished files close their tabs + leave the LSP index. */
  const reconcileServerTree = async () => {
    const pid = get().projectId
    if (!pid) return
    let files: ProjectFile[]
    try {
      files = (await projectsApi.get(pid)).files
    } catch {
      return // transient — the next files event retries
    }
    const prev = get().root
    if (get().projectId !== pid) return // project switched mid-fetch
    const fresh = buildServerTree(get().projectName ?? 'project', files)
    for (const p of collectFilePaths(fresh)) {
      const live = collabTextFor(p)
      if (live !== null) {
        const entry = findFileEntry(fresh, p)
        if (entry) entry.content = live
      }
    }
    if (prev) {
      const freshDirs = collectDirs(fresh)
      for (const [dirPath] of collectDirs(prev)) {
        if (!freshDirs.has(dirPath)) ensureServerDir(fresh, dirPath)
      }
    }
    set({ root: fresh })
    // Close tabs (and drop index docs) for files that no longer exist.
    const present = new Set(collectFilePaths(fresh))
    for (const [p, f] of Object.entries(get().openFiles)) {
      if (f.backend !== 'server' || present.has(p)) continue
      dropIndexedPath(p)
      set((s) => {
        const { [p]: _gone, ...rest } = s.openFiles
        const order = s.tabOrder.filter((tp) => tp !== p)
        let nextActive = s.activePath
        if (s.activePath === p) {
          const idx = s.tabOrder.indexOf(p)
          nextActive = order[Math.min(idx, order.length - 1)] ?? null
        }
        return { openFiles: rest, tabOrder: order, activePath: nextActive }
      })
    }
  }

  let pendingReconcile: ReturnType<typeof setTimeout> | null = null
  const scheduleServerReconcile = () => {
    if (pendingReconcile) return
    pendingReconcile = setTimeout(() => {
      pendingReconcile = null
      void reconcileServerTree()
    }, 300)
  }

  /** The API path a new child of `dir` gets (tree paths are project-relative;
   *  only the root node carries the project name). */
  const serverPathFor = (dir: FsEntry, name: string): string => {
    const root = get().root
    return root && dir.path === root.path ? name : `${dir.path}/${name}`
  }

  /** Create + open an empty server file (the tree refresh makes it real). */
  const createServerFile = async (path: string) => {
    const pid = get().projectId
    if (!pid) return
    await projectsApi.putFile(pid, path, '')
    await reconcileServerTree()
    const entry = get().root ? findFileEntry(get().root!, path) : null
    if (entry) await get().openFile(entry)
  }

  return {
    root: null,
    rootStatus: 'idle',
    projectId: null,
    projectName: null,
    openFiles: {},
    tabOrder: [],
    activePath: null,
    recentlyClosed: [],
    cursor: null,
    pendingCursor: null,
    nodes: [],
    edges: [],
    collabGen: 0,

    openRoot: async (handle) => {
      // Fresh workspace: drop previous tabs/canvas state (and any server project).
      stopObserver()
      stopCollab()
      resetIndexCache() // clear the previous project's LSP docs + caches
      set({ projectId: null, projectName: null, openFiles: {}, tabOrder: [], activePath: null, recentlyClosed: [], nodes: [], edges: [] })
      await idbSet(ROOT_HANDLE_KEY, handle)
      await adoptRoot(handle)
    },

    openServerProject: async (project, files) => {
      // Server projects don't use the on-disk observer or handles.
      stopObserver()
      stopCollab()
      resetIndexCache() // clear the previous project's LSP docs + caches
      await idbDel(ROOT_HANDLE_KEY)
      const root = buildServerTree(project.name, files)
      set({
        root,
        rootStatus: 'connected',
        projectId: project.id,
        projectName: project.name,
        openFiles: {},
        tabOrder: [],
        activePath: null,
        recentlyClosed: [],
        nodes: [],
        edges: [],
      })
      // Live co-editing: every open file becomes a shared CRDT doc; the
      // stream also delivers co-writers' file creations/deletions.
      startCollab(project.id, { name: useAuth.getState().user?.name ?? 'Author' }, {
        onText: reflectCollabText,
        onFiles: scheduleServerReconcile,
      })
      const main = findFileEntry(root, 'main.loom') ?? firstFileEntry(root)
      if (main) await get().openFile(main)
    },

    restoreRoot: async () => {
      let handle = await idbGet<FileSystemDirectoryHandle>(ROOT_HANDLE_KEY)
      if (handle && isDesktop()) {
        // Desktop shim handles come back from IndexedDB as plain data
        // (prototype dropped by structured clone) — revive them.
        const revived = await rehydrateDesktopHandle(handle)
        if (!revived) {
          await idbDel(ROOT_HANDLE_KEY)
          return
        }
        handle = revived as unknown as FileSystemDirectoryHandle
      }
      if (!handle) return
      const perm = await queryHandlePermission(handle)
      if (perm === 'granted') {
        await adoptRoot(handle)
        return
      }
      if (perm === 'denied') {
        await idbDel(ROOT_HANDLE_KEY)
        set({ rootStatus: 'denied' })
        return
      }
      // 'prompt' — preserve handle in state so UI can offer to re-grant via a user gesture
      set({
        root: {
          name: handle.name,
          path: handle.name,
          kind: 'directory',
          handle,
          children: [],
        },
        rootStatus: 'needs-permission',
      })
    },

    requestPermission: async () => {
      const root = get().root
      if (!root) return
      const handle = root.handle as FileSystemDirectoryHandle
      const result = await requestHandlePermission(handle)
      if (result === 'granted') await adoptRoot(handle)
      else if (result === 'denied') {
        await idbDel(ROOT_HANDLE_KEY)
        set({ root: null, rootStatus: 'denied' })
      }
    },

    closeRoot: async () => {
      stopObserver()
      stopCollab()
      resetIndexCache() // drop the LSP workspace + index caches
      await idbDel(ROOT_HANDLE_KEY)
      set({
        root: null,
        rootStatus: 'idle',
        projectId: null,
        projectName: null,
        openFiles: {},
        tabOrder: [],
        activePath: null,
        recentlyClosed: [],
        cursor: null,
        nodes: [],
        edges: [],
      })
    },

    refreshTree: async () => {
      const { root, projectId } = get()
      if (!root) return
      if (projectId) {
        await reconcileServerTree() // server projects refresh from the API
        return
      }
      const fresh = await readDirectoryTree(root.handle as FileSystemDirectoryHandle)
      set({ root: fresh })
    },

    openFile: async (entry) => {
      if (entry.kind !== 'file') return
      const existing = get().openFiles[entry.path]
      if (existing) {
        set({ activePath: entry.path })
        return
      }
      let open: OpenFile
      if (entry.backend === 'server') {
        // Join the file's live co-editing doc first: the tab opens on the
        // authoritative merged text and the CodeMirror binding is ready
        // before the first render. Falls back to the loaded snapshot when
        // collab is unavailable.
        const live = await openCollabDoc(entry.path)
        open = {
          path: entry.path,
          backend: 'server',
          projectId: get().projectId ?? undefined,
          contents: live?.text ?? entry.content ?? '',
          dirty: false,
        }
        set((s) => ({ collabGen: s.collabGen + 1 }))
      } else {
        open = { path: entry.path, backend: 'local', handle: entry.handle as FileSystemFileHandle, contents: await readFileText(entry.handle as FileSystemFileHandle), dirty: false }
      }
      set((s) => {
        const hasNode = s.nodes.some((n) => n.id === entry.path)
        return {
          openFiles: { ...s.openFiles, [entry.path]: open },
          tabOrder: s.tabOrder.includes(entry.path) ? s.tabOrder : [...s.tabOrder, entry.path],
          activePath: entry.path,
          nodes: hasNode ? s.nodes : [...s.nodes, buildNodeForPath(entry.path, s.nodes.length)],
        }
      })
    },

    closeFile: async (path) => {
      const open = get().openFiles[path]
      if (!open) return
      if (open.dirty && !(await confirmAction({
        title: 'Discard unsaved changes?',
        body: path,
        confirmLabel: 'Discard',
        danger: true,
      }))) return
      set((s) => {
        const file = s.openFiles[path]
        if (!file) return {}
        const { [path]: _gone, ...rest } = s.openFiles
        const order = s.tabOrder.filter((p) => p !== path)
        let nextActive = s.activePath
        if (s.activePath === path) {
          const idx = s.tabOrder.indexOf(path)
          nextActive = order[Math.min(idx, order.length - 1)] ?? null
        }
        const closed = [{ path, handle: file.handle }, ...s.recentlyClosed.filter((c) => c.path !== path)].slice(0, 20)
        return { openFiles: rest, tabOrder: order, activePath: nextActive, recentlyClosed: closed }
      })
    },

    closeOthers: async (path) => {
      if (!get().openFiles[path]) return
      const dirtyOthers = Object.values(get().openFiles).filter((f) => f.path !== path && f.dirty)
      if (dirtyOthers.length > 0 && !(await confirmAction({
        title: `Discard unsaved changes in ${dirtyOthers.length} other tab(s)?`,
        body: dirtyOthers.map((f) => f.path).join('\n'),
        confirmLabel: 'Discard',
        danger: true,
      }))) return
      set((s) => {
        const keep = s.openFiles[path]
        if (!keep) return {}
        const closedExtras = s.tabOrder
          .filter((p) => p !== path)
          .map((p) => ({ path: p, handle: s.openFiles[p].handle }))
        return {
          openFiles: { [path]: keep },
          tabOrder: [path],
          activePath: path,
          recentlyClosed: [...closedExtras, ...s.recentlyClosed].slice(0, 20),
        }
      })
    },

    closeAll: async () => {
      const dirty = Object.values(get().openFiles).filter((f) => f.dirty)
      if (dirty.length > 0 && !(await confirmAction({
        title: `Discard unsaved changes in ${dirty.length} tab(s)?`,
        body: dirty.map((f) => f.path).join('\n'),
        confirmLabel: 'Discard',
        danger: true,
      }))) return
      set((s) => {
        const closed = s.tabOrder.map((p) => ({ path: p, handle: s.openFiles[p].handle }))
        return {
          openFiles: {},
          tabOrder: [],
          activePath: null,
          recentlyClosed: [...closed, ...s.recentlyClosed].slice(0, 20),
        }
      })
    },

    reopenClosed: async () => {
      const { recentlyClosed } = get()
      const next = recentlyClosed[0]
      if (!next) return
      set({ recentlyClosed: recentlyClosed.slice(1) })
      if (!next.handle) return // server-backed tabs aren't restored from recentlyClosed
      try {
        const contents = await readFileText(next.handle)
        set((s) => ({
          openFiles: {
            ...s.openFiles,
            [next.path]: { path: next.path, backend: 'local', handle: next.handle, contents, dirty: false },
          },
          tabOrder: s.tabOrder.includes(next.path) ? s.tabOrder : [...s.tabOrder, next.path],
          activePath: next.path,
        }))
      } catch {
        // file may have been deleted on disk; just drop it
      }
    },

    setActive: (path) => set({ activePath: path }),

    cycleTab: (delta) => {
      const { tabOrder, activePath } = get()
      if (tabOrder.length === 0) return
      const idx = activePath ? tabOrder.indexOf(activePath) : -1
      const next = (idx + delta + tabOrder.length) % tabOrder.length
      set({ activePath: tabOrder[next] })
    },

    activateTabByIndex: (index) => {
      const { tabOrder } = get()
      const target = tabOrder[index]
      if (target) set({ activePath: target })
    },

    setCursor: (cursor) => set({ cursor }),

    revealAt: async (entry, line, column = 1, opts) => {
      await get().openFile(entry)
      set((s) => ({
        pendingCursor: {
          path: entry.path,
          line,
          column,
          token: (s.pendingCursor?.token ?? 0) + 1,
          focus: opts?.focus ?? true,
        },
      }))
    },

    revealActive: (line, column = 1, opts) => {
      const path = get().activePath
      if (!path) return
      set((s) => ({
        pendingCursor: {
          path,
          line,
          column,
          token: (s.pendingCursor?.token ?? 0) + 1,
          focus: opts?.focus ?? true,
        },
      }))
    },

    updateContents: (path, contents) => {
      const file = get().openFiles[path]
      if (!file) return
      // Server files under live co-editing: fold the new text into the
      // shared doc (a no-op for CodeMirror-originated edits — the binding
      // already applied them) and stay clean — the server persists.
      if (file.backend === 'server' && collabWrite(path, contents)) {
        set((s) => {
          const f = s.openFiles[path]
          if (!f || f.contents === contents) return {}
          return { openFiles: { ...s.openFiles, [path]: { ...f, contents, dirty: false } } }
        })
        return
      }
      set((s) => {
        const f = s.openFiles[path]
        if (!f) return {}
        return {
          openFiles: {
            ...s.openFiles,
            [path]: { ...f, contents, dirty: contents !== f.contents || f.dirty },
          },
        }
      })
    },

    saveActive: async () => {
      const { activePath, openFiles } = get()
      if (!activePath) return
      const file = openFiles[activePath]
      if (!file) return
      const formatOnSave = useSettings.getState().formatOnSave
      const formatted = formatOnSave ? applyFormat(file.contents) : file.contents
      await writeOpenFile(file, formatted)
      set((s) => ({
        openFiles: {
          ...s.openFiles,
          [activePath]: { ...file, contents: formatted, dirty: false },
        },
      }))
    },

    saveAll: async () => {
      const formatOnSave = useSettings.getState().formatOnSave
      const files = Object.values(get().openFiles).filter((f) => f.dirty)
      const updates = files.map((f) => ({
        path: f.path,
        formatted: formatOnSave ? applyFormat(f.contents) : f.contents,
        file: f,
      }))
      await Promise.all(updates.map((u) => writeOpenFile(u.file, u.formatted)))
      set((s) => {
        const next = { ...s.openFiles }
        for (const u of updates) next[u.path] = { ...next[u.path], contents: u.formatted, dirty: false }
        return { openFiles: next }
      })
    },

    createNewFile: async (name) => {
      const { root, refreshTree } = get()
      if (!root) {
        await notify({ title: 'Open a folder first.' })
        return
      }
      const trimmedName = name.trim()
      if (!trimmedName) return
      if (get().projectId) {
        await createServerFile(trimmedName)
        return
      }
      const handle = await createFile(root.handle as FileSystemDirectoryHandle, name)
      await writeFileText(handle, '')
      await refreshTree()
      const path = `${root.name}/${name}`
      set((s) => ({
        openFiles: {
          ...s.openFiles,
          [path]: { path, handle, backend: 'local', contents: '', dirty: false },
        },
        tabOrder: s.tabOrder.includes(path) ? s.tabOrder : [...s.tabOrder, path],
        activePath: path,
        nodes: [...s.nodes, buildNodeForPath(path, s.nodes.length)],
      }))
    },

    createFileIn: async (dir, name) => {
      if (dir.kind !== 'directory') return
      const trimmed = name.trim()
      if (!trimmed) return
      if (get().projectId) {
        await createServerFile(serverPathFor(dir, trimmed))
        return
      }
      const handle = await createFile(dir.handle as FileSystemDirectoryHandle, trimmed)
      await writeFileText(handle, '')
      await get().refreshTree()
      const path = `${dir.path}/${trimmed}`
      set((s) => ({
        openFiles: {
          ...s.openFiles,
          [path]: { path, handle, backend: 'local', contents: '', dirty: false },
        },
        tabOrder: s.tabOrder.includes(path) ? s.tabOrder : [...s.tabOrder, path],
        activePath: path,
      }))
    },

    createDirectoryIn: async (dir, name) => {
      if (dir.kind !== 'directory') return
      const trimmed = name.trim()
      if (!trimmed) return
      if (get().projectId) {
        // Server storage is path-keyed — a folder becomes real when its
        // first file lands. Show it locally so files can be created inside.
        const root = get().root
        if (!root) return
        ensureServerDir(root, serverPathFor(dir, trimmed))
        set({ root: { ...root } })
        return
      }
      await createDirectory(dir.handle as FileSystemDirectoryHandle, trimmed)
      await get().refreshTree()
    },

    deleteEntry: async (parent, entry) => {
      if (parent.kind !== 'directory') return
      const label = entry.kind === 'directory' ? `folder “${entry.name}” and all its contents` : `file “${entry.name}”`
      if (!(await confirmAction({
        title: `Delete ${label}?`,
        body: 'This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      }))) return
      const pid = get().projectId
      if (pid) {
        // Server storage is per-file: delete every file under the entry.
        for (const p of collectFilePaths(entry)) {
          await projectsApi.deleteFile(pid, p)
          dropCollabDoc(p)
        }
        // Prune locally too (an empty deleted folder isn't server-known and
        // would otherwise be preserved by the reconcile's empty-dir carry).
        const root = get().root
        if (root) {
          pruneEntry(root, entry.path)
          set({ root: { ...root } })
        }
      } else {
        await removeEntry(parent.handle as FileSystemDirectoryHandle, entry.name, entry.kind === 'directory')
      }
      // Drop the removed file(s) from the LSP index immediately (the gated
      // reindex only prunes when whole-project indexing is on).
      for (const p of Object.keys(get().openFiles)) {
        if (p === entry.path || p.startsWith(`${entry.path}/`)) dropIndexedPath(p)
      }
      dropIndexedPath(entry.path)
      // close any open file that lived under the removed path
      set((s) => {
        const next = { ...s.openFiles }
        let order = [...s.tabOrder]
        let activePath = s.activePath
        for (const p of Object.keys(next)) {
          if (p === entry.path || p.startsWith(`${entry.path}/`)) {
            delete next[p]
            const idx = order.indexOf(p)
            order = order.filter((tp) => tp !== p)
            if (activePath === p) activePath = order[Math.min(idx, order.length - 1)] ?? null
          }
        }
        return { openFiles: next, tabOrder: order, activePath }
      })
      await get().refreshTree()
    },

    renameEntry: async (parent, entry, newName) => {
      const trimmed = newName.trim()
      if (!trimmed || trimmed === entry.name) return
      const pid = get().projectId
      const oldPath = entry.path
      const newPath = pid ? serverPathFor(parent, trimmed) : `${parent.path}/${trimmed}`
      if (pid) {
        // Server rename = copy + delete per file (live text wins over the
        // stored row, so an in-flight co-edit isn't lost).
        for (const from of collectFilePaths(entry)) {
          const to = `${newPath}${from.slice(oldPath.length)}`
          const content =
            collabTextFor(from) ??
            get().openFiles[from]?.contents ??
            (get().root ? (findFileEntry(get().root!, from)?.content ?? '') : '')
          await projectsApi.putFile(pid, to, content)
          await projectsApi.deleteFile(pid, from)
          dropCollabDoc(from)
        }
        const root = get().root
        if (root) {
          pruneEntry(root, oldPath)
          set({ root: { ...root } })
        }
      } else {
        const ok = await renameHandle(entry.handle as FileSystemFileHandle | FileSystemDirectoryHandle, trimmed)
        if (!ok) {
          await notify({ title: 'Rename is not supported in this browser version.' })
          return
        }
      }
      // Drop old URIs from the LSP index; the reindex re-adds under the new
      // path (and the active-buffer sync covers a renamed open file).
      for (const p of Object.keys(get().openFiles)) {
        if (p === oldPath || p.startsWith(`${oldPath}/`)) dropIndexedPath(p)
      }
      dropIndexedPath(oldPath)
      set((s) => {
        const next: typeof s.openFiles = {}
        const order = s.tabOrder.map((p) => {
          if (p === oldPath) return newPath
          if (p.startsWith(`${oldPath}/`)) return `${newPath}${p.slice(oldPath.length)}`
          return p
        })
        for (const [p, file] of Object.entries(s.openFiles)) {
          if (p === oldPath) next[newPath] = { ...file, path: newPath }
          else if (p.startsWith(`${oldPath}/`)) {
            const remapped = `${newPath}${p.slice(oldPath.length)}`
            next[remapped] = { ...file, path: remapped }
          } else {
            next[p] = file
          }
        }
        const activePath =
          s.activePath === oldPath
            ? newPath
            : s.activePath?.startsWith(`${oldPath}/`)
              ? `${newPath}${s.activePath.slice(oldPath.length)}`
              : s.activePath
        return { openFiles: next, tabOrder: order, activePath }
      })
      await get().refreshTree()
      if (pid) {
        // Rejoin the live docs under the new paths for still-open tabs.
        for (const [p, f] of Object.entries(get().openFiles)) {
          if (f.backend !== 'server') continue
          if (p === newPath || p.startsWith(`${newPath}/`)) {
            void openCollabDoc(p).then(() => set((s) => ({ collabGen: s.collabGen + 1 })))
          }
        }
      }
    },

    setNodes: (updater) =>
      set((s) => ({ nodes: typeof updater === 'function' ? updater(s.nodes) : updater })),

    setEdges: (updater) =>
      set((s) => ({ edges: typeof updater === 'function' ? updater(s.edges) : updater })),
  }
})
