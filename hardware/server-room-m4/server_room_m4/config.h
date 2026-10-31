// The server-room M4 (Grand Central M4): the door sensor and the patch bay.
// Everything you might need to change on the bench. The thresholds below
// are only the first-boot defaults: `save` / `pb save` store the live ones
// in flash, and the server-room terminal re-sends its own stored door
// thresholds on every connect anyway.
#pragma once

// 1.2.0 (wave 22): the patch bay (patch.h). 1.3.0 (wave 57): the panel as it
// was built: four sources, four inputs on A0–A3. The name keeps its `door-m4`
// prefix: a terminal reads it as text, and N-20 / N-21 print it.
#define DOOR_FW "door-m4 1.3.0"
#define DOOR_BAUD 115200

// ── How the LED is wired (Q5, 2026-10-23) ─────────────────────────────────
// LED_STEADY  the LED on the board's 5V (or 3V3) through its own resistor,
//             always lit. level = the raw LDR reading. Room light that
//             reaches the cell reads as "shut", so the shroud is what keeps
//             it honest. Nothing probes or toggles PIN_DOOR_LED.
// LED_PULSED  the LED switched by PIN_DOOR_LED (through a resistor, or an NPN
//             for the 5 V LED: README): today's rig. The firmware pulses it
//             and reads lit − dark each frame, so steady room light (the red
//             heart bulb, a hall lamp) cancels out and can't fake "shut".
//             Wire name: `mod`.
// LED_AUTO    probe PIN_DOOR_LED at boot and pick one of the two (the wave 20
//             default; a re-probe blocks ≈ 0.9 s on every close while it runs
//             steady).
// This is only the first-boot / `reset` mode: `set mode …` + `save` still
// override it on the bench. Build another with -DLED_MODE=LED_STEADY, or edit
// the line below. The values are dl::Mode's (and the flash record's).
#define LED_AUTO 0
#define LED_PULSED 1
#define LED_STEADY 2
#ifndef LED_MODE
#define LED_MODE LED_PULSED
#endif

// ── Pins (Adafruit Grand Central M4 Express) ──────────────────────────────
// LDR from 3V3 to A14, 10 kΩ from A14 to GND: more light → a higher reading,
// near 4095 with the LED shining straight into it. Always 3V3, never 5V: the
// SAMD51's pins are not 5 V tolerant.
#define PIN_DOOR_LDR A14
// LED_PULSED: the pin that switches the LED (3.3 V logic). A red LED straight
// off the pin through 220 Ω (≈ 6 mA), or the 5 V LED through an NPN whose
// base takes this pin through 1 kΩ (README). LED_STEADY drives it high and
// leaves it there (harmless with nothing on it).
// (Not PIN_LED: the board's variant.h already names pin 13 that.)
#define PIN_DOOR_LED 23
// Optional: the LED's cathode → 47 Ω → GND, with A4 on the cathode (A0–A3 are
// the patch bay's). Set LED_SENSE to 1 once it is wired: a reading under 20
// while the LED is driven is the blocking fault `led_dead`. Without it a dead
// LED reads as an open door in either mode (the LDR alone can't tell the two
// apart). Only on a cathode that 47 Ω holds near GND (the LED straight off
// D2, or a 5 V LED with its resistor on the anode side), never on an NPN's
// collector.
#define PIN_DOOR_SENSE A4
#define LED_SENSE 0

// ── Defaults (12-bit readings, 0–4095) ────────────────────────────────────
#define DEF_CLOSE 1800   // closed once level ≥ close for CLOSE_MS
#define DEF_OPEN 1200    // open once level ≤ open for OPEN_MS
#define DEF_SETTLE 150   // ms the CdS cell is given per LED phase (20–1000)
#define CLOSE_MS 1000
#define OPEN_MS 250
// Between open and close the last state holds (the hysteresis band).

#define STEADY_FRAME_MS 50   // one reading every 50 ms with the LED always on
#define REPORT_MS 1000       // a `door` line at least once a second
#define FAULT_MS 2000        // a fault / warning needs 2 s, and clears after 2 s clean
#define CAL_MS 2000          // `cal closed` / `cal open` average 2 s of level
#define AUTO_MIN_DIFF 200    // auto: D2 high minus D2 low ≥ 200 → the LED is on D2
#define CAL_MIN_SPAN 200     // calibration refused when closed − open < 200

// ── The patch bay (wave 22, patch.h; the built panel since wave 57) ───────
// Two rows of 8 ¼" TRS jacks, A and B, tip and sleeve only. Eight are live and
// eight are decoys, wired to nothing:
//
//   source  jack  level        input  jack  pin
//   V1      B8    0.965 V      D1     A5    A0
//   V2      B7    1.442 V      D2     A7    A1
//   V3      B4    2.033 V      D3     A6    A2
//   V4      B2    3.019 V      D4     A4    A3
//
// V<k> and D<i> are the wire's names (`patch_changed {combo}`); people read the
// panel's. A cable from V<k> into D<i> puts V<k>'s level on D<i>'s pin; an
// empty input reads ≈ 0. A cable in a dead jack, or from A to A or B to B,
// reads nothing at all (README). Keep the table in step with terminal
// PatchSetup.tsx, core/scripts/titi-facts.ts and scripts/accept/N-21.sh.
// Set PB_INPUTS 0 for a build with no bay: hello / cfg then say pbd 0 and
// no `patch` line is ever sent.
#ifndef PB_INPUTS
#define PB_INPUTS 4
#endif
#define PB_SOURCES 4
// D1 … D4 in order (A14 is the LDR, A4 the optional LED sense; A5–A13, A15 spare).
#define PB_PINS {A0, A1, A2, A3}
// The sources' nominal levels (12-bit counts: the volts above on the 3.3 V
// reference), the first-boot and `pb reset` values. `pb learn V<k>` replaces
// each with what the bench reads, `pb save` keeps them.
#define PB_NOMINAL {1197, 1789, 2523, 3746}
#define PB_FLOOR 150      // under this an input is empty (≈ 0.12 V)
#define PB_TOL 200        // within this of a level it is that source (≈ 160 mV;
                          //   the closest two levels are 592 counts apart)
#define PB_FRAME_MS 50    // one scan of every input every 50 ms
#define PB_SETTLE_MS 1000 // the whole bay must hold this long to count (a plug's tip
                          //   brushes the sleeve on its way in)
#define PB_REPORT_MS 1000 // a `patch` line at least once a second
#define PB_LEARN_MS 1000  // `pb learn V<k>` averages this long
