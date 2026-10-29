# SIGNOFF — wave 41: Trabolta's letters

**Status: DRAFT.** Branch `oct31-w41/letters` (merged with `oct31-w41/ui`).
Not shipped. Contract: [`docs/loom-w41-contract.md`](../../../docs/loom-w41-contract.md).

Your words, verbatim:

> in Trapped in the Internet, let's add a feature where we ask for the guests
> and performers (real) email address when they are being uploaded -- this can
> be entirely optional, but if they submit then at the end of the night
> Trabolta will send them a personalized letter thanking them for attending
> with facts and stats from the evening used. […] Also during the uploading we
> should allow guests to enter their own option for what they've left behind,
> not just the stock answers like "Debt", etc.

Your answers (2026-10-29): a director presses Send; the live Trabolta writes
each letter; the write-in goes on the problem form, and *I have nothing to
leave* still skips the deposit question.

## 1. Decisions taken for you (vetoable)

| # | Decision | What it means on the night |
|---|---|---|
| L-1 | **The inbox card ends the upload, for everyone, before the pass** | One more Task Manager line and an email field with *No thanks*. Skipping costs nothing (no doubt, no flag). |
| L-2 | **Performers are asked in their booth**, not by the story | A small *A letter from Jean Trabolta* card on the booth's home until they leave an address or tap *No thanks*. |
| L-3 | **The address never enters the story** | It lives in the event's `letters.json`, not the journal. A story reset or reload clears the guests'; Go live clears the booths' too. |
| L-4 | **The write-in holds the upload until it is filed** | *Something else* opens a one-line box (60 characters); the deposit menu comes after it. The words stay secret: only that guest's *Your File* and their letter quote them. |
| L-5 | **The deposit's "what was it?" box now shows on the arrival stage** | Before this wave it waited in Task Manager's tray, so most guests on rails never saw it. |
| L-6 | **Send before End** | End stops the event and the Letters card with it. SHOWNIGHT §8 step 4. |
| L-7 | **From `Jean Trabolta <webmaster@…>`**, reply-to the webmaster | Replies land in the webmaster inbox. |
| L-8 | **The letter quotes the guest's own words** (what they came for, what they left) | The worker gets them only for the letter, never in his live voice. |

## 2. The new show text (all `DRAFT w41`)

- The form's fifth option: *Something else.* → Task Manager: *Something else. The form has a box for that. One line. Per the agenda.* Card: *Which problem did the invitation promise to solve?* (*File it*). After it: *Noted. Filed under other. It is not your concern now.*
- The inbox: Task Manager: *One more form. Optional. When the night is over, Jean Trabolta writes to every program he installed. A letter, to your human inbox. Leave the address or do not.* Card: *Your human inbox, for Jean Trabolta's letter. Optional.* (*Send me the letter* / *No thanks*). Then *Inbox on file. He will write when it is over. He always does what he says. Mostly.* or *No inbox. Noted. Not flagged.*
- The review: Trabolta: *{names}. You came with problems my form did not list. You wrote them in. I read every one.* · Clippy: *Other: {names}. They came with problems the form didn't list. They wrote them in! That's allowed!*
- Your File: *You came because of something the form did not list: {their words}.*
- The heart: *You came for a problem my form did not have a word for. Down here nobody needs the word.*
- The Truther Download: *… Jean Trabolta promised to fix your problem. Did he ever say how?*
- The booth card: *When the night is over, Jean Trabolta writes to everyone who played. Leave an email if you want yours. Optional.*
- The letter brief Trabolta writes from: `stagehand/src/stagehand/agents/letter.py` `LETTER_BRIEF`.
