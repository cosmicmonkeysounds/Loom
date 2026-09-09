import { useEffect } from 'react'
import { StudioShell } from '@/components/studio/StudioShell'
import { TopBar } from '@/components/studio/TopBar'
import { StatusBar } from '@/components/shell/StatusBar'
import { CommandPalette } from '@/components/shell/CommandPalette'
import { SettingsPanel } from '@/components/shell/SettingsPanel'
import { ContextMenuHost } from '@/components/shell/ContextMenu'
import { DialogHost } from '@/components/shell/DialogHost'
import { HelpOverlay } from '@/components/help/HelpOverlay'
import { AuthGate } from '@/components/auth/AuthGate'
import { ProjectsLaunchpad } from '@/components/projects/ProjectsLaunchpad'
import { useWorkspace } from '@/store/workspace'
import { useSettings } from '@/store/settings'
import { useAuth } from '@/store/auth'
import { useProjects } from '@/store/projects'
import { captureLinkFromLocation } from '@/lib/invite-link'

export default function App() {
  const restoreRoot = useWorkspace((s) => s.restoreRoot)
  const root = useWorkspace((s) => s.root)
  const theme = useSettings((s) => s.theme)
  const authStatus = useAuth((s) => s.status)
  const refreshAuth = useAuth((s) => s.refresh)

  const consumePendingLink = useProjects((s) => s.consumePendingLink)

  useEffect(() => {
    // A share-email link (`?invite=` / `?project=`) is parked before the
    // sign-in round-trip and acted on below once there's a session.
    const linked = captureLinkFromLocation() !== null
    void refreshAuth()
    // A link takes precedence over re-opening last session's workspace.
    if (!linked) void restoreRoot()
  }, [refreshAuth, restoreRoot])
  useEffect(() => {
    if (authStatus === 'signed-in' && root === null) void consumePendingLink()
  }, [authStatus, root, consumePendingLink])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return (
    <>
      {body(root !== null, authStatus)}
      {/* Mounted outside every branch: the launchpad and the auth gate
          raise dialogs too (delete project, unsupported browser). */}
      <DialogHost />
    </>
  )
}

function body(hasRoot: boolean, authStatus: string) {
  // A workspace (local folder or server project) is open → the Studio shell.
  if (hasRoot) {
    return (
      <div className="h-full w-full flex flex-col">
        <TopBar />
        <main className="flex-1 min-h-0">
          <StudioShell />
        </main>
        <StatusBar />
        <CommandPalette />
        <SettingsPanel />
        <ContextMenuHost />
        <HelpOverlay />
      </div>
    )
  }

  // Otherwise gate on the author account: signed in → launchpad, else login.
  if (authStatus === 'loading') {
    return <div className="h-full w-full grid place-items-center bg-zinc-950 text-zinc-500 text-sm">Loading…</div>
  }
  if (authStatus === 'signed-in') return <ProjectsLaunchpad />
  return <AuthGate />
}
