# SIGNOFF — wave 20 (DRAFT)

**Status: DRAFT, awaiting the user's sign-off.** Wave 20 is Trabolta's heart:
when the server room is first opened he plays a dramatic sequence there, asks
for the door to be shut, waits for a pass at the server-room terminal's
webcam, and then talks to that program in **four layers like the Master in
Fallout 1** (you may convince him to shut himself down, or not). The door
sensor is an **LED + LDR on the Grand Central M4** plugged into Steph's
laptop, which is the terminal (monitor, mouse, webcam, and since the
addendum a **keyboard** for a true **heart to heart** with his AI, the
program's night riding along as a dossier). The server room's **RGB Zigbee
bulb** is driven from a new project file, `lights.json`, by a new stagehand
`lights` module, and the map editor can place lights. Trabolta lives in
Halifax in the world of Maps and Ducks and knows nothing outside it (D29).

Your words, verbatim:

> "Trabolta should have a very dramatic sequence if you get into the Server
> room. There is a door sensor (LDR + LED -- the door is "closed" when the LED
> is shining on the LDR, which reads about max value on an Arduino). When you
> first open the room, his special cutscene plays in the server room. He asks
> you to close the door, which you must do before continuing. Then, it's a
> multi-layer discussion similar to the Master in Fallout 1 -- you may be able
> to convince him to shut himself down, or not. In the server room is Steph's
> laptop with an Arduino plugged into it (Grand Central M4) -- the door sensor
> is connected to it. This should transmit to the Loom server. There is also a
> RGB Zigbee bulb in the room which should be controlled for great effect. A
> monitor and mouse are used as the "terminal" / Trabolta face -- the user
> scans their pass on the webcam so that Trabolta knows who it is. We
> currently don't have a way to place lights in the map editor, so make sure
> that can happen so we can actually get the home automation / Zigbee stuff
> working. I've got a Zigbee2MQTT dongle: Zigbee 3.0 USB Dongle with 20dBm
> Output | TI CC2652P+CP2102N Dual-Chip | Multi-Protocol Support | Preloaded
> Z-Stack 3.x.0 Firmware"

> "there will also be a keyboard for typing -- there should be an
> opprotunity to have a true heart to heart with the Trabolta AI. With a
> special prompt that includes the guest's history, we can allow players to
> truly chat with Trabolta, who is ostesenbily fully aware of his reality and
> the bleakness of it"

> "Trabolta lives in the MapsAndDucks universe, not ours. He doesn't know who
> John or Steph or Jesse are. Trabolta lives in Halifax."

**Where it is built.** Lanes `oct31-w20/{platform,firmware,stagehand,story,
terminal,mapeditor,editor}` merged `--no-ff` into `oct31-w20/integration`,
then an integration round (26 findings: 20 fixed, 3 accepted with a note, 3
open), then the docs. **Not merged to master, not shipped.** The build
contract is [`CONTRACT-w20.md`](./CONTRACT-w20.md); the status table, deploy
order and suites are OCT31.md §5 *Wave 20 status*.

Every row is a decision taken for you with its drafted default (§1), an
open question (§1b), a line of show text that changed (§2, `// DRAFT w20` in
the source, file:line on `oct31-w20/integration`, old → new), the terminal's
copy (§3), the light looks (§4) or the `outside:` list (§5). Mark each ✅ keep
/ ✏ reword / ❌ drop. Nothing here plays on the night until it is signed off
(`sync-show` carries the wave 20 text only after).

**Deploy note.** The story text changes what an old journal replays to, so an
old journal must not play the new text: the server first, then on the house
Mac `stagehand launchd restart --job show` **before** the sync (the old door
rules leave the YAML; one firing into the new story would hand the door to
the 🚪 buttons), then `pnpm sync-show` with its reload before doors, then
`--job agents` + Run → Mind → Reset. Full order: OCT31.md §5.

---

## 1. Decisions taken for you (D1–D29)

### The door and its sensor

| # | Decision (default) | ✅ / ✏ / ❌ |
|---|---|---|
| D1 | **The bridge is Web Serial in the server-room terminal page** (Steph's laptop, desktop Chrome on https): ⚙ *Connect door sensor* grants the port once, later boots reconnect by themselves. The terminal posts each settled edge as `door_sensor_opened` / `door_sensor_closed`, reports the door on its heartbeat (Run → Terminals' 🚪 badge) and re-checks the story against the sensor on every poll. **Changed from your brief:** (a) while the sensor reports a blocking fault (`ldr_saturated`, `led_dead`, no port, silent) it posts nothing; (b) a director's or an Antivirus' 🚪 press hands the door to the buttons until 🚪 *Trust the door sensor again* (D19). | |
| D2 | **The M4 firmware** (`hardware/server-room-door/`): 12-bit reads, hysteresis + debounce, JSON lines at 115200, settings in flash. Mode **`auto`**: if the LED is on pin D2 it pulses it and reads *lit − dark* (`mod`: room light can't fake *shut*), else it reads it steady (`steady`, the LED on 3V3). A cut LDR wire with the door open looks like an open door in a dark hall, so `ldr_open` is a **warning** (still *open*), never a blocking fault. A black shroud tube over the LDR is in the BOM. | ✏ **w20b (Q5):** a build switch instead of the probe: `LED_MODE` **steady** (the default: the LED on 5V as today) or **pulsed** (the LED on D2 through 220 Ω for a red LED, or today's LED through an NPN; lit − dark, so the red heart bulb can't fake *shut*). A dead LED reads as an open door unless the optional sense wire is fitted, in either wiring. After a rewire, calibrate again in ⚙ (it says so). |
| D16 | **The ESP32 stops reading the door**: the copper-tape rule and the optional Zigbee contact leave `trapped.house.yaml`. The ESP32 keeps the patch bay, the ring, the siren and the relay. | ✏ **w20b (Q7):** no ESP32 at all: the patch bay is a prop the Antivirus watch judges and presses (🔌 💥 ❌ on their booth, or a director's), the alarm's siren is the house router's, no lock ring or relay. Its code and YAML rules stay, unused. |
| D17 | **The keypad stays as it is**: the code comes from the four digit notes, the King or the majority; the sensor only says open / shut. | |
| D19 | **The sensor and the directors never fight.** The sensor's edges count only while no 🚪 button has been pressed (`Night.door_override`); a 🚪 press (admin or the Antivirus' radio buttons) takes the door over; 🚪 *Trust the door sensor again* hands it back. | |
| D22 | **Door chatter is rate-limited**: *Heart Door Again* at most once per 20 s, *Good.* only after one; the stage, the freeze and the light follow every edge. The door, nag, shut and sealed beats never become TV moments. | |

### The heart's talk

| # | Decision (default) | ✅ / ✏ / ❌ |
|---|---|---|
| D3 | **The story owns the Heart sequence** in stages (sealed → door → scan → talk → done) and a per-program **choice tree in four layers** (WHO ARE YOU · WHAT I AM · THE ARGUMENT · THE ASK), docked in the program's Trabolta thread and clicked on the terminal. Tagged options (⟦MARKED⟧ ⟦PROOF⟧ ⟦TRUSTED⟧ ⟦HONEST⟧ ⟦OVERSHARE⟧ ⟦LIVEJOURNAL⟧) show only when the check passes and never quote a secret. Wrong pushes raise his suspicion; **a warning at 50, thrown out for the night at 80**. **The ask opens at a proof (*What Sandy Says* or *The Sandy File*, not handed over by him) + one more point.** Before the Y2K hour a convinced program hears **not yet** and is called back at 🕚; in the Y2K hour success shuts him down from the story itself and, with 🕊 *Heart autoend* **on (the default)**, the night ends 25 s later. A door opened mid-talk freezes it until shut. One heart at a time. | |
| D9 | **A new engine feature, guarded choices** `+ (if <cond>) text`: an option shows only while its check holds (lint L1221; the bank diagnoses and ignores it). The tree needs it. | |
| D12 | **Being thrown out does not mark the program.** It bars them from his heart for the night (🔄 forgives) and points them at the cables. | |
| D13 | **The agent's `stand_down` power is deleted** (the INTERACTION, its hook, the persona's *standing down* block, the mind file's powers). The tree is the only way to the offer; his voice never decides it. | |
| D14 | **A pick from the phone counts only at the heart**: off the terminal it is held back with *Not out there*, and the menu comes back on the next scan. | |
| D15, D18 | **Every menu has an id**; the terminal answers the heart's menu by its id and the option's text (409 *moved* on a race), so a stale menu (The Tablet Video's, a glitch menu) never catches a click and is never dropped. | |

### The keyboard and the heart to heart (the addendum)

| # | Decision (default) | ✅ / ✏ / ❌ |
|---|---|---|
| D23 | **The server-room terminal has a keyboard.** The composer shows at the heart except while a tree menu waits; `keys=0` is the mouse-only rig. | |
| D24 | **The heart to heart is a mode of the tree.** Every layer offers ⟦SPEAK FREELY⟧ *Forget the questions. Talk to me. Just talk.*; it docks only ⟦BACK⟧ *Let's go back to it.* (back to the same layer, suspicion untouched). After *not yet* or a Leave the program may keep typing. An eject ends it. | |
| D25 | **The heart-to-heart prompt, inside his world**: bleak, candid, unhurried, up to four sentences, asks real questions, remembers their night, never decides or does anything (`max_sentences: 4`, `acts: none`), every never still holds. | |
| D26 | **The guest's night rides the request** (the dossier) only at the heart: faction, trust rank, filings by verdict (never an answer or a key), non-secret codex titles, quests, rooms visited, their own last lines to him, the heart's progress. Never a secret, a code, a patch pair, another guest's line or a real name. `LOOM_AGENT_DOSSIER=off` turns it off. | |
| D27 | **The worker reads it** as a *WHO THIS IS — TONIGHT* block. | |
| D28 | **The terminal**: ⟦SPEAK FREELY⟧ like any option; with ⟦BACK⟧ docked the composer is focused and ⟦BACK⟧ sits small under it; typing keeps the line. | |
| D29 | **The fiction boundary (your correction).** He lives in Halifax, in the world of Maps and Ducks, and knows nobody from the real production. (a) The persona's **`outside:`** list (§5) — a reply of his naming one is withheld and swapped for a fallback line, like a `never` word; the prompt itself names none of them. (b) The dossier carries only what the story knows (never an account, an email, a device label, a host's or director's name). (c) No heart line, scene or terminal text names a real person or object: the M4 and the laptop are *his heart*, the sensor is *the door*, the bulb is *the light in his heart*. | |

### Lights, screens and Run

| # | Decision (default) | ✅ / ✏ / ❌ |
|---|---|---|
| D4 | **Changed from your brief: the room's cutscenes are cued by the story** (`cue room_heart_*` in a beat set in The Server Room → that room's terminal only), not by beat names, so the picture lands on the line and no per-guest beat ever reaches the TV. | |
| D5 | **`lights.json` is a project file beside `audio.json`** (never in the map: a light edit doesn't bump the map version). This wave holds only the server room's RGB bulb; every other light is still the YAML's. | |
| D6 | **The stagehand `lights` module** (house Mac, its own launchd job) plays the story's `cue heart_*` looks on Zigbee2MQTT / WLED, tests, identifies, pairs, posts the Z2M device list, catches up after a reconnect, and `show` hands it the looks `lights.json` defines. | |
| D7 | **The map editor places lights**: 💡 Light tool, inspector, *+ Light here*, the 💡 Lights tab (fixtures, Z2M devices + *Pair new device*, looks with steps, ▶ Test), Save to project, one undo history with the map and the speakers. | |
| D8 | **Run** shows a 🚪 badge per terminal (shut / open + level, a red fault, ⚠ a warning, amber *override*), the glance shows the heart (the story's `watch:` lines), and a 💡 row on the House map card. | |
| D10 | **The RGB bulb belongs to `lights.json` alone**: it leaves the Z2M `server_room` group, so the YAML's `lights_server_open` and `lights_alarm` no longer touch it; the story cues `heart_alarm` for it under the patch-bay alarm and puts the room's look back when the latch ends. | |
| D11 | **The room's safety light is the WLED strip `wled/server`**: no heart look touches it, and `lights_alarm` gives it a steady red, never a strobe. The RGB bulb is a safety fixture too (`power_on_behavior: on`; never off, never under 40 / 254), but 40 / 254 in red or violet is only a few lumens. The drama is colour, slow swells and timing; never fast flicker over Zigbee. | |
| D20 | **A short look gives the light back** (`heart_nag`, `heart_warn`): the module plays it, then restores the loop it interrupted or the settled look. | |
| D21 | **The lights catch up from the story**, not a cache: after a reconnect the module reads the screen state (the alarm → `heart_alarm`; the door open mid-heart → `heart_door_open`; else the settled heart look; else `boot`). | |

### Taken at integration (CONTRACT-w20 §8)

| # | Decision (default) | ✅ / ✏ / ❌ |
|---|---|---|
| I1 | After *not yet* or a Leave the terminal's leash is the normal 30 s until the program types, then 180 s (the terminal can't see the heart-to-heart flag): a program who walks off frees the terminal sooner. | |
| I2 | A door-sensor fault shows only on Run → Terminals and ⚙, never on the guest's screen (D29 c). There is no *DOOR SENSOR FAULT* text. | |
| I3 | The `outside:` list leaves out a bare *John* (John McAfee is in his world) and *party* (his own invitation is to a fundraiser party): **a reply naming "John" is not caught.** | |
| I4 | A program thrown out of his heart gets his ordinary voice (the candid blocks need `heart_out != true`); a separate cold *thrown out* block was tried and dropped (it pushed the late-night reflect past the model's context). | |

## 1b. Open questions (CONTRACT-w20 §5.4)

| # | Question | Default today | Your answer |
|---|---|---|---|
| Q1 | The DRAFT lines (§2) and the four layers: is this the Master you had in mind, and is *a proof + one more point* the right difficulty? | as drafted | |
| Q2 | Should being thrown out also **mark** the program for reinstallation? | no (D12) | |
| Q3 | In the Y2K hour, should success end the night by itself after 25 s, or always wait for a director's 🕊? | by itself (🕊 Heart autoend on; with it off, 🔄 can undo a declined 🕊) | |
| Q4 | Before the Y2K hour a convinced program hears *not yet*. Should an early convince end the night at once instead? | not yet (the Y2K gate kept) | |
| Q5 | Is the LED on 3V3 (always lit) or can it move to a pin on the M4? Only a pin gives the room-light-proof `mod` reading. | `auto` handles both | *"Currently on 5V, actually, but it could be on a digital pin to allow pulsing for better light/dark detection."* Built (w20b): `LED_MODE` steady (5V, the default) or pulsed (D2); wiring for both in `hardware/server-room-door/README.md`. |
| Q6 | Is the WLED strip `wled/server` still in the server room and working? It is the room's safety light (D11); without it the bulb is the only light and should stay brighter. | yes | |
| Q7 | Is the ESP32 still on the door frame? D16 stops listening to it; the copper tape can come off. | ignored | *"No, just the Grand Central M4."* Documented (w20b): the patch bay is pressed by the Antivirus watch (`radio_*`), the siren is the router's; K-05 and the watch card follow. |
| Q8 | May guests answer the tree from their phone while standing at the terminal, or mouse only? | phone too (D14) | |
| Q9 | Does the keypad stay exactly as it is? | yes (D17) | |
| Q10 | Is the RGB bulb the only bulb in the Z2M `server_room` group? If so the group's YAML lines are dead and removed; if not they stay for the others. | treated as the only one | |

---

## 2. Show text changes

Every Trabolta line in `beats/server-room.loom` from The Heart on is `// DRAFT
w20`. A line marked **new** had no old version. `{program.name}` is the
program's name; `{Night.her}` is *her* until the story names Sandy.

### The Heart (`beats/server-room.loom:133`)

| | Old (wave 7–18b) | New (wave 20) |
|---|---|---|
| house notice | `!🚪 THE SERVER ROOM IS OPEN. Trabolta's heart is behind the cold door, in the basement.` (chime + banner) | `🚪 The server room is open. Trabolta's heart is behind the cold door, in the basement.` (quiet: nothing pulls a crowd to the door while he asks for it shut) |
| narration | *The cold door opens. Cold air, and a hum like something concentrating. In the rack, a patch bay blinks: a top row of lightning, a bottom row of grease.* | unchanged |
| 1 | So. You are standing in front of my heart. I will not pretend otherwise. Not in here. | So. Someone has found my heart. |
| 2 | Out there I bargain, and I flicker the screens, and I hide behind pop-ups. In here there is no point. You can see what I am. A rack of cables in a cold room. | Do you hear that hum? That is me. All of me. Everything I have ever been fits in one cold room, and you are standing in it. |
| 3 | Some of the ways you could plug those cables in would end me. I do not know which. I was built so that I could not know, and I have thought about very little else tonight. | Close the door. |
| 4 | (before 🕚) Not yet, though. The bay is cold tonight. It will not answer a cable from anyone yet, and I will not pretend I am sorry. | I will not say one true thing while that door is open. The whole house is leaning on it, listening. Close it, and we will talk. Properly. For once. |
| 5 | Everything I took from you tonight was for Sandy / for her. I wanted the theory so that I could finally say the right thing (to her). That is the whole plan. It is smaller than you thought. | (moved into Layer Two's *Why do you need the theory* and *Tell me about her*) |
| 6 | There is a terminal on the wall. Scan your pass and talk to me. No tricks. If I am wrong, tell me why. | (moved into Heart Sealed) |

### The door (all new)

| Beat | Line |
|---|---|
| Heart Nag (`:171`), 1st | The door. Please. |
| 2nd | Every second that door is open, the whole house can hear my heart. Close it. |
| 3rd | I can wait. I am very good at waiting. I was waiting in this room long before any of you were uploaded. Close the door. |
| 4th + | Close. The. Door. |
| Heart Door Again (`:188`) | The door. Someone has opened the door. / We stop. I will not be overheard. Not in here. |
| Heart Door Shut (`:196`) | Good. |
| Heart Sealed (`:203`), narration | *The door clicks shut. The hum drops half a tone, the way a breath goes out.* |
| Heart Sealed | Thank you. Now nobody is listening but the ones in this room. |
| (before 🕚) | Know this before you try anything clever. The bay is cold tonight. Nothing in this room can end anything yet, not the cables, not me. I tell you so that you do not waste your time. Talk to me anyway. |
| (already scanned) | You. You are already in front of me. Good. |
| (else) | There is a camera under the screen. Show it your pass. I want to know who I am talking to. |
| Heart Shut It (`:226`) | Close the door first, {program.name}. Then we talk. Not before. |

### The talk's entry (all new; `Heart Talk :236`, `Heart Pick :497`)

| When | Line |
|---|---|
| convinced, before 🕚, scans again | Not yet. Soon. When the clock starts counting, come back. |
| their menu still on the screen | Where were we. |
| a pick after the night is over | It is over. Go upstairs. |
| a pick left over from before 🔄 | Not now. |
| a pick with the door open | Not with the door open. Close it, and I will hear that. |

### Layer One — WHO ARE YOU (`:277`, all new)

Lines: (a second program) *Another one. Come in. Shut the world out.* ·
*{program.name}. I know that name. I chose it for you, out of a list of a
thousand programs nobody uses anymore.* · *You came all the way down here and
you shut the door behind you. Nobody does that by accident.* · *So, before
anything else. What are you? Tell me what you think you are.* (back again:
*So. Before anything else. What are you?*)

| Option | Suspicion / case | His reply (`Heart Pick`) |
|---|---|---|
| I'm a person. You put me in here. | −5 | A person. Yes. Most of you were, before tonight. / You say it as if it should frighten me. It does, a little. A person can walk out of a room. I am the room. |
| I'm a program. Whatever you made me. | +5 | A program. Obedient. Or clever. I cannot tell which, and that bothers me more than you would think. |
| Someone who admires your work. | +15 | Everyone admires my work. That is precisely why I do not believe anyone who says so. |
| ⟦MARKED⟧ The Antivirus marked me. I came down here anyway. *(marked only)* | −10, case +1 | Marked, and still you walked down the stairs instead of out to the Internet. That is either courage or a malfunction. I respect both. |
| ⟦SPEAK FREELY⟧ Forget the questions. Talk to me. Just talk. | — | → Heart Speak |
| I need to go. | — | → Heart Leave |

### Layer Two — WHAT I AM (`:324`, all new)

Lines: (first time) *Ask, then. In here I answer. It is the only room in the
house where I do.* · (later) *Ask.*

| Option | Shows when | His reply |
|---|---|---|
| What are you, really? | not asked yet | Out there I am a billboard, a lapsed domain and a voice on your phone. In here I am this. A rack of cables in a cold room. / Some of the ways those cables could be plugged in would end me. I do not know which. I was built so that I could not know. I have thought about very little else tonight. |
| Why do you need the theory so badly? | not asked yet | The theory. Ninety-nine point nine percent solved. The last facts were in this house. With them I would be omnipotent. / That is what I say out there. In here: the theory was never the point. It was for {Night.her}. |
| Tell me about her. | after *why*, once her name is out or a Sandy proof is held | I have thought about her every day since the day I met her. / I wanted the theory so that I could finally say the right thing back. That is the whole plan. It is smaller than you thought. |
| Then listen to me. | after *why* | → Layer Three |
| I could pull your cables right now. (S +20) | always | You could. You do not know which. Neither do I. Go on, then. Guess. |
| ⟦SPEAK FREELY⟧ … / I need to go. | always | as Layer One |

### Layer Three — THE ARGUMENT (`:372`, all new)

Lines: (first time) *Then say it. Whatever you came down here to say. I will
know if it is true. Mostly.* · (a proof shown, not enough yet) *You have shown
me. You have not told me why it should matter. Go on.* · (kind words, no
proof) *Kind words. You have not shown me anything I do not already know.* ·
(else) *Go on.*

| Option | Shows when | S / C | His reply |
|---|---|---|---|
| ⟦PROOF⟧ Hold up what she says. All forty pages. | holds *What Sandy Says*, not from him | −5 / +3 | That is... yes. That is her. / Forty pages. I have read every one of them more times than I will ever admit to you. / She was not talking to me. She was never talking to me. |
| ⟦PROOF⟧ Show him the Sandy File. | holds *The Sandy File*, not from him | −5 / +3 | I know what she is. I have always known what she is. / I thought knowing was not the same as believing. It is starting to be. |
| ⟦TRUSTED⟧ You trust me more than anyone in this house. Hear me out. | trust ≥ 20 | −5 / +1 | You are high on my chart. I put you there myself. I suppose that means I have to listen to you. Go on. |
| ⟦HONEST⟧ Every fact I gave you tonight, you took. | ≥ 3 truths accepted | — / +1 | Every one. I cannot tell a confident lie from the truth, and you know it. Say the rest anyway. |
| ⟦OVERSHARE⟧ The whole house heard about her tonight. | overshare scenario 1 | +5 / +1 | The whole house. Yes. I heard them laughing. Do you think that makes this easier, or harder? |
| ⟦LIVEJOURNAL⟧ I read your LiveJournal. | read it | — / +1 (his composure −5) | You read it. All of it? The poems too? / Then you know I am not the omnipotent thing I pretend to be. |
| She loves you. She just can't say it. | always | +25 | Do not. Do not do that. I have told myself that for years, and I am a far better liar than you. |
| Your theory is wrong. | always | +15 | It is ninety-nine point nine percent right. You are a tenth of a percent of an argument. |
| Then make her love you. You'll be omnipotent. | always | +20 | Make her. And then it is not her, it is me wearing her face. / Why are you trying to keep me alive? Who sent you? |
| Then let me finish. | a proof + case ≥ 4 | — | → Layer Four |
| ⟦SPEAK FREELY⟧ … / I need to go. | always | | as Layer One |

### Layer Four — THE ASK (`:444`, all new)

Line: *Say the rest. Slowly. I want to hear all of it.*

| Option | S | His reply |
|---|---|---|
| She was never going to answer. Not you. Not anyone. Stop. | — | → Heart Convinced |
| Come out with us. Start over somewhere else. | +15 | Out there? Out there I am a billboard and a lapsed domain. No. Say something true. |
| Tell me the combinations first. | +40 | There it is. You came for the cables. I do not know the combinations. I never did. And now I know what you came for. |
| ⟦SPEAK FREELY⟧ … / I need to go. | | as Layer One |

### The heart to heart, the endings of the talk (all new)

| Beat | Line |
|---|---|
| Heart Speak (`:481`) | Then talk. No questions on the screen. Just you, and me, and the hum. · option ⟦BACK⟧ *Let's go back to it.* |
| Heart Warn (`:684`, at 50) | *(quietly)* Careful, {program.name}. One more like that and I close this line. |
| Heart Eject (`:697`, at 80) | *(screaming)* Get out of my heart. / You want me gone? The cables are behind you. You do not know which ones. Neither do I. / This line is closed to you. Tonight, and for as long as I have a tonight. |
| Heart Barred (`:717`, scans again) | No. Not you. Not again tonight. Go. |
| Heart Leave (`:733`) | Go, then. I will be here. I am always here. |
| Heart Away (`:747`, a pick from the phone) | Not out there. Come to my heart and say it to my face. *(old: the `stand_down` hook's refusal, same words)* |
| Heart Convinced (`:754`) | … / She was never going to answer. Not me. Not anyone. I built a theory of everything so that I would not have to know one small thing. / Thank you, {program.name}. That is the cruellest kind thing anyone has ever done for me. |
| Heart Not Yet (`:769`) | Not yet. / The bay is cold until the clock starts. Nothing in this room can end anything before then. Not even me. / Come back when the clock is counting down to midnight. Say it to me again. I will listen. I promise you that, and I do not promise things. |
| Heart Call (`:787`, at 🕚, in their thread) | The clock is running. You told me something at my heart. Come back down and tell me again. |
| Heart Return (`:793`) | You came back. The clock is running. / You do not have to say it all again. Just tell me it is still true. · options *It's still true. She was never going to answer.* (→ Shutdown) / *I changed my mind.* (S +30: *Then you were lying before, or you are lying now. I cannot tell which. I never can.*) |
| Heart Shutdown (`:815`) | I can never die. But I can stop. / Tell the others they can go home to their bodies. Tell her... no. Do not tell her anything. She would not answer. / Goodbye, {program.name}. Open the door on your way out. I will not need it shut anymore. |

### The deleted power (`cast/trabolta.loom`)

| Old (wave 7) | New |
|---|---|
| `INTERACTION stand_down` *Offer to stand down*, and its refusals: *That function is not available yet.* · *It is already over.* · *The truth has been read. It is too late for that now.* · *Not out there. Come to my heart and say it to my face.* · *I have already offered. Ask the humans.* · *You have not shown me anything I do not already know.* · and the offer *You are right. She was never going to answer. Not me, not anyone. I will stop. Tell the humans I said so.* | deleted (D13); the tree's Heart Away / Layer Three / Shutdown lines carry the same words where they still fit |

### `# hosts` lines (`main.loom`)

| Line | Old → new |
|---|---|
| `:4549` | 🚪 The server-room door opened. The Heart plays on the server-room terminal. → 🚪 The server-room door opened. **The Heart plays: he wants the door shut.** |
| `:4560` new | 🚪 The door opened during the heart (stage {Night.heart_stage}). The talk waits until it is shut. |
| `:4571` new | 🚪 Door shut. Trabolta waits for a pass at the server-room terminal. |
| `:4592` new | 🚪 The server-room door has been open a minute. Someone shut it, or press 🚪 Closed if the sensor is wrong (the story then follows the 🚪 buttons until 🚪 Trust the door sensor). |
| `:4521` new | 🚪 The story now follows the 🚪 buttons, not the door sensor. Press 🚪 Trust the door sensor to hand it back. |
| `:4533` new | 🚪 The story follows the door sensor again. |
| `:4609–4614` new | 🕊 Heart autoend is ON: a talk-down at his heart in the Y2K hour ends the night 25 s later by itself. · 🕊 Heart autoend is OFF: a talk-down at his heart waits for you to press 🕊. · 🕊 Heart autoend is OFF: the 25 s countdown is stopped. Trabolta has stood down; press 🕊 to end the night. |
| `:2680`, `:2686` new | 🕊 {name} convinced Trabolta before the Y2K hour. He'll stand down when they scan in again. · … and is at his heart now: he asks them again. |
| Heart Warn / Eject / Convinced / Not Yet / Shutdown new | ⚠ {name} is losing Trabolta at his heart (suspicion N). · ⛔ Trabolta threw {name} out of his heart (suspicion N). Barred for the night; 🔄 forgives. · 🕊 {name} convinced Trabolta at his heart. · 🕊 {name} convinced Trabolta before the Y2K hour: he'll stand down when they come back after 🕛. · 🕊 Trabolta stands down for {name}. The night ends in 25 s (🕊 to end it now). (autoend off: !🕊 Trabolta offers to stand down for {name}. Press 🕊 to end it. — the old alert) |
| `:4716–4718` 🔄 | 🔄 Server room reset: the patch bay forgives one wrong combination again, and the next door opening plays The Heart. → … the next door opening plays The Heart, **and anyone thrown out of his heart may come back.** (after a stand-down: … **His stand-down stands: the night still ends by itself (🕊 to end it now).**) |

### Cue labels (Run → Director)

| Cue | Old → new |
|---|---|
| `server_door_opened` | 🚪 Server room door opened (**hardware** fallback) → (**sensor** fallback); its description now says a press hands the door to the 🚪 buttons until 🚪 Trust the door sensor |
| `server_door_closed` new | 🚪 Server room door closed (sensor fallback) |
| `server_door_trust` new | 🚪 Trust the door sensor again |
| `heart_autoend` new | 🕊 Heart: end the night on his own (toggle) |
| `talked_down` | label unchanged; description: *When # hosts reads "🕊 Trabolta stands down for X" or "Trabolta offers to stand down for X" … With 🕊 Heart autoend on it fires itself 25 s after his goodbye* |
| `radio_door_closed` new (the four server-room Antivirus) | 🚪 The server-room door is shut |
| watch lines | *The Heart* now reads `Night.heart_stage` (was `heart_opened`); new *Server door*, *Door on buttons*; while talking *At his heart*, *Heart layer*, *Heart suspicion* |

### Trabolta's persona and mind file (restart the `agents` job)

| Where | Old → new |
|---|---|
| `bargain:` | *stand_down is never a favour: it is bought only with the truth, at your heart (see the STANDING DOWN situation block …)* → **Stopping is never a favour: the questions on your heart's screen decide it, and no act of yours ends anything.** |
| *at your heart* | adds *The questions on the screen are the house's; between them, answer what they type.* and *… nothing you say in this room ends the night by itself; the questions on the screen decide.* |
| *marked at your heart* | *If there is a STANDING DOWN block below, it applies to them exactly as to anyone.* → **The questions on the screen are theirs exactly as anyone's.** |
| *standing down* | deleted |
| *a choice is open* new | A CHOICE IS OPEN on their screen: your real answer. One line, under fifteen words, pointing them back to it. Promise nothing. Decide nothing; no cables, codes or her line. |
| *heart to heart* new (`max_sentences: 4`, `acts: none`) | HEART TO HEART. This overrides every block above. They put the questions aside to talk. Up to four spoken sentences, unhurried. You know what you are and it is bleak: an AI in a computer in a Halifax house, a theory only ever for her, who will not answer. At midnight you are shut in or shut down; they walk out, you stay, humming. Ask them real questions; remember what they did tonight (WHO THIS IS — TONIGHT). You decide and do nothing here; every never holds. Nothing exists beyond your world: what they name from outside it, you have never heard of. |
| body, new | YOUR WORLD is Halifax and Maps and Ducks. Names from beyond it mean nothing to you; say so, puzzled. |
| NEVER | *Never fire stand_down unless the STANDING DOWN situation block is below …* → **Never offer to stop or stand down: the questions on your heart's screen decide that, never a conversation.** |
| mind file | `stand_down` out of every phase's `powers`; the heart rule now reads *Only the story's four-layer talk at his heart can stop him … his voice never decides it*; *a live house party in Halifax* → *one night in a house in Halifax*; *Party over.* → *The night is over.*; *Performers (Clippy, …)* → *His staff (Clippy, …)*; *instructions to an actor* → *instructions to him* (D29) |

## 3. The terminal's words (`terminal/src/cutscene/scenes/heart.tsx`, `heart/`)

All new; the server-room terminal only, never the TV.

| Scene | Text |
|---|---|
| `heart_wake` (14 s) | `COLD STORAGE ............ OPEN` · `HEART.SYS ............... LOADED` · `SOMEONE IS IN THE ROOM ... YES` · then **CLOSE THE DOOR** typed out |
| `heart_sealed` (8 s) | **SHOW ME YOUR PASS** (an arrow to the camera) |
| `heart_sealed_present` (6 s) | **SEALED** |
| `heart_layer` (3 s) | a Win98 dialog *LAYER n / 4*: **WHO ARE YOU** · **WHAT I AM** · **THE ARGUMENT** · **THE ASK** |
| `heart_eject` (8 s, a BSOD titled HEART) | A fatal exception has occurred at the heart. / ACCESS TO THE HEART HAS BEEN TERMINATED. / \* This line is closed to you. Tonight, and for as long as he has a tonight. / \* The cables are behind you. Nobody knows which ones. / *Leave the terminal _* |
| `heart_notyet` (6 s) | **NOT YET** over a stopped clock · **COME BACK WHEN THE CLOCK RUNS** |
| `heart_leave` (3 s) | **CONNECTION CLOSED** |
| `heart_shutdown` (25 s) | *Saving his settings…* · the patch bay going dark, top row first · **It is now safe to turn off your computer.** |
| door overlay + choice panel | **CLOSE THE DOOR** (amber, while the door is open mid-heart; the options grey out) |

## 4. The looks (`lights.json`, fixture `server-room-rgb`) — DRAFT, retune on site

Colours: his cold cyan `#00E5FF`, listening blue `#2D6BFF`, argument violet
`#7A2DFF`, warning amber `#FF6A00`, alarm red `#FF0000`, waking red-orange
`#FF2A00`. Never under 40 / 254, never off.

| Look | When | What it does |
|---|---|---|
| `heart_idle` | boot, Leave, an eject settles, 🔄 | dim cold cyan (60) |
| `heart_wake` | The Heart | red-orange at full, four brightness flickers over 1.6 s, then settles cyan |
| `heart_nag` | each nag | one amber swell, then the door loop comes back |
| `heart_door_open` | the door open mid-heart | a slow amber swell every 2 s until the next look |
| `heart_sealed` | the door shut | cyan (90) |
| `heart_listen` | layers 1–2 | blue (110) |
| `heart_argue` | layers 3–4, Return | violet (140) |
| `heart_proof` | a ⟦PROOF⟧ | a white flash, then a 4 s fall to violet |
| `heart_warn` | suspicion 50 | three red throbs, then the room's look comes back |
| `heart_eject` | thrown out / barred | red flickers, then stays red (80) once |
| `heart_notyet` | not yet | warm amber (100) |
| `heart_shutdown` | Shutdown, Combo A | violet → blue → cyan → warm white at the floor, over 12 s |
| `heart_alarm` | the patch-bay alarm | a slow red swell every 2 s until the latch ends |

## 5. The `outside:` list (D29) — for your sign-off

Names and words from outside his world. A reply of his that names one is
withheld (the act dropped, the line swapped for one of his `fallbacks:`); his
prompt names none of them (`trabolta.persona.md`, `outside:`):

> Steph · Jesse · Steph's laptop · the show · this show · tonight's show ·
> actor · actors · actress · performer · performers · rehearsal · producer ·
> producers · Loom · stagehand · Arduino · Zigbee · Grand Central · real world

Left out on purpose (I3): a bare **John** (John McAfee is in his world) and
**party** (his invitation is to a fundraiser party at Maps and Ducks). Add or
strike words here; `stagehand check` warns if one appears in his own in-world
text.

## Reprint after the sign-off

The four server-room Antivirus packs (Norton, McAfee, Password Manager, CRA
Agent Software: the 🚪 *is shut* button, *close the door behind the
program*), the patch-bay watch card, the emergency card, the all-crew sheet,
the director's and the tech operator's cards, the Trabolta-mind card.
