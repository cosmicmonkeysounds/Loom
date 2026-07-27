//! Godot integration (desktop only) — the Wwise model: the authoring app
//! links a game project, installs the engine-side runtime into it, and
//! builds banks straight into the project tree. Compilation happens here
//! in the webview (`@loom/bank` over the indexed project sources); the
//! Tauri host only validates paths and writes files.

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { compileSources, gdscriptHeader } from '@loom/bank'
import { desktopGodot, type GodotProjectStatus } from '@/lib/desktop'
import { lspWorkspaceSync, pathForUri } from '@/lib/lsp-client'

export type GodotBusy = 'pick' | 'refresh' | 'install' | 'build' | null

export type GodotBuildResult = {
  written: string[]
  programs: number
  texts: number
  hooks: number
  errors: string[]
  warnings: string[]
  finishedAt: number
}

/** The project's `.loom` sources, spine file first (the CLI's convention —
 *  `main.loom` carries the `entry:` header). */
export function gatherLoomSources(): { path: string; source: string }[] {
  const ws = lspWorkspaceSync()
  return [...ws.docs]
    .map(([uri, doc]) => ({ path: pathForUri(uri), source: doc.text }))
    .filter((s) => s.path.endsWith('.loom'))
    .sort((a, b) => {
      const am = a.path.endsWith('main.loom') ? 0 : 1
      const bm = b.path.endsWith('main.loom') ? 0 : 1
      return am - bm || a.path.localeCompare(b.path)
    })
}

type GodotState = {
  /** Absolute path of the linked Godot project (persisted). */
  projectPath: string | null
  status: GodotProjectStatus | null
  bankName: string
  bankFolder: string
  busy: GodotBusy
  error: string | null
  lastBuild: GodotBuildResult | null

  pickProject: () => Promise<void>
  refresh: () => Promise<void>
  unlink: () => void
  installAddon: () => Promise<void>
  buildBanks: () => Promise<void>
  setBankName: (name: string) => void
  setBankFolder: (folder: string) => void
}

export const useGodot = create<GodotState>()(
  persist(
    (set, get) => ({
      projectPath: null,
      status: null,
      bankName: 'main',
      bankFolder: 'loom',
      busy: null,
      error: null,
      lastBuild: null,

      pickProject: async () => {
        set({ busy: 'pick', error: null })
        try {
          const status = await desktopGodot.pickProject()
          if (status) set({ projectPath: status.path, status })
        } catch (err) {
          set({ error: String(err) })
        } finally {
          set({ busy: null })
        }
      },

      refresh: async () => {
        const path = get().projectPath
        if (!path) return
        set({ busy: 'refresh', error: null })
        try {
          set({ status: await desktopGodot.projectStatus(path) })
        } catch (err) {
          // The linked project moved or is no longer a Godot project.
          set({ status: null, error: String(err) })
        } finally {
          set({ busy: null })
        }
      },

      unlink: () => set({ projectPath: null, status: null, lastBuild: null, error: null }),

      installAddon: async () => {
        const path = get().projectPath
        if (!path) return
        set({ busy: 'install', error: null })
        try {
          await desktopGodot.installAddon(path, true)
          set({ status: await desktopGodot.projectStatus(path) })
        } catch (err) {
          set({ error: String(err) })
        } finally {
          set({ busy: null })
        }
      },

      buildBanks: async () => {
        const { projectPath, bankName, bankFolder } = get()
        if (!projectPath) return
        set({ busy: 'build', error: null })
        try {
          const sources = gatherLoomSources()
          if (sources.length === 0) throw new Error('no .loom files in the open project')
          const bank = compileSources(sources, { bankName })
          const errors = bank.diagnostics
            .filter((d) => d.severity === 'error')
            .map((d) => `[${d.code}] ${d.message}`)
          const warnings = bank.diagnostics
            .filter((d) => d.severity === 'warning')
            .map((d) => `[${d.code}] ${d.message}`)
          let written: string[] = []
          if (errors.length === 0) {
            written = await desktopGodot.writeBanks(projectPath, bankFolder, [
              { name: `${bankName}.loombank`, text: JSON.stringify(bank, null, 2) },
              { name: 'LoomIDs.gd', text: gdscriptHeader(bank) },
            ])
          }
          set({
            lastBuild: {
              written,
              programs: bank.programs.length,
              texts: bank.texts.length,
              hooks: bank.hooks.length,
              errors,
              warnings,
              finishedAt: Date.now(),
            },
            status: await desktopGodot.projectStatus(projectPath),
          })
        } catch (err) {
          set({ error: String(err) })
        } finally {
          set({ busy: null })
        }
      },

      setBankName: (bankName) => set({ bankName }),
      setBankFolder: (bankFolder) => set({ bankFolder }),
    }),
    {
      name: 'loom-godot',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        projectPath: s.projectPath,
        bankName: s.bankName,
        bankFolder: s.bankFolder,
      }),
    },
  ),
)
