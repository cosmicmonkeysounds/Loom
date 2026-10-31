# The Task Manager costume

An old iPad 2 strapped to Task Manager's chest shows three beige keys, CTRL, ALT
and DELETE. Whoever holds all three gets a Windows 95 *Close Program* dialog of
things that happen to the house: LIGHTS, SOUNDS, MUSIC, AD STORM, GLITCH and POKE
TRABOLTA. Five seconds with no touch and it goes back to the keys.

**None of this has been tried on a real iPad.** It was tested in Chromium and
WebKit on a laptop, the script is parsed as ES5, and the live server's TLS
handshake was read with `openssl`. Do the [strap test](#strap-test) before the
doors, and if the iPad can't reach the site, go straight to
[the relay](#if-the-ipad-cant-reach-the-site).

## What a guest can do

Anyone at the party can press it, so the server decides everything. The page only
ever says *Done* or *Not Responding*, and it says *Not Responding* for every
refusal and every network failure.

A press is refused:

- before the doors, during a beat's lines on the TV, and while anyone is on the teleprompter: a phone showing the scene, until its ✓ Done or until that phone goes (about 12 s), or his lines waiting for it. A scene nobody opened refuses nothing once its lines are said;
- from the final reveal on: the bobbing, Grok Prom and the advice poll, the endings, the songs, the monologue and the awards;
- for 8 s after any press that landed, and for longer after a heavy one (AD STORM 60 s);
- LIGHTS, during the alarm, a blackout, or while Trabolta has a room's lights out;
- SOUNDS and MUSIC, with the router offline; LIGHTS, with the lights module offline;
- MUSIC, while a director or a host has the soundtrack by hand (a Stop or a chosen scene), until they press *Follow the story*;
- AD STORM and GLITCH, **outside a talk scene** (see below);
- POKE TRABOLTA, while he is asleep or a reply of his is owed.

What each one does:

| Button | What happens |
|---|---|
| LIGHTS | The living room only, for 6 s, then the story's look comes back. If Trabolta puts a room out in those 6 s, only the living room goes back, and not at all if that room is the Desktop. No safety fixture, ever. |
| SOUNDS | A house sound from `audio.json`. |
| MUSIC | Skip the track, hand the house to the afterparty playlist for 45 s, or go back to the story's scene. If someone else takes the soundtrack in those 45 s, it stays theirs. |
| AD STORM | The story's `ad_burst`, three times, 4 s apart. A beat that starts ends it. |
| GLITCH | The story's `ad_burst`, once. |
| POKE TRABOLTA | One of his six lines, on the TV and every phone in the Desktop, like a canned Talk line. |

**AD STORM and GLITCH only work in a talk scene past his introduction** (the
bottle, the ad attack, the beans), because the story's `ad_burst` does. Before
the ad hijack, during the bottle, it is only a flicker, so it can't spoil the
hijack. The rest of the night they read Not Responding.

Every fire is on Run's log as `costume_pressed` with the button's name, and none
goes to `# hosts`.

## The crew's switch

**Run → Terminals → 🎭 Costume.** **On / Off** is the kill switch: off, the menu is
empty and every press is refused. It survives a restart. **Copy link** gives the
iPad's link. The link holds the costume's token, which can do nothing but read
this menu and fire it, and it is not the mod code. Treat it like a code all the
same: send it to the iPad, never post it.

## The menu

`core/examples/trapped-in-the-internet/costume.json`, read live like the credits:
`pnpm sync-show` changes it with no release and no reload, and with no usable
file the server uses the same menu from code (`core/src/costume.ts`). At most six
buttons on a screen, five in a list (plus Cancel), 16 characters a label.

```jsonc
{ "id": "lights-red", "label": "RED ALERT", "light": { "to": ["living"], "set": { "state": "ON", "color": "#ff0000", "brightness": 254, "transition": 0 } } }
{ "id": "spot", "label": "SPOTLIGHT", "look": "lights_truth_time" }
{ "id": "sound-zip", "label": "ZIP", "sound": "zip" }
{ "id": "music-next", "label": "NEXT TRACK", "music": { "action": "next" }, "cooldownS": 20 }
{ "id": "music-party", "label": "AFTER PARTY", "music": { "action": "scene", "scene": "afterparty" }, "holdS": 45 }
{ "id": "adstorm", "label": "AD STORM", "cue": "ad_burst", "times": 3, "everyS": 4, "cooldownS": 60 }
{ "id": "poke", "label": "POKE TRABOLTA", "poke": true }
```

Keep lights items on `living`. Every story look covers the living room, so the
restore gives all of it back; a story look that covers only the living room would
leave any other room stuck on the costume's colour. A look that reaches a safety
fixture is refused at the press, whatever the file says (`loomcheck` warns), and
most of `lights.json`'s looks do, because they set the halls too.

## Getting it onto the iPad

An iPad 2 stops at iOS 9.3.5, and its root store has no ISRG root. The live chain
runs YE2 → Root YE → ISRG Root X2 → ISRG Root X1, so the root it needs is X1.
It can't fetch that from letsencrypt.org, for the same reason it can't reach
anything else, so the MacBook serves it. Keep the iPad on the party's Wi-Fi, the
MacBook's LAN.

1. On the MacBook, with the link copied from Run → Terminals:

   ```bash
   COSTUME_LINK='<the link>' node scripts/house-macbook/costume-root.mjs
   ```

   It takes the root from the Mac's own system roots, checks its fingerprint and
   prints an address.
2. On the iPad, in **Safari**: open that address and tap **1. Install ISRG Root
   X1**. Settings opens the profile: **Install**, enter the passcode if asked,
   **Install**, **Done**. On iOS 9 a profile's root is trusted at once; there is no
   *Certificate Trust Settings* page to visit.
3. Back in Safari, tap **2. Open the costume**. The small light top right of the
   keys turns **green** when the server answers: that's the proof.
4. Stop the script (Ctrl+C): its page holds the link.
5. **Add to Home Screen** from the share sheet, and open it from the icon, so it
   has no address bar. If the icon loses the link, delete it and repeat this step.
6. Settings → General → **Auto-Lock: Never**.
7. Settings → General → **Multitasking Gestures** (under *Multitasking*, on some
   versions): off, or a chest full of fingers will throw you to the home screen.
   Check Settings → General → Accessibility → **Zoom** is off.
8. Settings → General → Accessibility → **Guided Access**: on, with a passcode. Open
   the page, triple-click the Home button, **Start**. Now nobody can leave it.

Battery: bring it to the night full, on a power bank if you have one.

### If the iPad can't reach the site

The light stays dark, or Safari says it can't open the page. Nothing can be done
about that on the night, so use the relay: the iPad talks plain http to the
MacBook, and the MacBook talks to the site.

```bash
COSTUME_LINK='<the link from Run → Terminals>' node scripts/house-macbook/costume-relay.mjs
```

It prints an address like `http://192.168.1.20:7108/`. Open that on the iPad, then
go on from step 5. The token stays on the MacBook. The MacBook must stay awake and
on the same Wi-Fi, and if its address changes, redo step 5. Keep the MacBook's
firewall from blocking Node.

### Strap test

With the iPad strapped on, in Guided Access, in the real lighting:

- Hold CTRL, ALT and DELETE with three fingers of one hand, then of two people's.
  Each key should light while it's held, and the dialog should open on the third.
- Leave it alone for five seconds. It should go back to the keys.
- Open LIGHTS, press Cancel, and then let it time out.
- With the doors open and the house up, press one thing of each kind and listen.
- On Run, flip 🎭 Off, press something and read *Not Responding*, then flip it back
  on.
- Walk around and lean on things. If a strap or a bag presses the screen, the keys
  will light. That does no harm until all three are held.
