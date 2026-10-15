# Kiosk settings — wall tablets and the TV

How every screen in the house is set up so it stays on, stays in the
terminal, and can't be reconfigured by a guest (OCT31 K-15, CHECKLIST
SW-SCR-19 / SW-SCR-23). The app's half is in `terminal/src/kiosk.ts`:

- **Wake Lock.** The terminal asks for a Screen Wake Lock at boot, again on
  the TOUCH TO WAKE tap, and again every time the page comes back into
  view (the browser drops the lock whenever the page is hidden). It needs
  HTTPS (we have it: `https://app.mapsandducks.com`) and Chrome 84+. The
  page reports the state on `<html data-wake-lock="held|off|unsupported">`.
  On a tablet older than Chrome 84 it is `unsupported`, and Fully Kiosk's
  *Keep Screen On* below does the job alone.
- **⚙ needs a 2 s hold.** A short tap or click on the gear does nothing; a
  bar fills under it while held, and setup opens at 2 s. Setup can forget
  the terminal's token, so this is what keeps a curious guest out of it.
  (The PIN on top is W-15 / SW-SCR-20, not this item.)

## Android wall tablets — Fully Kiosk Browser PLUS

Setting names are from Fully Kiosk Browser 1.5x. If one has moved, use the
search box at the top of Fully's Settings.

| Section | Setting | Value | Why |
|---|---|---|---|
| Web Content | **Start URL** | `https://app.mapsandducks.com/terminal/` | The config (name, spot, token) lives in the page's localStorage, so the bare URL reopens this terminal as itself. Provision once with the `?code=…&name=…&spot=…` link (README), then set this. |
| Web Content | **Autoplay Videos** | ✔ | Media may start without a tap. |
| Web Content | **Autoplay Audio** (if your version lists it separately) | ✔ | **The voice.** Without it the terminal can't speak until someone taps TOUCH TO WAKE after every reload. Still tap it once after a reload: Web Audio wants that gesture on some WebViews anyway. |
| Web Content | **Enable Webcam Access** | ✔ | The pass scanner. Android also asks for the camera permission the first time: allow. |
| Web Content | **Enable Microphone Access** | ✘ | Not used. |
| Web Browsing | **Enable Pull to Refresh** | ✘ | A pull would reload the page and lose the audio unlock mid-show. |
| Web Browsing | **Swipe to Go Back / Navigate** | ✘ | Same reason. |
| Web Browsing | **Reload on Screen On** | ✘ | Same reason. |
| Web Auto Reload | **Auto Reload after Page Error** | ✔ | A network blip at boot recovers by itself. |
| Web Auto Reload | **Auto Reload on Idle** | ✘ | **Never reload on a timer.** A reload loses the audio unlock. |
| Advanced Web | **Wait for Network Connection** | ✔ | Boot waits for the Wi-Fi before loading the page. |
| Toolbars & Appearance | **Show Address Bar / Status Bar / Navigation Bar** | ✘ | Full screen. |
| Device Management | **Keep Screen On** | ✔ | The belt to the Wake Lock's braces. |
| Device Management | **Screen Off Timer** | 0 (off) | |
| Device Management | **Screen Brightness** | ~70 % | Readable, not a heater. |
| Screensaver | **Screensaver Timer** | 0 (off) | The terminal has its own attract screen. |
| Power | **Launch on Boot** | ✔ | A power cut brings the terminal back. |
| Kiosk Mode (PLUS) | **Enable Kiosk Mode** | ✔ | Locks the tablet to Fully. |
| Kiosk Mode (PLUS) | **Kiosk Exit PIN** | a PIN the tech op knows | Not printed anywhere guests can see. |
| Kiosk Mode (PLUS) | **Disable Status Bar / Home / Recent Apps / Power Button** | ✔ | |
| Other | **Restart on Crash** | ✔ | |
| Remote Admin (PLUS) | **Enable Remote Administration** | ✔ (LAN only) | Battery and screen state from a laptop. **Never** press *Reload* from it mid-show (see above). |

Android itself: Settings → Display → Sleep at its maximum; Developer
options → *Stay awake while charging* ✔ (both belt-and-braces). Battery
optimisation off for Fully.

**Speaker tablets.** Media volume up, then lock it with Fully's *Volume
Limits* if the version has it. Set the volume before the party, not after.

## iPads (if any are used)

Settings → Display & Brightness → Auto-Lock: **Never**; Accessibility →
Guided Access ✔ with a passcode; add the terminal to the Home Screen and
start Guided Access on it. Every reload needs a TOUCH TO WAKE tap (iOS has
no autoplay setting).

## The TV — the house Mac on the long HDMI run

There is no separate TV computer: the house Mac (the Ollama laptop) drives
the TV over HDMI and runs the mirror (`view=mirror`) full screen on it.

- System Settings → Lock Screen → *Turn display off on power adapter when
  inactive*: **Never**; Energy → *Prevent automatic sleeping when the
  display is off* ✔. The page's Wake Lock also holds the display while the
  window is visible. For belt and braces run `caffeinate -dis &` in a
  terminal for the night.
- Chrome on the TV display, its own profile:
  `open -na "Google Chrome" --args --user-data-dir="$HOME/.loom-tv" --kiosk --autoplay-policy=no-user-gesture-required "https://app.mapsandducks.com/terminal/"`
  — `--kiosk` is full screen with no chrome; the autoplay flag means no wake
  tap is ever needed on the TV.
- The ⚙ on the mirror is a 2 s mouse hold as well.

## The bathroom terminal

**Mounted outside the door, never inside.** The house map's `bathroom`
spot is on the hall wall beside the bathroom door (`house.json`: room
`hall`, facing into the hall), so its camera looks at the hall, not the
bathroom. Provision it with `spot=bathroom`. If it ever has to go inside,
run it as `view=face` with the camera taped and say so to the tech op —
but the plan is outside.
