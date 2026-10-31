# Wave 55: a headset that doesn't hurt

Guests said the VR game was sickening: head movement, turning and moving all
gave eye strain. This wave measured why on a real Quest 3 (runtime 209.166,
Godot 4.7.2, vendors 5.1.0), with a nine-agent research pass and a skeptic
over it, and fixed what it found. Branch `oct31-w55/vr-comfort`. VR only: no
server, story or web change, so it ships as an APK. No new show text.

Head movement alone pointed at the display and the picture, not at locomotion,
and that is where most of it was.

## C1. Before the doors: Battery Saver off

**Settings → General → Power → Battery saver must be off.** It was on, and it is
why every fix for 72 Hz failed: it caps the whole headset at 72 Hz, cuts the
brightness to 40% and sets foveation level 3, and no app can ask past it.

- Proof: `LP=1` on all 987 VrApi lines (Meta: *Whether Battery Saver mode is
  enabled*), the Power page's switch on, and `Fov=3` with the game asking for 0.
  Switched off: `LP=0`, `Fov=0`, and the game reached 90 Hz on its own request
  for the first time.
- Read it from the log: `adb logcat -d -s VrApi`, then `LP=0`. Or
  `node reinstall/vr/tools/quest-frames.mjs <dump>`.
- The headset last ran flat (`shutdown,battery`). Whether a low battery turns
  the saver back on could not be confirmed, so check it on the night.
- Fallback with the saver stuck on: `adb shell setprop debug.oculus.refreshRate 90`,
  then relaunch. It worked here. It is lost on a reboot, and it does not
  lift the brightness cut. Whether it survives sleep is not tested.

The cable: a PC's USB port gave 5 V at 0.9 A and the headset still lost charge
under the game (99% to 57% in 80 minutes of testing). Use the wall charger.
On USB to a PC with Meta Horizon Link, a Link dialog takes focus at every launch.

## C2. What changed, and what was proven

| What | Why | Proven |
|---|---|---|
| 4× MSAA on `medium` (`low` off); foveation 0, `foveation_with_subsampled_images=false` | Nothing was ever anti-aliased. Foveation was never on: `vrs_mode` was never set. The black void of 2026-10-29 was probably Godot #123406 | Screenshots in the house, no void; steady 90 Hz |
| House textures cut 8× finer, filtered with anisotropy | NEAREST texels crawl with any small head move, and MSAA cannot touch them | Screenshots: the chunky look stays |
| The vignette measured from where each eye looks | It was centred on the eye buffer, 17° outwards per eye: two rings 34.5° apart that cannot be fused | A forced small ring: round, on the eye's axis. One eye seen; the other is the same maths |
| `refresh_rate_changed`, read back every frame | `display_refresh_rate_changed` does not exist. Release builds ignore that silently, and any real 90 Hz would have moved everyone 25% too fast | Headset: 90 Hz, physics 90 Hz |
| `RefreshRate`: ask on focus, keep watching | The display can read the shell's 90 at focus and fall to 72 about 60 ms later | Headset; tests |
| CPU and GPU at sustained high | Left dynamic, the clocks rise only after a missed frame | Frame p95 fell from 11.97 to 10.8 ms |
| Neon's 14 Hz stutter is one dip; the hand's shards 11 → 3 Hz | Both broke the project's own 3 Hz rule | Tests |
| Stars and neon wider, dimmer, fogged; haze still, half strength | Thin bright lines and a second moving layer over the floor | Screenshots; comfort untested |
| Chevrons counted back from the duck | They were laid from the feet and hopped twice a second | Tests |
| Walls of air down a flight's long sides | A body walked off the open lower half and fell 0.86 m | Tests on the show map, and they fail without them |
| The walk at 0.6 on a stair, the eye eased to the body's height (0.12 s) | The eye climbed 0.83 m/s with a hard kick at the foot. The player's own head is never delayed | Tests |
| `MAX_HEAD_GAP` 0.05 → 0.08, `wall_min_slide_angle` 0 | The world slid with the head near a wall; a body stuck, then lurched | Tests |
| Backwards at half pace; turn 70 → 50°/s | **Judgement calls.** Nothing measured says 50: feel it, it is one constant | Not proven |
| One head-locked plane at 1.2 m; font mipmaps | The HUD and the captions sat at 1.8 and 1.1 m, in front of nearer walls | Not seen on a headset |
| Hitches: glyphs drawn in the lobby, the feeds' shader held, the mic's working route first | Mid-walk stalls of 50–130 ms | Mic path on the headset; the rest unmeasured |

## C3. The numbers

The show map, medium tier, autopilot walks, compositor's log.

| Build | Rate | Frame p50 / p95 | Stale in the steady walk |
|---|---|---|---|
| Before (rate forced) | 90 Hz | 10.3 / 12.0 ms | bursts of 4–11 |
| 4× MSAA, clocks held | 90 Hz | 9.4 / 10.8 ms | 0 over 900 frames |
| All of it | 90 Hz | 8.4 / 10.6 ms | one burst of 4 in 24 s |

Loading a walk still drops 70–130 frames, behind the fade to the house. 120 Hz
was not tried: it costs 8.3 ms a frame and heat, on a long night.

## C4. Keep it that way

- Never set `vrs_mode` with `foveation_with_subsampled_images` on and MSAA on. If
  the void ever returns, try 2×, then the previous APK.
- `test/run.sh`'s headless runs do not compile shaders or reach `_start_xr`. A
  wrong signal name or a bad shader passes them: check a headset.
- `tools/quest-win.ps1 -Package …test -Autopilot -Guest g-…` walks a copy beside
  the show's, and refuses to replace it. `-Offline` needs no server or cable.
- The screenshots (`com.oculus.metacam`) are a central crop of one eye, about
  ±36°: the vignette's real ring falls outside them.

## C5. People, not code

The research's first item, ahead of any build: a shared headset is usually
badly fitted, and no software can fix that.

- Turn the **lens spacing wheel** (bottom left) until it is sharp, for every
  guest. Wipe the lenses, and check for fog in a warm room.
- A 20-second brief: *move your head slowly; turn your body, the stick is for
  walking; take it off at the first bad feeling*.
- Send anyone who gets carsick to the web game in the tent.

## C6. Left for a decision

- **Snap turning** is the best-evidenced locomotion change left (22.5° with a
  blink cut SSQ about 40–48% against a much faster smooth turn than ours, and
  should not be stacked with the walking vignette). Wave 33b removed a 45°
  version with no blink, which is not the tested form. It needs a person to try
  it, and the tutorial's TURN step. Not done.
- **1.2× render scale**: sharper, but 1.44× the pixels on a GPU at 65–75%. Not done.
- **Lobby text** is about 1° tall. **Z-fighting** along wall joins was not audited.
