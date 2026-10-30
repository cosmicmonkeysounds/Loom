# SIGNOFF — wave 49: the descent

**Status: DRAFT.** Shipped as written in `w50` (2026-10-30), awaiting sign-off. Contract:
`docs/loom-w49-contract.md`.

Your words, verbatim:

> the map editor should be accessible from Loom Edit, not just some hidden
> link. make sure there are even more props (bbq, stove, broken microwave,
> modular synth, etc). the more times that a program is reinstalled, the more
> "fucked up" the reinstallation game gets, and the more "random hallucination
> moments" happen inside the game. also, props will start to be able to talk to
> you, and other narrative events start happening in the reinstallation game
> the more you visit. think House of Leaves, and Alice in Wonderland. (dialogue
> in Godot / VR is fairly basic but should include multiple options -- obviously
> the web game can largely re-use what we have already). Also, much like how
> there is "light prescense" (lights are affected by those in reinstallation),
> we should "hear" the footsteps of those in reinstallation in the real world
> (room prescense + closeness to speakers).

## 1. Decisions taken for you (vetoable)

| # | Decision | What it means on the night |
|---|---|---|
| D-1 | **The first walk stays clean** | The level is the ducks a program has already found, capped at 4. Talking props start on the second walk, the Hallway on the fourth. |
| D-2 | **A director can force a level** | Run → House map → *Descent*. By visits is the default; 0 to 4 applies to the next deal, never a walk under way. For testing, or for one guest you want to send straight to the bottom. |
| D-3 | **Nothing here can stop a walk** | A vision or a talk never blocks the duck, a King hit, the void, the heart or the disk, and you keep walking while a prop talks. Nobody is in the Hallway longer than 70 s. |
| D-4 | **No story change** | No `.loom` file moved. What a program tells a prop is remembered in the server's memory across its visits, never journaled. A restart forgets it, as it forgets who heard the heart. |
| D-5 | **The words are served live** | `descent.json` is a project file like `credits.json`: edit it, `sync-show`, and the games read it on the next walk with no new Quest APK. The APK carries a copy, for a server with none. |
| D-6 | **The props know nothing useful** | No line hints at the duck, the void, the heart, the disk or the patch bay, and a test greps for them. |
| D-7 | **Comfort stands in VR** | No forced camera motion, nothing flashing faster than 3 Hz. Small and Big change your eye height over 4 s. In the headset, options are picked with the pointer and the trigger. |
| D-8 | **A surprise** | The guests' help never mentions the descent or the footsteps. The staff's page does. |
| S-1 | **Footsteps are judged by the server, played by the router** | From the poses it already has, it picks up to 3 speakers within 7 m. Same room: clear. Another room: 8 dB down and muffled. Another floor: 12 dB down and muffled, so a program upstairs is heard through the ceiling. Nothing crosses the wire per step. |
| S-2 | **They are synthesised** | Floorboards, tile and grass, by room. A `footstep_floor_1.wav` (and so on) in the sounds folder replaces a take. |
| S-3 | **Only where there are speakers** | The show has them in the living room, the kitchen and the mud room. The tent, the basement and upstairs have none of their own: their walkers are heard only faintly, or not at all. |
| S-4 | **A fader of their own** | 🎚 Mixer gains a Footsteps strip. The map's Audio tab has the on/off, the reach, the level and a 👣 Test on each speaker. |
| P-1 | **The maps changed** | Stove, fridge, couch, toilets, sinks, the tub, the washer, the dryer, the bed, the fireplace, the BBQ and the studio are drawn as real things now, on their old footprints. New solid props: the modular synth, piano and amp in the RAM, an arcade cabinet, an armchair, a floor lamp and an old TV. |
| P-2 | **Strange props appear by level** | `Appears` in the map's inspector: the mirror at level 1; the clock, the little bottle and a mushroom at 2; the tea party, the flamingos, the spiral stairs, the rabbit hole and the free-standing door at 3; two card soldiers by the King at 4. They exist only in the games, and you walk through them. |
| M-1 | **The map editor lives in Run → House → 🗺 Map** | Signed in by your own run, no passcode. `/reinstall/map` still works, and opens from a button beside it. |

## 2. The words (all `DRAFT w49`)

`core/examples/trapped-in-the-internet/descent.json` is the source. `{name}` is
the program, `{visit}` this walk's number, `{nth}` that number as a word.

### The levels
| Level | Walk | Props awake | New at this level |
|---|---|---|---|
| 1 | 2nd | 1 | The lights stutter. Footsteps behind you. A whisper. |
| 2 | 3rd | 2 | The wrong colour. A pale duck. A grin in the air. |
| 3 | 4th | 3 | The dark and the growl. Yourself, ahead. Small. Big. The door that wasn't there. |
| 4 | 5th on | 5 | All of it, every 20 s or so. |

### What the props say

**stove** (from level 1; speaks through: stove)

| Node | They say | You can say |
|---|---|---|
| start | Psst. {name}. / You left me on. Last time. You left me on and you walked off. | I've never been here. (→ deny, remembered) · What's cooking? (→ cooking) · Sorry. (→ sorry, remembered) |
| deny | That's what the last {name} said. / Same shoes. |  |
| cooking | Nothing. That's the trouble. I've been heating nothing since before you got here. / It's nearly done. | Done for who? (→ forwho) · I'll leave you to it. |
| forwho | You've got a place at the table. / You've always had a place at the table. |  |
| sorry | Nobody has ever said that to a stove. / Go on. Before it boils over. |  |
| again | Back again. And still never been here. / The dials remember your hands, {name}. |  |
| polite | You. The polite one. / It's your {nth} time through. I turned myself down for you. |  |

On a later visit: stove was told denied: opens at again; stove was told sorry: opens at polite.

**microwave** (from level 1; speaks through: microwave)

| Node | They say | You can say |
|---|---|---|
| start | Door's broken. Been trying to tell someone. / Thirty seconds left. Thirty seconds left. Thirty seconds left. | Left until what? (→ until) · What's inside you? (→ inside) · Shut your door. (→ shut) |
| until | Until it's done. / It has been done for hours. Nobody comes. Nobody ever comes and takes it out. | Takes what out? (→ inside) · I'm not hungry. |
| inside | A little plate going round. / On the plate, a little house. In the house, a very small you. / It's looking up. |  |
| shut | You first. |  |

**fridge** (from level 1; speaks through: fridge)

| Node | They say | You can say |
|---|---|---|
| start | Stop opening me. / You keep opening me. You stand there with the door open and you look at the same shelves, and then you leave. | I didn't touch you. (→ didnt) · Is the light on inside? (→ light) · What's on the shelves? (→ shelves) |
| didnt | Then who was that? |  |
| light | Only when somebody's looking. / Same as you. |  |
| shelves | Leftovers. / Each one's labelled with your name and a date, and I don't like the dates. |  |

**toilet** (from level 1; speaks through: toilet)

| Node | They say | You can say |
|---|---|---|
| start | Everything comes through here in the end. / Every file. Every program. You'd be amazed what people try to flush. | Have you seen me before? (→ seen) · Where does it all go? (→ where) · I'm just here to hide. (→ hide) |
| seen | Not from this angle, thank God. |  |
| where | Down. / Then along. Then down. It's a lot further than the house is deep, I can tell you that. |  |
| hide | I know. You all come in here to look at your phones. / It isn't safe in here either. It's just tiled. |  |

**bbq** (from level 1; speaks through: bbq)

| Node | They say | You can say |
|---|---|---|
| start | Smell that? / No. You can't. Nothing in here smells. That's how you can tell. | Tell what? (→ tell) · I can smell burning. (→ burning) |
| tell | Which side of the screen you're on. / Have a burger. It won't help. |  |
| burning | No you can't. / Oh, no. Can you? That's not good. That's early. |  |

**modular** (from level 1; speaks through: modular)

| Node | They say | You can say |
|---|---|---|
| start | Don't touch the knobs. I'm holding the house up. / Every sound in here is me. The hum. The duck. Your footsteps. | My footsteps? (→ steps) · Why are you telling me? (→ why) · Play something. (→ play) |
| steps | Somebody out there can hear you walking, {name}. / Up in the real rooms. Try it. They stop talking when you go past. |  |
| why | Because I've run out of oscillators. There's one left, and it's your name. |  |
| play | I am. / This is it. This is what it sounds like when it's going well. |  |

**mirror** (from level 1; speaks through: mirror)

| Node | They say | You can say |
|---|---|---|
| start | You're late. / You were meant to be standing here an hour ago. I've been holding your place. | Which one of us is real? (→ real, remembered) · You look tired. (→ tired) |
| real | Good question. Keep walking and we'll see who stops first. |  |
| tired | This is your {nth} time through. I look exactly as tired as you do. |  |
| you | Still walking? / Me too. |  |

On a later visit: mirror was told you: opens at you.

**plant** (from level 1; speaks through: plant)

| Node | They say | You can say |
|---|---|---|
| start | Don't tell the plant it's plastic. / I've been keeping it from it for years. | You are the plant. (→ you) · Your secret's safe. |
| you | ... / Oh. |  |

**couch** (from level 2; speaks through: couch, armchair)

| Node | They say | You can say |
|---|---|---|
| start | Sit down. You look terrible. / There's a dent here exactly your shape. You've been coming here longer than you think. | Just for a second. (→ sit) · What happens if I sit? (→ what) · No thanks. |
| sit | That's what they all say. / Look down the back of me sometime. Everyone's in there. All the small change. *(sets off tint)* |  |
| what | Nothing. / That's the whole offer. Nothing happens, for a very long time, and it's warm. |  |

**tv** (from level 2; speaks through: tv)

| Node | They say | You can say |
|---|---|---|
| start | We interrupt this program. / You. You're the program. We interrupt you. | What's on? (→ on) · Change the channel. (→ change) |
| on | A house. A long shot of a hallway. Nothing moves for an hour. / It's the highest-rated thing we've ever shown. |  |
| change | Sure. / We interrupt this program. *(sets off flicker)* |  |

**washer** (from level 2; speaks through: washer, dryer)

| Node | They say | You can say |
|---|---|---|
| start | Reinstall number {visit}. You've noticed, haven't you? / Everything comes out a little smaller. | Smaller how? (→ how) · I feel fine. (→ fine) |
| how | Fewer colours. Fewer buttons. / One sock, then the other sock wonders where you went. |  |
| fine | They always feel fine. It's the delicate cycle. |  |

**clock** (from level 2; speaks through: clock)

| Node | They say | You can say |
|---|---|---|
| start | It's six o'clock. / It's always six o'clock. Time and I had a falling out. | You've stopped. (→ stopped) · How long have I been here? (→ long) · I'm late for something. (→ late) |
| stopped | I haven't stopped. Everything else is going too fast. |  |
| long | Since six. |  |
| late | Everyone here is late for something. / The duck is the worst of them. |  |

**bottle** (from level 2; speaks through: bottle)

| Node | They say | You can say |
|---|---|---|
| start | The little paper tag says DRINK ME, in very neat handwriting. / It isn't marked poison. You did check. | Drink it. (→ drink, sets off small, remembered) · What's in it? (→ what) · Leave it. |
| what | Cherry tart, custard, pineapple, roast turkey, toffee. / And something else. Something a program shouldn't really run. | Drink it. (→ drink, sets off small, remembered) · Leave it. |
| drink | What a curious feeling. |  |
| again | It's full again. / It remembers you, {name}. It says you're looking well. Much smaller. | Once more. (→ drink, sets off small) · No. |

On a later visit: bottle was told drank: opens at again.

**mushroom** (from level 2; speaks through: mushroom)

| Node | They say | You can say |
|---|---|---|
| start | Who are YOU? | I'm {name}. (→ name) · I hardly know, just now. (→ know) · Who are you? (→ back) |
| name | That's what you were called this morning. It won't last. / One side will make you grow. The other side will make you smaller. | A bite from this side. (sets off big) · A bite from that side. (sets off small) · Neither. |
| know | Now that's the first sensible thing a program has said in this house. |  |
| back | I asked first. Keep your temper. |  |

**gnome** (from level 2; speaks through: gnome)

| Node | They say | You can say |
|---|---|---|
| start | {visit}. / That's your count. I keep the count. You've come out through this yard {visit} times, and each time there's a little more yard. | More yard? (→ more) · Who asked you to count? (→ who) |
| more | I measured it with my own beard. A quarter inch, every time. / It doesn't sound like much until you're walking it in the dark. |  |
| who | Nobody. That's the bit that worries me. |  |

**piano** (from level 3; speaks through: piano)

| Node | They say | You can say |
|---|---|---|
| start | Somebody keeps playing me from the other side of the wall. / There's nothing on the other side of the wall. I've checked. | What are they playing? (→ what) · I'll have a look. (→ look, sets off dark) |
| what | The same four bars, slower every time. / It's your walk, {name}. It's how you walk. |  |
| look | Oh, please don't. |  |

**bathtub** (from level 3; speaks through: bathtub)

| Node | They say | You can say |
|---|---|---|
| start | Mind the water. It's yours. / You cried it when you were bigger. | I never cried in here. (→ never) · How deep is it? (→ deep) |
| never | You won't have. Not yet. It's a very patient bath. |  |
| deep | Deeper than the floor it's standing on, and I've stopped asking how. |  |

**door** (from level 3; speaks through: door)

| Node | They say | You can say |
|---|---|---|
| start | Stop measuring me. / I am wider on this side than I am on that side, and I would thank you not to bring it up. | What's behind you? (→ behind) · How much wider? (→ wider) · Open up. (→ open, sets off door) |
| behind | A hallway. / It wasn't there yesterday. It's a lot longer than the house. |  |
| wider | A quarter inch. So far. |  |
| open | I don't open. That one does. |  |

**tea** (from level 3, woken first; speaks through: teatable)

| Node | They say | You can say |
|---|---|---|
| start | No room! No room! / There's plenty of room. There are {visit} places laid. Each one has your name on the card, and the tea in them is still warm. | Take a seat. (→ sit, remembered) · Who else is coming? (→ who) · Why is a duck like a router? (→ riddle) |
| sit | Move down one place. Everyone moves down one place. / You'll want to meet the others. *(sets off self)* |  |
| who | Only you. Only ever you. / You were very rude last time. You'll be rude again in a minute. |  |
| riddle | I haven't the slightest idea. / You keep asking, and no one ever finishes it. Have some more tea. |  |
| back | Your place is still warm, {name}. You never really got up. |  |

On a later visit: tea was told sat: opens at back.

**cards** (from level 4; speaks through: card)

| Node | They say | You can say |
|---|---|---|
| start | Don't look at the walls! We're painting them. They came out the wrong colour. / If the King finds out, it's off with all our heads. | What colour should they be? (→ colour) · I won't tell. (→ tell) |
| colour | White. All of it, white and clean. That was the whole idea, before you lot started coming back. |  |
| tell | You've said that {visit} times. / We keep a list. It's a deck, actually. |  |

### Whispers

| Level | Lines |
|---|---|
| 1 | You've been here before. / Did that door always open that way? / It's nothing. It's only the house settling. / Someone is counting your steps. / Keep walking. You're doing very well. |
| 2 | That hallway used to be shorter. / {name}. {name}. {name}. / Curiouser and curiouser. / You came back. They always come back. / It's wider on the inside now. |
| 3 | It measured a quarter inch more this morning. / This isn't for you. / Nobody else has been here {visit} times. / We're all mad here. You'll fit right in. / Don't go the long way. Don't go the long way. |
| 4 | There's no one left in the house but you and the house. / {name} isn't your name. {name} is what was left over. / Every reinstall comes out a little smaller. / The walls were listening. Now they're talking. / You aren't finding the duck. The duck is finding you. |

### The visions

| Vision | Lines |
|---|---|
| The grin | We're all mad here. / You may have noticed that I'm not all there myself. / That depends a good deal on where you want to get to. / If you don't much care where you're going, it doesn't matter which way you walk. / I could vanish. Then who would watch you? |
| The pale duck | Oh my feet and feathers, I'm late! / No time, no time, no time! / Not me. You want the other one. / I can't stop. You've seen what happens when I stop. |
| Yourself, ahead | You're late. / I already found him. It didn't help. / Go back. No. You can't. I tried. / Don't look at me like that. You'll do the same. |
| Small | What a curious feeling. / Everything's a very long way up. / You're shrinking. That's normal, after {visit} reinstalls. |
| Big | Goodbye, feet. / Now you're opening out like the largest telescope that ever was. / Mind your head. Mind the whole house. |
| The Hallway, going in | This wasn't here. / It's longer than the house is wide. |
| The Hallway, part way | It keeps going. / You've been walking for longer than the house is long. / Something else is walking too. Further back. |
| The Hallway, coming out | We measured it. Everything's back to normal. / It's a quarter inch wider. |

### Gerald, at the find

| Level | Line |
|---|---|
| 2 | You again. |
| 3 | I don't hide, you know. I wait. |
| 4 | See you next time, {name}. There's always a next time. |

The Carroll lines are his (public domain). Nothing is quoted from *House of
Leaves*: the quarter inch and the hallway are its ideas in our words.

## 3. To ship it

1. Server first: `predeploy --vr`, `ship.sh <tag>`.
2. `sync-show --keep-audio --keep-lights --keep-desk --replace-maps`, with its
   reload, before doors. First Download JSON any map edits saved to the project
   and commit them into `house.json`, or they are lost. `descent.json` always
   replaces (like `credits.json`). The story did not change.
3. Desktop: `git pull`, then `start-stagehand.ps1 -Restart audio`. Walk the
   👣 Test on each speaker and set the level on the Footsteps fader.
4. Reload the web game and the tent. Re-export and sideload the Quest APK.
