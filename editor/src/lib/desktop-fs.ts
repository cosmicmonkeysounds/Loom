/**
 * A File-System-Access-shaped shim over the desktop app's Tauri fs
 * commands. WKWebView (and WebView2 outside Chromium's picker flow) has
 * no `showDirectoryPicker`, so on desktop the editor's local-folder
 * backend runs on these handle lookalikes instead — they implement
 * exactly the method surface `lib/fs.ts` + `store/workspace.ts` use
 * (`entries`, `getFileHandle`, `getDirectoryHandle`, `removeEntry`,
 * `getFile`, `createWritable`, `move`, `query/requestPermission`), so
 * everything downstream of `pickDirectory()` works unchanged.
 *
 * Persistence: these instances survive `structuredClone` (IndexedDB) as
 * plain `{kind, name, path}` objects — prototypes are dropped, data
 * fields are kept — and `rehydrateDesktopHandle` turns the stored shape
 * back into a live handle on startup. Native paths mean there is no
 * permission dance: permissions always report 'granted'.
 */

import { desktopFs } from './desktop'

function baseName(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function parentOf(path: string): string {
  const sep = path.includes('\\') && !path.includes('/') ? '\\' : '/'
  const parts = path.split(/[/\\]/)
  parts.pop()
  return parts.join(sep)
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`
}

export class DesktopFileHandle {
  kind = 'file' as const
  name: string
  path: string

  constructor(path: string) {
    this.path = path
    this.name = baseName(path)
  }

  async getFile(): Promise<File> {
    const { text, modifiedMs } = await desktopFs.readFile(this.path)
    return new File([text], this.name, { lastModified: modifiedMs })
  }

  async createWritable(): Promise<{ write: (c: string) => Promise<void>; close: () => Promise<void> }> {
    let buffer = ''
    const path = this.path
    return {
      write: async (contents: string) => {
        buffer = contents
      },
      close: async () => {
        await desktopFs.writeText(path, buffer)
      },
    }
  }

  async move(newName: string): Promise<void> {
    const dest = joinPath(parentOf(this.path), newName)
    await desktopFs.rename(this.path, dest)
    this.path = dest
    this.name = newName
  }

  async queryPermission(): Promise<'granted'> {
    return 'granted'
  }

  async requestPermission(): Promise<'granted'> {
    return 'granted'
  }
}

export class DesktopDirectoryHandle {
  kind = 'directory' as const
  name: string
  path: string

  constructor(path: string) {
    this.path = path
    this.name = baseName(path)
  }

  async *entries(): AsyncIterableIterator<[string, DesktopFileHandle | DesktopDirectoryHandle]> {
    const listed = await desktopFs.list(this.path)
    for (const entry of listed) {
      const child = joinPath(this.path, entry.name)
      yield [entry.name, entry.isDir ? new DesktopDirectoryHandle(child) : new DesktopFileHandle(child)]
    }
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<DesktopFileHandle> {
    const child = joinPath(this.path, name)
    const stat = await desktopFs.stat(child)
    if (!stat.exists) {
      if (!opts?.create) throw new DOMException(`${name} not found`, 'NotFoundError')
      await desktopFs.touch(child)
    } else if (stat.isDir) {
      throw new DOMException(`${name} is a directory`, 'TypeMismatchError')
    }
    return new DesktopFileHandle(child)
  }

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DesktopDirectoryHandle> {
    const child = joinPath(this.path, name)
    const stat = await desktopFs.stat(child)
    if (!stat.exists) {
      if (!opts?.create) throw new DOMException(`${name} not found`, 'NotFoundError')
      await desktopFs.createDir(child)
    } else if (!stat.isDir) {
      throw new DOMException(`${name} is a file`, 'TypeMismatchError')
    }
    return new DesktopDirectoryHandle(child)
  }

  async removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void> {
    await desktopFs.remove(joinPath(this.path, name), opts?.recursive ?? false)
  }

  async move(newName: string): Promise<void> {
    const dest = joinPath(parentOf(this.path), newName)
    await desktopFs.rename(this.path, dest)
    this.path = dest
    this.name = newName
  }

  async queryPermission(): Promise<'granted'> {
    return 'granted'
  }

  async requestPermission(): Promise<'granted'> {
    return 'granted'
  }
}

/** Native folder picker → live handle, or null on cancel. */
export async function pickDesktopDirectory(): Promise<DesktopDirectoryHandle | null> {
  const path = await desktopFs.pickFolder()
  return path === null ? null : new DesktopDirectoryHandle(path)
}

/**
 * Revive a handle that round-tripped IndexedDB (prototype lost). Returns
 * null when the shape is wrong or the directory no longer exists.
 */
export async function rehydrateDesktopHandle(
  persisted: unknown,
): Promise<DesktopDirectoryHandle | null> {
  if (typeof persisted !== 'object' || persisted === null) return null
  const { kind, path } = persisted as { kind?: unknown; path?: unknown }
  if (kind !== 'directory' || typeof path !== 'string') return null
  const stat = await desktopFs.stat(path)
  if (!stat.exists || !stat.isDir) return null
  return new DesktopDirectoryHandle(path)
}
