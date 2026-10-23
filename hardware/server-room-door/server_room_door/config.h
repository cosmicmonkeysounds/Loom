// Server-room door sensor (Grand Central M4): everything you might need to
// change on the bench. The thresholds below are only the first-boot
// defaults: `save` stores the live ones in flash, and the server-room
// terminal re-sends its own stored ones on every connect anyway.
#pragma once

#define DOOR_FW "door-m4 1.1.0"
#define DOOR_BAUD 115200

// ── How the LED is wired (Q5, 2026-10-23) ─────────────────────────────────
// LED_STEADY  the LED on the board's 5V (or 3V3) through its own resistor,
//             always lit: today's rig. level = the raw LDR reading. Room
//             light that reaches the cell reads as "shut", so the shroud
//             is what keeps it honest. Nothing probes or toggles D2.
// LED_PULSED  the LED switched by D2 (through a resistor, or an NPN for the
//             5 V LED: README). The firmware pulses it and reads lit − dark
//             each frame, so steady room light (the red heart bulb, a hall
//             lamp) cancels out and can't fake "shut". Wire name: `mod`.
// LED_AUTO    probe D2 at boot and pick one of the two (the wave 20 default;
//             a re-probe blocks ≈ 0.9 s on every close while it runs steady).
// This is only the first-boot / `reset` mode: `set mode …` + `save` still
// override it on the bench. Build another with -DLED_MODE=LED_PULSED, or edit
// the line below. The values are dl::Mode's (and the flash record's).
#define LED_AUTO 0
#define LED_PULSED 1
#define LED_STEADY 2
#ifndef LED_MODE
#define LED_MODE LED_STEADY
#endif

// ── Pins (Adafruit Grand Central M4 Express) ──────────────────────────────
// LDR from 3V3 to A0, 10 kΩ from A0 to GND: more light → a higher reading,
// near 4095 with the LED shining straight into it. Always 3V3, never 5V: the
// SAMD51's pins are not 5 V tolerant.
#define PIN_DOOR_LDR A0
// LED_PULSED: the pin that switches the LED (3.3 V logic). A red LED straight
// off the pin through 220 Ω (≈ 6 mA), or the 5 V LED through an NPN whose
// base takes this pin through 1 kΩ (README). LED_STEADY drives it high and
// leaves it there (harmless with nothing on it).
// (Not PIN_LED: the board's variant.h already names pin 13 that.)
#define PIN_DOOR_LED 2
// Optional: the LED's cathode → 47 Ω → GND, with A1 on the cathode. Set
// LED_SENSE to 1 once it is wired: a reading under 20 while the LED is
// driven is the blocking fault `led_dead`. Without it a dead LED reads as an
// open door in either mode (the LDR alone can't tell the two apart). Only on
// a cathode that 47 Ω holds near GND (the LED straight off D2, or a 5 V LED
// with its resistor on the anode side), never on an NPN's collector.
#define PIN_DOOR_SENSE A1
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
