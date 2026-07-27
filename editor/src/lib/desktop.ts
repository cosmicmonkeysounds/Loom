/**
 * Detection + typed command bindings for the Tauri desktop shell
 * (`desktop/src-tauri`). Everything here is inert in the browser build:
 * `isDesktop()` is false, and no command is ever invoked.
 */

import { invoke } from '@tauri-apps/api/core'

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

// ---- filesystem bridge (backs lib/desktop-fs.ts) -------------------------

export type DesktopDirEntry = { name: string; isDir: boolean }
export type DesktopFileContents = { text: string; modifiedMs: number }
export type DesktopStat = { exists: boolean; isDir: boolean; modifiedMs: number }

export const desktopFs = {
  pickFolder: () => invoke<string | null>('fs_pick_folder'),
  list: (path: string) => invoke<DesktopDirEntry[]>('fs_list', { path }),
  readFile: (path: string) => invoke<DesktopFileContents>('fs_read_file', { path }),
  writeText: (path: string, contents: string) => invoke<void>('fs_write_text', { path, contents }),
  touch: (path: string) => invoke<void>('fs_touch', { path }),
  createDir: (path: string) => invoke<void>('fs_create_dir', { path }),
  remove: (path: string, recursive: boolean) => invoke<void>('fs_remove', { path, recursive }),
  rename: (from: string, to: string) => invoke<void>('fs_rename', { from, to }),
  stat: (path: string) => invoke<DesktopStat>('fs_stat', { path }),
  reveal: (path: string) => invoke<void>('reveal_path', { path }),
}

// ---- Godot integration (Wwise-style; backs store/godot.ts) ---------------

export type GodotBankInfo = { path: string; modifiedMs: number }

export type GodotProjectStatus = {
  name: string | null
  path: string
  addonInstalled: boolean
  addonVersion: string | null
  bundledAddonVersion: string | null
  pluginEnabled: boolean
  banks: GodotBankInfo[]
}

export type GodotInstallReport = { filesWritten: number; pluginEnabled: boolean }

export const desktopGodot = {
  /** Native picker; errors if the chosen folder is not a Godot project. */
  pickProject: () => invoke<GodotProjectStatus | null>('godot_pick_project'),
  projectStatus: (path: string) => invoke<GodotProjectStatus>('godot_project_status', { path }),
  installAddon: (path: string, enablePlugin: boolean) =>
    invoke<GodotInstallReport>('godot_install_addon', { path, enablePlugin }),
  writeBanks: (path: string, subdir: string, files: { name: string; text: string }[]) =>
    invoke<string[]>('godot_write_banks', { path, subdir, files }),
}
