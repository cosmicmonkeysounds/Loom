//! Owner-side collaboration roster for one project: list the invited
//! authors, invite another by the email they signed up with, remove one.
//! Members get the project under "Shared with you" — full file editing plus
//! run/moderation rights on its events; only the owner can rename, delete,
//! or manage this roster.

import { useEffect, useState } from 'react'
import { membersApi, type ProjectMember } from '@/lib/api'

export function ShareDialog({ projectId, projectName, onClose }: { projectId: string; projectName: string; onClose: () => void }) {
  const [members, setMembers] = useState<ProjectMember[] | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    membersApi
      .list(projectId)
      .then((m) => alive && setMembers(m))
      .catch((e: Error) => alive && setErr(e.message))
    return () => {
      alive = false
    }
  }, [projectId])

  const invite = async () => {
    const addr = email.trim()
    if (addr === '' || busy) return
    setBusy(true)
    setErr(null)
    try {
      setMembers(await membersApi.add(projectId, addr))
      setEmail('')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (userId: string) => {
    setErr(null)
    try {
      await membersApi.remove(projectId, userId)
      setMembers((m) => (m ? m.filter((x) => x.userId !== userId) : m))
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[26rem] max-w-[90vw] rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-zinc-100 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-sm font-semibold">Share “{projectName}”</h2>
        <p className="mb-3 text-xs text-zinc-400">
          Collaborators can edit the project and run its events. Invite by the email they signed up with.
        </p>

        <div className="mb-3 flex gap-2">
          <input
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
            placeholder="collaborator@email.com"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void invite()}
            autoFocus
          />
          <button
            onClick={() => void invite()}
            disabled={busy || email.trim() === ''}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? 'Inviting…' : 'Invite'}
          </button>
        </div>

        {err && <div className="mb-2 text-xs text-red-400">{err}</div>}

        {members === null ? (
          <div className="py-2 text-xs text-zinc-500">Loading…</div>
        ) : members.length === 0 ? (
          <div className="py-2 text-xs text-zinc-500">No collaborators yet — just you.</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center justify-between rounded-lg bg-zinc-800/60 px-3 py-1.5">
                <div className="min-w-0">
                  <div className="truncate text-sm">{m.name ?? m.email ?? m.userId}</div>
                  {m.email && <div className="truncate text-xs text-zinc-500">{m.email}</div>}
                </div>
                <button
                  onClick={() => void remove(m.userId)}
                  className="ml-3 shrink-0 rounded px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-700 hover:text-red-400"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
