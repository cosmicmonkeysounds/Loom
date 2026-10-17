// The box's MQTT contract. stagehand/trapped.house.yaml is the other side;
// stagehand/tests/test_serverroom_firmware.py keeps the two in step.
#pragma once

// Retained "online" on connect; the broker publishes retained "lost" (LWT).
#define T_HEALTH "health/serverroom"

// box → house
// {"open": bool, "tape": bool, "mode": "tape"} on change + on every reconnect
// ("reed" only in a mode that reads the reed), RETAINED (stagehand's edge
// rule primes on it; a restart fires nothing). The contact is direction-blind:
// an entry with the keypad code and an exit by the inside handle both open it.
#define T_DOOR "sensors/serverroom/door"
// {"pairs": [["V2","D5"],…], "combo": "V2-D5,…", "count": n, "complete": bool}
// once a new patch has held for 1 s. NOT retained.
#define T_PATCH_STATE "sensors/patchbay/state"
// {"ok", "source", "baseline", "broken", "stuck", "door_mode",
//  "reed_polarity", "tape_polarity", "audio", "ip"},
// retained, for the bench (no rule listens).
#define T_PATCH_DIAG "sensors/patchbay/diag"

// house → box (all under show/serverroom/#)
#define T_SHOW_ALL "show/serverroom/#"
// The ring's lock INDICATOR only: the real door has a standalone keypad lock
// that nothing networked drives.
#define T_LOCK "show/serverroom/lock"            // {"state": "locked"|"unlocked"} (retained)
#define T_ALARM "show/serverroom/alarm"          // {"state": "on", "seconds": 120} | {"state": "off"}
#define T_RING "show/serverroom/ring"            // {"mode": "green"|"red"|"amber"|"white"|"blue"|"off"|"clear", "seconds": 90}
#define T_SOUND "show/serverroom/sound"          // {"track": N, "volume": 0-30} | {"track": 0} = stop
#define T_CALIBRATE "show/serverroom/calibrate"  // payload must contain "empty" (all cords out)
