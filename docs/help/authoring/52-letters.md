---
title: Letters — a personal email to every guest after the night
section: Live Shows
order: 52
keywords: letters, letter, email, e-mail, inbox, mail, thank you, thank-you, after the show, end of the night, send, draft, write, Trabolta, agent, Resend, webmaster, email card, show email, opt in, opt-in, performer, booth
---

A story can ask each guest for an email address, optionally, and an
agent-voiced character can write each of them a personal letter at the
end of the night, with their own stats. Nothing is ever sent by itself:
a director reads the drafts in Run and presses Send.

## Asking for the address

Deal the **email card** where it fits the story:

```loom
show email "Your inbox, for the letter. Optional." to program with button: "Send me the letter", skip: "No thanks"
```

The phone shows an email field, the button and a quiet *No thanks*. The
story hears `email answered` with `given` or `skipped`, never the
address:

```loom
when email answered for program:
  if given:
    Task Manager: Inbox on file.
```

The address goes to the event's letters list on the server. It is never
in the story, the log or a backup of the journal. Restarting the story
clears the guests' addresses, and going live clears the performers' too.

Performers are asked in their own upload, like a guest. A small *A letter
from …* card on the booth's home then shows the address on file, and lets
them change or remove it. In a story with no upload for its parts, that
card is where they're asked.

## Writing and sending

Run shows a **Letters** card for a server event: who left an address,
and the state of each letter.

1. **✍ Ask … to write them**: the story's `judge:` character (else its
   only `mind: external` one) writes one letter per address, one at a
   time, on the agent's worker. It gets the person's stats from the night
   (the same numbers as the [recap](43-run-mode.md)), what they came for
   and left behind, their side and how the night ended. It never gets the
   address.
2. Read each draft. Edit it in place and **Save edits**, or **↻ Rewrite**.
3. **✉ Send N letters**: one at a time, from the server's webmaster
   address, under the writer's name. Each letter goes once. A failed one
   says why and can be sent again.

Send needs `LOOM_RESEND_API_KEY` and `LOOM_WEBMASTER_FROM` on the
server; without them the card says Send is off. Pressing **End** stops
the event, and the card goes with it, so send the letters first.
