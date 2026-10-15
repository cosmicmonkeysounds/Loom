// Server-room box: everything you might need to change on the bench.
// Wi-Fi credentials live in secrets.h (git-ignored; copy secrets.example.h).
#pragma once

// ── Network: static addresses, no DHCP dependence (HW-NET-08) ──────────────
// The broker is the house Mac (Mosquitto) at its static IP, on the
// password-only LAN listener (:1884, user/password in secrets.h — see
// scripts/house-mac/alexa.md → "Lock down the broker"); the anonymous
// listener is bound to 127.0.0.1 for stagehand + Zigbee2MQTT on that Mac.
// scripts/accept/K-05.sh checks the Mac owns this address. The box's own
// address sits outside the GL-MT3000's DHCP pool (.100–.249 by default).
#define SR_BROKER_IP "192.168.8.10"
#define SR_BROKER_PORT 1884
#define SR_IP "192.168.8.21"
#define SR_GATEWAY "192.168.8.1"
#define SR_SUBNET "255.255.255.0"
#define SR_DNS "192.168.8.1"
#define SR_CLIENT_ID "serverroom"
// Keepalive: the broker publishes the LWT ~1.5× this after the box dies.
#define SR_KEEPALIVE_S 10

// ── Pins (ESP32-DevKitC, classic WROOM-32; NOT a WROVER: 16/17 are PSRAM) ──
#define PIN_REED 23        // reed switch: GPIO ↔ GND, closed = LOW
#define PIN_TAPE 19        // copper tape / plunger fallback, same circuit
#define PIN_SDA 21         // I²C to both MCP23017s
#define PIN_SCL 22
#define PIN_RING 18        // WS2812 data → 74AHCT125 → 330 Ω → ring DIN
#define PIN_RELAY 25       // 3.3 V-trigger relay module ("click"), HIGH = on
#define PIN_DF_RX 16       // ESP RX2 ← DFPlayer TX
#define PIN_DF_TX 17       // ESP TX2 → 1 kΩ → DFPlayer RX
#define PIN_CAL_BUTTON 0   // the DevKit's BOOT button: hold 3 s = recalibrate

#define MCP_TOP_ADDR 0x20     // V1–V12 (A0–A2 to GND)
#define MCP_BOTTOM_ADDR 0x21  // D1–D12 (A0 to 3V3)
#define I2C_HZ 400000

// ── Door ───────────────────────────────────────────────────────────────────
// DOOR_BOTH: open only when every connected input says open. An unplugged
// input floats HIGH (= open) through its pull-up, so it simply drops out and
// the other one decides. Use DOOR_REED / DOOR_TAPE to force one input.
#define DOOR_MODE DOOR_BOTH
#define DOOR_OPEN_MS 300   // report open after 300 ms stable
#define DOOR_CLOSE_MS 50   // report closed after 50 ms stable

// ── Ring + sound ───────────────────────────────────────────────────────────
#define RING_LEDS 16
#define RING_MAX_BRIGHTNESS 80   // of 255; ~1 A at full white otherwise
#define DF_VOLUME 25             // 0–30
// microSD layout: /mp3/0001.mp3 …  (played by number, never by FAT order)
#define TRACK_SIREN 1
#define TRACK_CONNECT 2
#define SIREN_SECONDS 3          // the local siren's length (HW-DOOR-05)
#define RELAY_PULSE_MS 60

// ── Patch bay ──────────────────────────────────────────────────────────────
#define SCAN_INTERVAL_MS 50      // ~20 Hz; a full scan takes ~12 ms
#define CAL_HOLD_MS 3000
