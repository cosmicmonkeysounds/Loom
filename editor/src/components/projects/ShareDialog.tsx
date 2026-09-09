//! Owner-side collaboration roster for one project: share it with an email
//! address, see who's on it, see who's been invited but hasn't joined yet.
//!
//! The server emails the invite when a mail transport is configured and
//! tells us how it went out (`delivery`); when it's `none` the owner gets
//! the invite link right here to pass along by hand, so sharing works on
//! any deployment. Members get the project under "Shared with you" — full
//! file editing plus run/moderation rights on its events; only the owner
//! can rename, delete, or manage this roster.

import { useEffect, useState } from 'react'
import { membersApi, type PendingInvite, type ProjectMember, type ShareResult } from '@/lib/api'

type Outcome = ShareResult['notified']

export function ShareDialog({ projectId, projectName, onClose }: { projectId: string; projectName: string; onClose: () => void }) {
  const [members, setMembers] = useState<ProjectMember[] | null>(null)
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  useEffect(() => {
    let alive = true
    membersApi
      .list(projectId)
      .then((r) => {
        if (!alive) return
        setMembers(r.members)
        setInvites(r.invites)
      })
      .catch((e: Error) => alive && setErr(e.message))
    return () => {
      alive = false
    }
  }, [projectId])

  const share = async (addr: string) => {
    if (addr === '' || busy) return
    setBusy(true)
    setErr(null)
    setOutcome(null)
    try {
      const r = await membersApi.add(projectId, addr)
      setMembers(r.members)
      setInvites(r.invites)
      setOutcome(r.notified)
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

  const revoke = async (inviteId: string) => {
    setErr(null)
    try {
      await membersApi.revokeInvite(projectId, inviteId)
      setInvites((l) => l.filter((x) => x.id !== inviteId))
      setOutcome(null)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[28rem] max-w-[92vw] rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-zinc-100 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="share-dialog"
      >
        <h2 className="mb-1 text-sm font-semibold">Share “{projectName}”</h2>
        <p className="mb-3 text-xs text-zinc-400">
          Collaborators can edit the project and run its events. They get an email with a link; no account needed yet — they can
          sign up from it.
        </p>

        <div className="mb-3 flex gap-2">
          <input
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
            placeholder="collaborator@email.com"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void share(email.trim())}
            autoFocus
            data-testid="share-email"
          />
          <button
            onClick={() => void share(email.trim())}
            disabled={busy || email.trim() === ''}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            data-testid="share-submit"
          >
            {busy ? 'Sending…' : 'Invite'}
          </button>
        </div>

        {err && <div className="mb-2 text-xs text-red-400">{err}</div>}
        {outcome && <OutcomeNote outcome={outcome} />}

        <Section title="Collaborators">
          {members === null ? (
            <Muted>Loading…</Muted>
          ) : members.length === 0 ? (
            <Muted>No collaborators yet — just you.</Muted>
          ) : (
            <ul className="flex flex-col gap-1">
              {members.map((m) => (
                <Row key={m.userId} primary={m.name ?? m.email ?? m.userId} secondary={m.name ? m.email : null}>
                  <RowAction onClick={() => void remove(m.userId)} danger>
                    Remove
                  </RowAction>
                </Row>
              ))}
            </ul>
          )}
        </Section>

        {invites.length > 0 && (
          <Section title="Invited, not joined yet">
            <ul className="flex flex-col gap-1">
              {invites.map((i) => (
                <Row key={i.id} primary={i.email} secondary={`invited ${new Date(i.createdAt).toLocaleDateString()}`}>
                  <CopyButton text={i.url} />
                  <RowAction onClick={() => void share(i.email)} disabled={busy}>
                    Resend
                  </RowAction>
                  <RowAction onClick={() => void revoke(i.id)} danger>
                    Revoke
                  </RowAction>
                </Row>
              ))}
            </ul>
          </Section>
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

/** What happened to the last share: emailed, or here's the link. */
function OutcomeNote({ outcome }: { outcome: Outcome }) {
  const who = outcome.to
  if (outcome.delivery !== 'none') {
    return (
      <div className="mb-3 rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200" data-testid="share-outcome">
        Invitation emailed to <span className="font-medium">{who}</span>.{' '}
        {outcome.hasAccount ? 'They already have an account, so the project is in their list now.' : 'They can sign up straight from the link.'}
      </div>
    )
  }
  return (
    <div className="mb-3 rounded-lg border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-100" data-testid="share-outcome">
      <div>
        {outcome.hasAccount ? (
          <>
            <span className="font-medium">{who}</span> has been added — but this server can’t send email, so let them know yourself:
          </>
        ) : (
          <>
            This server can’t send email. Send <span className="font-medium">{who}</span> this link — it lets them sign up and join:
          </>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-black/30 px-2 py-1 text-[11px] text-amber-50" title={outcome.url}>
          {outcome.url}
        </code>
        <CopyButton text={outcome.url} />
      </div>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 1500)
    } catch {
      window.prompt('Copy this link', text)
    }
  }
  return (
    <RowAction onClick={() => void copy()} testid="share-copy-link">
      {done ? 'Copied' : 'Copy link'}
    </RowAction>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{title}</div>
      {children}
    </div>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div className="py-1 text-xs text-zinc-500">{children}</div>
}

function Row({ primary, secondary, children }: { primary: string; secondary?: string | null; children: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-lg bg-zinc-800/60 px-3 py-1.5">
      <div className="min-w-0">
        <div className="truncate text-sm">{primary}</div>
        {secondary && <div className="truncate text-xs text-zinc-500">{secondary}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">{children}</div>
    </li>
  )
}

function RowAction({
  onClick,
  children,
  danger,
  disabled,
  testid,
}: {
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
  disabled?: boolean
  testid?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className={`rounded px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-700 disabled:opacity-50 ${danger ? 'hover:text-red-400' : 'hover:text-zinc-200'}`}
    >
      {children}
    </button>
  )
}
