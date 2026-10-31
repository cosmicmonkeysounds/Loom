# SIGNOFF — wave 58: the music manager, and Trabolta at the stereo

**Status: DRAFT.** Built on `oct31-w58/music-manager`, landed with wave 59 on
`oct31-w59/story`. Not shipped. The contract is
[`docs/loom-w58-music-contract.md`](../../../docs/loom-w58-music-contract.md).

This is the second sheet numbered wave 58. `SIGNOFF-w58.md` is the Oct 30 story's.
This one's marker is `DRAFT w58-music`, so a line says which sheet it's waiting on.

Your words, verbatim:

> In a new branch, make sure the Desk in Play (for Task Manager) and Loom Edit
> have a music manager -- it should control Tidal and everything. It should
> allow Trabolta to control Tidal (like the lights) if he gets chummy enough
> with some programs during the event.

## 1. Decisions taken for you (vetoable)

| # | Decision | What it means on the night |
|---|---|---|
| M-1 | **Now Playing moved out of the Mixer** | 🎵 Music is the music, 🎚 Mixer is the faders. Hosts who learned Now Playing under the Mixer will find it one fold up. |
| M-2 | **Open for Task Manager** | Task Manager's Desk opens on 🎵 Music. Every other host's is folded, and polls nothing until opened. |
| M-3 | **A playlist is the unit** | Any show playlist, anything in the app's sidebar, or a pasted playlist link. **No search for one song**, and no album or track links: learning those buttons means driving the app the show is playing on. |
| M-4 | **Your whole sidebar shows on a host's phone** | Personal playlists included, by name, under a fold. Only hosts and directors see them. |
| M-5 | **A pause holds** | Until ▶, or until the scene changes. A live story cue that changes the scene resumes it. |
| M-6 | **⏮ and ⏸ are TIDAL's** | They show only while a bed is on the app. A file bed, like the ceremony, has neither. |
| T-1 | **Chummy is per program** | He changes the music for a program he is chummy with, not for everyone once he has a few friends. *Some programs* read that way; the other reading is a count of friends that unlocks it for all. |
| T-2 | **What makes him chummy** | +1 for each fact accepted, +1 for each piece of lore given to him, and ±1 a reply on his own judgement: good company up, rudeness down. The model can ask for more, and the server still moves it by one. |
| T-3 | **The bar is 3** | `Night.dj_bar`. A director can move it live in the var table. |
| T-4 | **His moves** | `skip`; `silence` (30 s); `calm`, `uneasy`, `dread` (Acts 1, 2, 3, for 3 minutes). Nothing else in TIDAL, and **never the Rave / Ending playlist**: it would spend the finale. |
| T-5 | **The lights' window, four uses** | From the malware to the end of the Y2K hour, `limit: 4`. A refusal costs no use. |
| T-6 | **It's a loan** | What he puts on goes back by itself. A live music cue ends it early, and a director's hand refuses him outright. `Night.music` stays the story's. |
| T-7 | **Hosts can lock him out** | 🔒 on 🎵 Music, or the two new Anytime cues. It hands back what he had on. |
| T-8 | **Who hears about it** | The asker gets a private line and `# hosts` gets a line. The house just hears the music change. |
| T-9 | **No printed fact changes for this** | Fact M19, *Ask Him Nicely*, is the Oct 30 delivery's: it says he can change the vibes, and its Codex page says the lights and sounds. So the card already covers the music, and he can offer it himself. |
| T-10 | **His loan gives way to the costume** | AFTER PARTY or BACK TO NORMAL on Task Manager's iPad takes the music back from him, because a loan is no hand; NEXT TRACK only moves the track. A host's own ⏸ or hand playlist refuses the press, because those are. |
| T-11 | **A Stop and a pause hold him off** | ■ Stop house sounds is a hand: only the story's next music cue or ↺ Follow the story brings the music back, and the costume's MUSIC and his moves are refused until then. A host's ⏸ refuses him too, and a ⏸ on his loan ends it, so his 30 s or 3 min can't lift it. |
| T-12 | **A move under a hand is refused before the story hears it** | No use spent, no `🎵` line, nothing in the panel's Last line. The line the model already wrote still goes out, so he can say yes and nothing happens. A `silence` on a file bed is not refused this way: the bed has no pause, so the story's line says it stopped. |

## 2. Still to prove, on the Desktop, before anyone relies on it

Everything here ran against a fake app. The real one was playing Act 3 through
the live router, so none of it was pressed. Read-only, the app confirmed the
button names and the sidebar's links.

- [ ] ⏸ pauses, and ▶ resumes where it stopped.
- [ ] ⏮ goes back a track.
- [ ] A show playlist by hand: the old one fades, the app changes, the new one
      fades in.
- [ ] A playlist from the sidebar, and a pasted link.
- [ ] *Follow the story* returns the act.
- [ ] A paused app stays on TIDAL past 20 s, with no fall to the act's folder.
- [ ] The sidebar's list matches the app after it scrolls.
- [ ] One `change_the_music` from a real Trabolta at a real bar.

## 3. The words (`DRAFT w58-music`)

His refusals, all new:

- *The speakers are not answering me.* (locked, or the story keeps the house silent)
- *We are not that close.*
- *One song at a time.*
- *I do not have that record.*

To the asker:

- 🎵 Trabolta skips the song for you.
- 🎵 Trabolta stops the music for you. It will not last.
- 🎵 Trabolta changes the music for you.

To `# hosts`:

- 🎵 Trabolta skipped a song for {program}.
- 🎵 Trabolta stopped the music for {program}: back in 30 s.
- 🎵 Trabolta put on the calm / uneasy / dread one for {program}: back in 3 min.
- 🔒 Trabolta is off the music.
- 🔓 Trabolta can reach the music again.

On the cue sheet: 🔒 *Keep Trabolta off the music*,
🔓 *Let Trabolta reach the music*.

To him: the power's description in `cast/trabolta.loom`, the malware brief's
*The music is different: no fact buys it*, and the favour policy's music line in
`trabolta.mind.md`.

## 4. Where every marker is

`main.loom`, `cast/trabolta.loom`, `trabolta.mind.md` and `core/src/house-mixer.ts`
(the card's words). The root `CLAUDE.md` and `INDEX.md` name the marker.
