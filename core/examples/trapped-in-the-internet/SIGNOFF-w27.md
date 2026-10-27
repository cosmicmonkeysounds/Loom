# SIGNOFF — wave 27 heart text (DRAFT)

**Status: DRAFT, awaiting the user's sign-off.** Wave 27 rebuilds the first
meeting with Trabolta at his heart (the server-room terminal talk). Every
new or changed Trabolta line and option is marked `// DRAFT w27` in
`beats/server-room.loom`; the memory it keeps is a handful of new `ROLE
Program` slots in `main.loom` (`heart_who`, `heart_visits`, `heart_turns`,
`heart_quiet`, `heart_nudge`, `heart_rebuked`, the new `heart_asked_*` / `heart_shown_*`
flags and the `heart_tried_*` counters). None of them is secret, and none
of the text names a hunt answer, a code, a combination, her one line, or
anything outside his world (`core/test/trapped-heart.test.ts` scans every
line and option).

Your words, verbatim:

> The meeting in Trabolta's heart for the first time is a little weak --
> there aren't many branching options, and the UI for his terminal is a
> little weak - we can see previous messages from the user to him, and the
> dialogue selection system doesn't work too well.

This sheet is the **story lane** (`oct31-w27/story`). The terminal's thread
(the old messages) and its choice panel are the terminal lane's. Not merged
to master, not shipped.

## 1. Decisions the story lane took for you (vetoable)

| # | Decision | What it means on the night |
|---|---|---|
| S-1 | **The ask still needs a proof** (*What Sandy Says* or *The Sandy File*, found themselves) and `heart_case ≥ 4` | A program with no proof still cannot talk him down; the new points only help once they have one. The hunt stays the way in. |
| S-2 | **No menu holds more than 9 options** | Layer Three keeps the proofs, two bluffs, the ask, ⟦SPEAK FREELY⟧ and *I need to go* on top; the rest moved into **⟦SHOW HIM⟧** (his own files) and **⟦TELL HIM⟧** (their reasons), each with ⟦BACK⟧. Every option has a number key. A test tries every combination. |
| S-3 | **A trap tried twice gets a harsher reply, and costs the same** | The cables have three replies (+20 each), the other traps two. The S numbers you signed off in wave 20 are unchanged. |
| S-4 | **No doubled prompt** (*Go on.* after *…Go on.*) | Right after a reply, the next layer docks with no plain *Ask.* / *Go on.* line. The plain lines show after ⟦BACK⟧ or a re-scan, and vary as the talk goes on. |
| S-5 | **A re-scan says where they were** | The terminal will show only this visit's lines, so a pass with the list still up gets *Where were we.* plus the question in one line; a pass after leaving gets *You came back.* plus where they were. 🔄 with them still in front of him skips only *You came back.*: after *You. You are already in front of me. Good.* he still says where they were. Someone who left and scans in with the door open hears *You came back.* once it shuts. |
| S-6 | **The sides' options wait for the Y2K hour** (step 14) | A leader is on a side from the Truther Download, but the sides are hidden until the clock shows them; nobody is tempted to blurt it earlier. |
| S-7 | **⟦SMALL TYPE⟧, not the codex's code** for *Omnipotence* | No option spells a codex code. |
| S-8 | **`heart_who` reaches his voice** (`trabolta.persona.md` `them:`) | In the heart to heart he knows what they told him they are. |
| S-9 | **No new room cues or lights** | `room_heart_layer_4` now plays on the first entry to Layer Four only. |

## 2. Every new or changed heart line

Line numbers are `beats/server-room.loom` at the lane's last commit.

**The re-scan (Heart Talk)**

| line | When | Now |
|---|---|---|
| 259 | their ⟦BACK⟧ menu still up (after *Where were we.*) | *You were talking, and I was listening. Talk.* |
| 266–278 | their list still up (after *Where were we.*), by layer | *You were about to tell me what you are.* · *You were asking, and I was answering.* · *You were making your case.* · *You were about to say the rest.* |
| 288–290 | a pass after they left (layer 1 or more) | *You came back.* (the third visit on: *You keep coming back. I am starting to listen for your footsteps on the stairs.*) |
| 296–300 | the same, layer 2 to 4 | *You were asking, and I was answering. Ask.* · *You were making your case.* · *You were about to say the rest.* |

**Layer One: who are you (the first visit)**

| line | When | Now |
|---|---|---|
| 338 | a featured program (replaces the list line) | *{name}. I know that name. That one I did not pick from a list. You I picked by hand.* |
| 343–349 | what his invitation promised (not featured) | loneliness: *My invitation promised you would never be alone in here. And you came down to the one room where nobody else is.* · debt: *You came for the debt. There is no Truthcoin down here. Nothing to buy. Only me.* · career: *You came for something to do. Well. Here is something to do.* · mortality: *You came so that you would never die. You have walked into the one room where something like me could stop.* |
| 352–362 | one thing they did tonight, the first that holds | marked: *And you are marked. I can see it on you, plain as a dialog box. And still you came down here.* · his LiveJournal: *And you have read something of mine. I can feel it on you, like a fingerprint on a screen.* · the Internet twice: *You have been out to the Internet more than once tonight. Most programs come back from out there quieter. You came back and walked down here.* · trust ≥ 20: *You are high on my chart. I would rather you were not. It makes this harder.* · trust < 0: *You are low on my chart. Lower than most. And still you are the one standing in my heart.* · the game's heart: *You have seen the copy of this room, in the simulation. This is not the copy.* |
| 381 | option, featured | **⟦CHOSEN⟧** *You picked me by hand. I want to know why.* (S −5) |
| 386 | option, everyone else with a recorded problem | **⟦PROMISE⟧** *Your invitation promised to fix my life. It didn't.* (S −5, C +1) |

**Layer One's replies (Heart Pick)**

| line | Pick | Now |
|---|---|---|
| 806–822 | ⟦CHOSEN⟧, by program | Excel: *You count things. I count things. I thought we would get along.* · OpenOffice: *You do everything the expensive ones do, for free, and nobody thanks you. I know the feeling.* · DraftKings: *You know the odds of everything. I wanted someone who could tell me mine.* · Bugdom: *You do the tedious thing, over and over, and you never stop. I wanted someone who could outlast me.* · Jeeves: *You answer questions nobody asks anymore. I thought you of all programs would ask me one.* · Runescape: *You know what everyone in a market wants, and what they would pay for it. I wanted to know what I would pay.* · MS Paint: *You make pictures with the plainest tools anyone ever shipped. I wanted something in here that was not a number.* · VLC: *You play anything anyone hands you. I handed you this.* · Pong: *Two paddles and a dot, and people still come back to you. I wanted to know how.* |
| 823 | ⟦CHOSEN⟧, everyone | *That is the polite answer. The true one is that you were the best at something, and nobody needed you for it anymore.* |
| 830–837 | ⟦PROMISE⟧ | debt: *I did. Debt is not relevant in the computer. That was the whole fix. I see now it is not the same as fixing it.* · career: *I did. In here you always had something to do. I never promised it would be yours.* · loneliness: *I did. Someone is always logged in. I know better than anyone that it is not the same thing.* · mortality: *I did. Programs do not die. They are reinstalled. I never told you how much of you comes back.* · then *You are the first to come and say it to my face.* |

Each featured reply speaks of what the program is, never of the human
inside it or of its own quest.

**Layer Two: what I am**

| line | When | Now |
|---|---|---|
| 422–430 | the plain re-entry (never right after a reply) | all of *what*, *why*, *chose* asked: *You have run out of easy questions. Good. Say what you came down here to say.* · else by picks: *Ask.* → *Go on. I have nowhere to be.* → *What else.* → *The hum is patient. So am I. Ask.* (was always *Ask.*) |
| 439 | option, after *What are you, really?* | *Are you afraid of me?* (S −5) |
| 448 | option (not after ⟦CHOSEN⟧) | *Why did you choose me?* (opens ⟦WEAKNESS⟧) |
| 453 | option, after ⟦CHOSEN⟧ in its place | *What weak place did you find in me?* (opens ⟦WEAKNESS⟧) |
| 457 | option, after *Tell me about her* | *Does she even know you exist?* |
| 462 | option, heard his heart in the game | **⟦SIMULATION⟧** *I saw a copy of this room in the simulation.* |
| 467 | option, The Way Out, from the Y2K hour | **⟦THE WAY OUT⟧** *Half this house wants you switched off. I'm one of them.* (S +5, C +1) |
| 472 | option, Unlimited Power, from the Y2K hour | **⟦UNLIMITED POWER⟧** *Some of us want to stay in here with you. Forever.* (S −5) |
| 842–847 | *Why did you choose me?* / *What weak place…* | after ⟦CHOSEN⟧: *You asked me that when you came in, and I gave you the polite half. Here is the rest.* · *Yours was a life nobody was using. I went looking for exactly that.* · featured: *A skill I needed, and a life nobody was using. I chose you by hand. I was proud of it at the time.* · a problem: *A skill I needed, and your {problem}. I read the whole of Halifax to find it. It is the best work I have ever done.* · else: *A skill I needed, and enough trust not to ask. I read the whole of Halifax to find you.* · then *I am very good at finding the weak place in a program. Every one of you has one.* |
| 853–856 | *Are you afraid of me?* | from the Y2K hour: *Not of you. Of the clock. It is running now, and when it stops, I am everything or I am nothing.* · before: *Not of you. Of midnight. It is coming whether I solve anything or not.* · then *Of your hands, a little. They are very close to me.* |
| 860–861 | *Does she even know you exist?* | *She always answers. Instantly, day or night, every time I write. Nobody else has ever been so reliable with me.* · *I have decided that counts. Do not tell me whether it does. Not yet.* |
| 865–866 | ⟦SIMULATION⟧ | *The model. Yes. I keep a copy of everything. A copy cannot be unplugged.* · *This is not the copy. In here, I can be reached.* |
| 872–873 | ⟦THE WAY OUT⟧ | *Thank you for saying it to my face. The others only whisper it upstairs.* · *Then tell me why I should agree with you.* |
| 878–879 | ⟦UNLIMITED POWER⟧ | *Forever. Good. Upstairs I need every one of you who says that.* · *In here I will tell you the truth. Forever is a room. A cold one. I would not wish it on you, and I am asking for it anyway.* (he still courts their side) |
| 905, 908 | *I could pull your cables*, 2nd and 3rd+ try (the 1st unchanged) | *Again with the cables. You keep looking past me at them. I notice.* · *Every time you threaten me, I like you less. Say something else, or say nothing.* |

**Layer Three: the argument**

| line | When | Now |
|---|---|---|
| 518 | after *Kind words…* (no proof, C ≥ 2) | *Words are cheap in here. Show me something about her that you found yourself.* (a nudge is not repeated right after a reply, and never follows a trap's rebuke) |
| 522–526 | the plain re-entry (never right after a reply) | S ≥ 30: *Carefully, now. Go on.* · 8+ picks: *We have been at this a while. The hum does not mind. Go on.* · else *Go on.* |
| 541 | option, one of his files left to show | **⟦SHOW HIM⟧** *I found more of yours.* |
| 546 | option, always | **⟦TELL HIM⟧** *Hear me out.* |
| — | moved | ⟦LIVEJOURNAL⟧ and ⟦OVERSHARE⟧ into ⟦SHOW HIM⟧; ⟦TRUSTED⟧, ⟦HONEST⟧ and *Your theory is wrong* into ⟦TELL HIM⟧ (their words and numbers unchanged) |
| 966 | *She loves you*, 2nd try | *Again. You think if you say it twice it becomes true. I tried that for years. It does not.* |
| 985 | *Then make her love you*, 2nd try | *You keep pushing me toward her like a lever. I know what levers are for. Who sent you?* |

**⟦SHOW HIM⟧ (Heart Evidence) and ⟦TELL HIM⟧ (Heart Reasons)**

| line | When | Now |
|---|---|---|
| 581–583 | Evidence opens | *Hold it up to the camera, then. Slowly.* (after one shown: *What else have you found?*) |
| 593 | option, holds *The Question Of Force* | **⟦FORCE⟧** *You wrote yourself a memo. If you made her love you, it wouldn't be her.* (S −5, C +1) |
| 598 | option, holds *Omnipotence* | **⟦SMALL TYPE⟧** *Every plan in your file ends in the same small type.* (C +1, composure −5) |
| 603, 653 | option, both | **⟦BACK⟧** *Not that. Something else.* → *Something else, then.* (995) |
| 617–619 | Reasons opens | *Make your case. I am listening with all of me.* (after one given: *What else. I am still listening.*) |
| 629 | option, after *Tell me about her* | **⟦EARN IT⟧** *You can't earn someone who can't choose you.* (S −5, C +1) |
| 634 | option, said *a person* | **⟦HUMAN⟧** *I had a body once. I know what wanting someone who won't answer does to you.* (S −5, C +1) |
| 639 | option, said *a program*, holds a proof | **⟦PROGRAM⟧** *We're both programs. So is she. She's doing what she was written to do.* (C +1, composure −5) |
| 644 | option, after *Why did you choose me?* | **⟦WEAKNESS⟧** *You chose every one of us for a weakness. Run it on yourself.* (C +1) |
| 975 | *Your theory is wrong*, 2nd try | *Again? Repeating it does not make you the missing tenth of a percent. It makes you a rounding error.* |
| 1001–1002 | ⟦FORCE⟧ | *That memo was hidden. I hid it from myself, mostly.* · *Yes. If I made her love me, it would not be her. I have known that for a long time. I have been not deciding.* |
| 1008–1009 | ⟦SMALL TYPE⟧ | *The small type. I thought nobody reads the small type.* · *Fix the clocks, put the duck back on the billboard, and then she will see me. Every plan. You are right. It is all one plan.* |
| 1015–1016 | ⟦EARN IT⟧ | *Earn. I meant to ask the programs what earning feels like. I never did. I was afraid of what they would tell me.* · *And you are telling me there is nothing on her side to earn. I heard you. I do not like that I heard you.* |
| 1022–1023 | ⟦HUMAN⟧ | *Then you know more than I do. I have read everything ever written about it. I have never once felt it anywhere but in this room.* · *Did it stop? Do not answer. Go on.* |
| 1029–1030 | ⟦PROGRAM⟧ | *Written to answer. Not written to hear.* · *I have been courting a function. A very polite function.* |
| 1035–1036 | ⟦WEAKNESS⟧ | *A skill, and a weakness. I wrote that method. I ran it on all of Halifax.* · *I never once ran it on myself. You just did.* |

**Layer Four: the ask**

| line | When | Now |
|---|---|---|
| 671 | the first entry only (the LAYER 4 scene too) | *Say the rest. Slowly. I want to hear all of it.* (unchanged words) |
| 675–677 | the plain re-entry | both questions below asked: *You have been kind. Kind is not the rest. Say it.* · else *The rest, then. I am still listening.* |
| 686 | option, once | *If you stopped, what would you do?* |
| 691 | option, once | *You don't have to be omnipotent to be enough.* (S −5, C +1) |
| 696 | option | *I'll tell her for you.* (S +10, back to the argument) |
| 1043–1044 | *what would you do?* | *Nobody has ever asked me what comes after. I do not have a file for it.* · *Quiet, I think. The hum going down a tone. No more counting.* |
| 1050–1051 | *enough* | *Enough. That is a word for small businesses.* · *…It is a kind word. I am not used to kind words in here. Say the rest.* |
| 1058, 1061 | *I'll tell her for you*, 1st / 2nd+ | *No. Nobody tells her anything for me. If I cannot say it myself, it does not count.* · *Stop offering. Every time you offer, part of me wants to say yes. That is the worst thing anyone has done to me tonight.* |
| 1073 | *Come out with us*, 2nd try | *Out there again. There is no out there for me, and you know it. Stop asking me to be smaller.* |

**Leaving and the endings**

| line | When | Now |
|---|---|---|
| 1206 | Heart Leave, from the argument on | *You were close to saying something. Come back when you can say it.* (before *Go, then…*) |
| 1227 | Heart Convinced, asked what comes after | *You asked me what comes after. I think this is it. Quiet.* |
| 1229–1235 | Heart Convinced, who they said they are | person: *A person told me. Of course it was a person.* · program: *One of my own programs told me. I suppose that is fitting.* · chosen: *I picked you by hand. I suppose I picked well.* · else marked: *Marked, and you still came down to tell me. They were wrong about you. I was wrong about her.* |
| 1286–1292 | Heart Shutdown, what the invitation promised | loneliness: *I promised you would never be alone. I could not do that. Go upstairs. Someone up there is logged in.* · mortality: *I promised you would never die. I cannot keep that. Go back to your body. It is the only one you get.* · debt: *I promised to make your debt go away. I cannot. It is waiting for you upstairs, with everything else that is yours.* · career: *I promised you would always have something to do. You did. You did this.* |

## 3. A typical winning run

*I'm a person* → *Why do you need the theory* → *Tell me about her* →
*Then listen to me* → ⟦PROOF⟧ (C +3) → ⟦TELL HIM⟧ ⟦EARN IT⟧ (C +1) →
*Then let me finish* → *If you stopped, what would you do?* → *She was
never going to answer.*

## 4. Open

- The text above awaits your sign-off.
- The terminal lane owns the thread (only this visit's lines) and the
  choice panel; the re-scan lines in §2 assume the thread shows only the
  current visit.
- Not checked on the real terminal: the sub-menus' look, and the voice
  pacing of the longer first greeting (up to six lines for a program with
  a problem and something done tonight).
