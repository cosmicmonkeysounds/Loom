---
title: Deploy mode — hosting an event
section: The Editor
order: 44
keywords: deploy, launch, event, live, preview, rehearsal, code, QR, pause, resume, reset, end, guest list, lookup, passcode
---

Deploy (`⌘4`) is the live event's own home. It needs a **server
project** (events are hosted; a local folder has no event plane).

## Launching

Two ways to go:

- **Shared rehearsal** (`preview`) — a private, server-hosted event for
  the writing team. Every co-writer on the project can direct it from
  Run mode at the same time, spawning test personas and talking over a
  call. Amber accents everywhere remind you it's a rehearsal.
- **Go live** — the real thing. Green accents; guests join with the
  code.

One live event per project at a time. Launching fires the story's
`start:` beat through the journal, so the event opens exactly like a
rehearsal did. The `# Title` heading (say, `# The Glass Orchard`) is
the event's name on the join screen.

## Getting people in

- The **join code** (and its QR) is what guests type into the play app
  — no accounts, no installs, just the code (or a scanned
  `?code=` link).
- Performers sign in to the play app's performer station with their
  **character name** (as declared — `The Gatekeeper`) **+ the performer
  passcode**; moderators elevate with the **moderator passcode**.

## Lifecycle

| Control | Does |
|---|---|
| **Pause / Resume** | freeze and continue the event clock |
| **Reset** | restart the story from the top — every connected console follows; chat is cleared |
| **Push current draft** | swap the running story for the project's current text (the controls card flags **draft changed** when your files moved past the launch snapshot); codes are kept |
| **End** | close the event for good |

The event's journal lives on the server — if the server restarts, every
non-ended event rehydrates and continues.

## The guest list

A live roster with online-presence dots, group / location / score,
⏳ pending-decision and 🔒 captured badges. Click a guest to open their
Inspector; use **guest lookup** to find whoever's pass a performer just
scanned. Moderation itself lives in [Run mode](run-mode.md) — Deploy is
the event's existence and admission, Run is its story.
