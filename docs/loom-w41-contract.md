# Wave 41 contract: Trabolta's letters

2026-10-29. The ask: *"ask for the guests and performers (real) email
address when they are being uploaded — entirely optional, but if they
submit then at the end of the night Trabolta will send them a personalized
letter thanking them for attending with facts and stats from the evening.
Also during the uploading allow guests to enter their own option […], not
just the stock answers like 'Debt'."*

The user's answers (2026-10-29):

- **A director presses Send.** Nothing goes out by itself: rehearsals, the
  bots and a story ending never email anyone.
- **The live Trabolta writes each letter** (his worker on the MacBook).
  Run shows every draft; a director can read and edit it before Send.
- **The write-in** is on the problem question (Debt / Career / Loneliness /
  Mortality / *Something else*). The deposit box keeps its typed record
  after *Deposited*; *I have nothing to leave* still skips it.

Lanes (branches `oct31-w41/<lane>`, merged `--no-ff`):

| Lane | Owns |
|---|---|
| `letters` | this file; the story (`login.loom`, `main.loom`, `review.loom`, `malware.loom`, `server-room.loom`, `codex/85-ties.loom`); `core/server/letters.ts` (new), `core/server/agents.ts` (worker accessor only), `core/server/event-runtime.ts`, `core/server/views.ts`, `core/server/routes/host.ts`; `stagehand/src/stagehand/agents/letter.py` (new) + `module.py`; their tests |
| `ui` | `play/src/widgets.tsx` (the `email` card), `play/src/booth/` (the performer's opt-in), `editor/src/components/run/LettersCard.tsx` (new) + `RunPage.tsx`, `editor/src/lib/api.ts`; their tests |

Docs and help land at integration.

## C1 The story

- `ROLE Program` gains `human_problem_text: text? = none` and
  `inbox: text? = none` (`"given"` / `"skipped"`; never the address), both
  listed in `secret:`.
- `== Upload` asks the problem with a fifth option, `* Something else.`:
  `human_problem = "other"` and an `answer` card (no `question:`, `max: 60`).
  Every other option ends `-> Upload Deposit`; the write-in's answer
  (main.loom `when answer answered`) stores `human_problem_text` and goes
  `-> Upload Deposit`, so the problem card and the deposit card are never
  open at once.
- `== Upload Deposit` is the rest of the old beat, and ends with the email
  card (C2) before the pass, for everyone:
  `show email "…" to program with button: "…", skip: "No thanks"`.
  `when email answered for program:` sets `program.inbox` from `given` /
  `skipped` and says one Task Manager line.
- Every `human_problem` branch gains `"other"` (the review's groups,
  *Your File*, the heart, the Truther line; the ties deal none).

## C2 The `email` card

- `show email "<prompt>" to <program | Character> [with button: "<label>",
  skip: "<label>", placeholder: "<text>"]`. Kind `email`. Answerable,
  inline (a big moment may show it inside itself).
- **Play** (`EmailCard`, registered in `WIDGETS` as `email`, label
  `✉️ your inbox`): one `<input type="email" autocomplete="email"
  inputmode="email">` (16 px or more, the wave 36 iOS floor), the
  `button` (default `Send`, disabled until `emailResult` accepts it) and a
  quiet `skip` link-button (default `No thanks`). Results:
  `{email: "<address>"}` or `{skipped: true}`. The answered receipt reads
  `✔ on file` when the answered args carry `given: true`, `✖ no thanks`
  for `skipped: true`. The phone never shows the address back after a
  reload (the server never echoes it).
- `emailResult(text)` (exported, pure): trims; `null` unless it matches
  `/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/` and is ≤ 254 characters.
- **Server** (`/api/guest/widget`, and `/api/prime/widget` for a
  performer's card): for kind `email`, `{email}` must pass the same
  check (else 400 `{"error": "bad_email"}`); the address goes to the
  letters book (C4) under the guest or the character, and the story hears
  `email answered` with `{given: true}` or `{skipped: true}` (plus `card`)
  — **the address is never journaled**, never in a view but Run's letters
  (C5) and the performer's own (C3).

## C3 A performer's opt-in (the booth)

Performers are never uploaded, so the booth asks them itself (no story
line).

- `PrimeView.letter?: {email: string | null, from: string | null}`:
  the address on file for this booth's character, and the sender (C6) the
  letter will come from, or null when the server has no mail set up.
  Absent from an old server, and absent for a booth with no character.
- `POST /api/prime/letter {email: string | null}`: performer auth (the
  same as `/api/prime/widget`). `email: null` takes it off file. 200
  `{ok: true, email}`; 400 `bad_email`; 403 without a character. Allowed
  while the doors are closed (it posts nothing into the story).
- **Play's booth**: a small `✉️ A letter from Jean Trabolta` card, shown
  until the performer sends an address or taps *No thanks* (that dismissal
  is kept in `localStorage` per event + character, wrapped in try/catch).
  Copy (`DRAFT w41`): *"When the night is over, Jean Trabolta writes to
  everyone who played. Leave an email if you want yours. Optional."* With
  one on file, it shows `✔ <address>` and a *Change* / *Remove*. Lives in
  the booth's home (`play/src/booth/`), below the now-card, never over a
  scan.

## C4 The letters book (`core/server/letters.ts`)

Transport-free, clock-injected, persisted in the event's state dir
(`letters.json`), **never journaled**. A story restart (reset, reload, Go
live) clears it; a process restart keeps it.

```ts
type LetterKey = `g:${string}` | `p:${string}`; // guest id | character
interface LetterEntry {
  key: LetterKey;
  kind: "guest" | "performer";
  /** Guest id or character name. */
  id: string;
  email: string;
  at: number;
  draft: { subject: string; text: string; by: string; at: number } | null;
  /** The last send attempt. */
  sent: { at: number; ok: boolean; error?: string; providerId?: string } | null;
}
```

A letter is sent at most once per entry (a failed one may be sent again);
changing the address of a sent entry makes it unsent.

## C5 Run's letters (`/api/mod/letters*`, directors only)

Never on the host allowlist.

- `GET /api/mod/letters` → `LettersView`:

  ```ts
  interface LettersView {
    /** The From line, or null when mail is off (no Resend key). */
    from: string | null;
    /** Why Send is off, or null. */
    off: string | null;
    writer: { character: string; online: boolean } | null;
    sending: boolean;
    rows: LetterRow[];
  }
  interface LetterRow {
    key: string;
    kind: "guest" | "performer";
    /** The program's name or the part's. */
    name: string;
    email: string;
    state: "waiting" | "queued" | "writing" | "drafted" | "sending" | "sent" | "failed";
    draft: { subject: string; text: string; by: string; at: number } | null;
    sent: { at: number; ok: boolean; error?: string } | null;
  }
  ```

  `waiting` = no draft yet and none asked.
- `POST /api/mod/letters/write {keys?: string[], redo?: boolean}` → asks
  the writer for every row without a draft (or `keys`; `redo` replaces a
  draft that is not sent). 200 `{queued: n}`; 409 `{"error": "no_writer"}`.
- `POST /api/mod/letters/draft {key, subject?, text}` → a director's own
  edit (`by` = their name). 404 `no_such_letter`; 409 `already_sent`; 400
  `empty` / `too_long` (text ≤ 6000, subject ≤ 120).
- `POST /api/mod/letters/send {keys?: string[]}` → sends every drafted,
  unsent row (or `keys`), one at a time, in the background. 202
  `{sending: n}`; 409 `mail_off` / `nothing_to_send` / `busy`.
- `POST /api/mod/letters/forget {key}` → takes the row off file. 200.

**Run** (`LettersCard` on the Run page, under the Print sheet): the
counts (on file / drafted / sent), `✍ Ask Trabolta to write them` (the
writer's online dot beside it), each row with its draft open in a
textarea (Save edits), `↻ Rewrite` per row, `✉ Send N letters` (a
confirmation names N and the From line) and a per-row Send / Forget. It
polls `GET` every 3 s while the card is open.

## C6 Writing and sending

- **Writer.** The story's `judge:` character, else its only
  `mind: external` one; null when neither (409 `no_writer`).
- **Frame.** `letter {id, character, to: {kind, name, part?}, facts,
  at}` on the worker's stream, one out per worker, never while that worker
  holds an open voice request; unanswered after 180 s it goes back in the
  queue (three tries, then the row reads `failed` with `error: "no
  draft"`). `facts` is the per-person night summary built from the recap
  (stats, ranks, what they came for, what they left, faction, the ending)
  — never a facts key, a secret codex entry, a code or another guest's
  private text.
- **Reply.** `POST /api/agent/letter {id, worker?, subject?, text}`
  (moderators only, like `/api/agent/judge`): 410 when the frame is gone;
  400 `empty` / `too_long`. Stored as the row's draft, `by: "<character>"`.
- **Send.** Resend (`LOOM_RESEND_API_KEY`), From
  `Jean Trabolta <address of LOOM_WEBMASTER_FROM>`, Reply-To
  `LOOM_WEBMASTER_REPLY_TO` else the From address; text + `textToHtml`.
  ≥ 600 ms between messages (Resend's 2/s).

## C7 Fiction

Trabolta writes as himself (Halifax, Maps and Ducks), to a program he
installed in his computer: never the crew, the party, the show, Loom or
the hardware (`trabolta.persona.md` `outside:`). The worker checks a draft
with the persona's secret and `outside:` guards and drops one that leaks.
