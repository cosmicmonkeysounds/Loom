//! The author's projects (SaaS). Backs the launchpad, and opening a project
//! loads its `.loom` files into the workspace store as an editable tree.

import { create } from 'zustand'
import { invitesApi, membersApi, projectsApi, type ProjectSummary } from '@/lib/api'
import { clearLinkIntent, peekLinkIntent } from '@/lib/invite-link'
import { notify } from '@/store/dialog'
import { useWorkspace } from '@/store/workspace'

type ProjectsState = {
  projects: ProjectSummary[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  currentId: string | null
  currentName: string | null
  load: () => Promise<void>
  create: (name: string, template?: string) => Promise<ProjectSummary>
  open: (id: string) => Promise<void>
  close: () => Promise<void>
  remove: (id: string) => Promise<void>
  /** Leave a project that was shared with you (self-removal). */
  leave: (id: string) => Promise<void>
  /** Accept a share-by-link invite; the project lands in the list. */
  acceptInvite: (token: string) => Promise<ProjectSummary | null>
  /**
   * Act on the deep link parked at boot (`?invite=` / `?project=`), once
   * signed in: accept the invite and/or open the project. Idempotent —
   * the intent is cleared whether it succeeds or fails.
   */
  consumePendingLink: () => Promise<void>
}

export const useProjects = create<ProjectsState>((set, get) => ({
  projects: [],
  status: 'idle',
  error: null,
  currentId: null,
  currentName: null,

  load: async () => {
    set({ status: 'loading', error: null })
    try {
      set({ projects: await projectsApi.list(), status: 'ready' })
    } catch (e) {
      set({ status: 'error', error: (e as Error).message })
    }
  },

  create: async (name, template) => {
    const p = await projectsApi.create(name, template)
    set((s) => ({ projects: [p, ...s.projects.filter((x) => x.id !== p.id)] }))
    return p
  },

  open: async (id) => {
    const { project, files } = await projectsApi.get(id)
    await useWorkspace.getState().openServerProject({ id: project.id, name: project.name }, files)
    set({ currentId: project.id, currentName: project.name })
  },

  close: async () => {
    await useWorkspace.getState().closeRoot()
    set({ currentId: null, currentName: null })
  },

  remove: async (id) => {
    await projectsApi.remove(id)
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }))
    if (get().currentId === id) await get().close()
  },

  leave: async (id) => {
    await membersApi.remove(id)
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }))
    if (get().currentId === id) await get().close()
  },

  acceptInvite: async (token) => {
    const p = await invitesApi.accept(token)
    if (p !== null) set((s) => ({ projects: [p, ...s.projects.filter((x) => x.id !== p.id)] }))
    return p
  },

  consumePendingLink: async () => {
    const intent = peekLinkIntent()
    if (intent === null) return
    clearLinkIntent()
    try {
      if (intent.kind === 'invite') {
        const p = await get().acceptInvite(intent.token)
        if (p === null) return
        await notify({ title: `You're in`, body: `“${p.name}” is now shared with you.` })
        await get().open(p.id)
      } else {
        await get().open(intent.id)
      }
    } catch (e) {
      await notify({ title: 'Couldn’t open that link', body: (e as Error).message })
    }
  },
}))
