// Copy to secrets.h (git-ignored) and fill in the house network.
// The show runs on the GL-MT3000's SSID; the ISP spare router uses the same
// SSID + PSK (HW-NET-08), so this never changes on the night.
#pragma once
#define WIFI_SSID "CHANGE-ME"
#define WIFI_PSK "CHANGE-ME"
// The broker's password-only LAN listener (mosquitto_passwd … props).
#define SR_MQTT_USER "props"
#define SR_MQTT_PASS "CHANGE-ME"
