// Server-room door sensor (Grand Central M4): everything you might need to
// change on the bench. The thresholds below are only the first-boot
// defaults: `save` stores the live ones in flash, and the server-room
// terminal re-sends its own stored ones on every connect anyway.
#pragma once

#define DOOR_FW "door-m4 1.0.0"
#define DOOR_BAUD 115200

// ── Pins (Adafruit Grand Central M4 Express) ──────────────────────────────
// LDR from 3V3 to A0, 10 kΩ from A0 to GND: more light → a higher reading,
// near 4095 with the LED shining straight into it.
#define PIN_LDR A0
// The LED's anode through 220 Ω (or a 2N7000 / NPN for a brighter LED).
// Wired here, the firmware blinks it and reads `lit − dark` (mode `mod`), so
// room light can't fake "closed". On 3V3 instead it is always lit (`steady`).
#define PIN_LED 2
// Optional: the LED's cathode → 47 Ω → GND, with A1 on the cathode. Set
// LED_SENSE to 1 once it is wired: a reading under 20 while the LED is
// driven is the blocking fault `led_dead`.
#define PIN_SENSE A1
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
