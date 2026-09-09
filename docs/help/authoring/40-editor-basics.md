---
title: Editor basics — projects & modes
section: The Editor
order: 40
keywords: editor, project, account, sign in, local folder, modes, mode bar, writing, run, integrations, deploy, save, launchpad, files, share, collaborate, invite, co-writer
---

## Two ways to keep a project

- **Server projects** — sign in (email/password) and your `.loom` files
  live on the Loom server. This unlocks the whole live-event pipeline:
  launching events, join codes, moderating from Run mode.
- **A local folder** — no account needed. Open any folder of `.loom`
  files with the folder picker (Chromium-based browsers). Everything in
  Writing and Run's Sim source works; Live/Deploy need a server project.

The **Projects launchpad** (what you see after signing in) creates and
opens server projects, and is where you share them.

## Sharing a project with co-writers

**Share** on a project row (owners only) opens the roster. Enter a
co-writer's email and they get an email with a link:

- If they already have a Loom account, the project appears under
  **Shared with you** on their launchpad right away.
- If not, the link takes them to sign-up; creating an account (or signing
  up later with that same email address) puts the project on their list.

Until they join, they're listed as **invited** — you can copy the link to
send it another way, resend the email, or revoke it. Collaborators edit
files live alongside you (you'll see their cursors) and can launch and
moderate the project's events. Renaming, deleting, and managing the
roster stay with the owner; a collaborator can **Leave** from their
launchpad. If your server has no email provider configured, the dialog
shows you the invite link to pass along yourself.

## The four modes

The bottom **Mode Bar** switches the whole studio between four modes:

| Mode | Key | Is |
|---|---|---|
| **Writing** | `⌘1` | the authoring surface — text editor ⇄ story graph, side by side |
| **Run** | `⌘2` | one cockpit with a **Sim ⇄ Live** switch — rehearse locally, or moderate the launched event |
| **Integrations** | `⌘3` | game-engine targets — link a Godot project, install the addon, build banks |
| **Deploy** | `⌘4` | the live event's home — launch, join codes/QR, lifecycle, guest list |

Each mode remembers its own layout (rail/tray sizes, panes). The `⤢`
button in the top bar resets the current mode's layout.

## Files, tabs, saving

- The left rail in Writing lists your files (toggle it with `⌘B`).
- `⌘S` saves the active file, `⌘⇧S` saves all. Server projects save to
  the API; local folders save straight to disk.
- `⌘P` opens the **command palette** — jump to any file, run any
  command (`>`), or jump to a symbol (`@` in file, `#` project-wide).

## Where the engine runs

Everything you write is parsed live, in the browser — diagnostics,
completion, hover, the story graph, and Run's simulator all come from
the same engine that runs live events, so **a rehearsal reads exactly
like the show**.
