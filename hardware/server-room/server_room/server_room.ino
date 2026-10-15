// Server-room box (Trapped in the Internet, N-08): one ESP32-DevKitC
// (WROOM-32) that
//   - reports the server-room door (reed + copper-tape fallback) on
//     sensors/serverroom/door,
//   - scans Trabolta's heart, the 2×12 patch bay, on two MCP23017s and
//     reports the patch on sensors/patchbay/state,
//   - shows the lock state / alarm on a WS2812 ring and plays the siren +
//     cable click on a DFPlayer Mini, driven from show/serverroom/*.
// Wiring, topics and the bench procedure: ../README.md. The logic lives in
// the pure headers (patchbay.h, door.h, ring.h, msg.h), tested on a laptop
// by ../test/run.sh.
//
// Libraries (arduino-cli lib install …): PubSubClient, "Adafruit NeoPixel",
// DFRobotDFPlayerMini. Board: esp32:esp32:esp32 (core 3.x).

#include <Adafruit_NeoPixel.h>
#include <DFRobotDFPlayerMini.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <Wire.h>

#include "config.h"
#if __has_include("secrets.h")
#include "secrets.h"
#else
#warning "secrets.h missing: built with secrets.example.h, the box will not join Wi-Fi"
#include "secrets.example.h"
#endif
#include "door.h"
#include "msg.h"
#include "patchbay.h"
#include "ring.h"
#include "topics.h"

#define DOOR_BOTH door::kBoth
#define DOOR_REED door::kReed
#define DOOR_TAPE door::kTape

// ── MCP23017 over Wire (registers in the power-on BANK=0 layout) ────────────
namespace mcp {
constexpr uint8_t IODIRA = 0x00, IPOLA = 0x02, GPINTENA = 0x04, IOCON = 0x0A, GPPUA = 0x0C, GPIOA = 0x12,
                  OLATA = 0x14;
}

class McpBus : public pb::Bus {
 public:
  McpBus(uint8_t top, uint8_t bottom) : addr_{top, bottom} {}

  // All pins inputs with pull-ups, output latches 0, no inversion.
  bool begin() {
    for (int c = 0; c < 2; c++) {
      if (!write8(c, mcp::IOCON, 0x00)) return false;  // BANK=0, sequential addressing
      if (!write16(c, mcp::IODIRA, 0xFFFF) || !write16(c, mcp::IPOLA, 0x0000) ||
          !write16(c, mcp::GPINTENA, 0x0000) || !write16(c, mcp::GPPUA, 0xFFFF) || !write16(c, mcp::OLATA, 0x0000))
        return false;
    }
    return true;
  }
  bool setInputsExcept(int chip, int pin) override {
    uint16_t dir = 0xFFFF;
    if (pin >= 0) dir &= (uint16_t) ~(1u << pin);
    if (!write16(chip, mcp::IODIRA, dir)) return false;
    if (pin >= 0) delayMicroseconds(30);  // cable capacitance against the pull-ups
    return true;
  }
  bool readPorts(uint16_t ports[2]) override { return read16(0, mcp::GPIOA, ports[0]) && read16(1, mcp::GPIOA, ports[1]); }

 private:
  uint8_t addr_[2];
  bool write8(int c, uint8_t reg, uint8_t v) {
    Wire.beginTransmission(addr_[c]);
    Wire.write(reg);
    Wire.write(v);
    return Wire.endTransmission() == 0;
  }
  bool write16(int c, uint8_t reg, uint16_t v) {  // A then B
    Wire.beginTransmission(addr_[c]);
    Wire.write(reg);
    Wire.write((uint8_t)(v & 0xFF));
    Wire.write((uint8_t)(v >> 8));
    return Wire.endTransmission() == 0;
  }
  bool read16(int c, uint8_t reg, uint16_t& v) {
    Wire.beginTransmission(addr_[c]);
    Wire.write(reg);
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(addr_[c], (uint8_t)2) != 2) return false;
    uint8_t lo = Wire.read(), hi = Wire.read();
    v = (uint16_t)(lo | (hi << 8));
    return true;
  }
};

// ── State ───────────────────────────────────────────────────────────────────
WiFiClient net;
PubSubClient mqtt(net);
Preferences prefs;
Adafruit_NeoPixel pixels(RING_LEDS, PIN_RING, NEO_GRB + NEO_KHZ800);
HardwareSerial dfSerial(2);
DFRobotDFPlayerMini dfp;
McpBus bus(MCP_TOP_ADDR, MCP_BOTTOM_ADDR);

door::Debounce reed(DOOR_OPEN_MS, DOOR_CLOSE_MS), tape(DOOR_OPEN_MS, DOOR_CLOSE_MS),
    doorState(DOOR_OPEN_MS, DOOR_CLOSE_MS);
const door::Mode kDoorMode = DOOR_MODE;
bool doorPending = true;  // publish the current state on every (re)connect

bool patchOk = false, audioOk = false;
pb::Matrix baseline;
pb::Stabilizer stab;
const char* baselineSource = "none";
uint32_t stuckNow = 0, stuckReported = 0xFFFFFFFF, stuckSince = 0;
bool statePending = false, diagPending = true;

ring::State ringState;
uint32_t relayOffAt = 0, sirenOffAt = 0;
bool relayOn = false, sirenOn = false;

uint32_t lastScan = 0, lastFrame = 0, lastMqttTry = 0, lastMcpTry = 0, calPressedAt = 0;
bool calHeld = false;

constexpr uint32_t kBaselineVersion = 1;

// ── Small helpers ───────────────────────────────────────────────────────────
IPAddress ip(const char* s) {
  IPAddress a;
  a.fromString(s);
  return a;
}

bool publish(const char* topic, const char* payload, bool retain) {
  return mqtt.connected() && mqtt.publish(topic, payload, retain);
}

void click(uint32_t now) {
  digitalWrite(PIN_RELAY, HIGH);
  relayOn = true;
  relayOffAt = now + RELAY_PULSE_MS;
  if (audioOk && !sirenOn) dfp.playMp3Folder(TRACK_CONNECT);
}

void siren(uint32_t now) {
  if (!audioOk) return;
  dfp.playMp3Folder(TRACK_SIREN);
  sirenOn = true;
  sirenOffAt = now + SIREN_SECONDS * 1000u;
}

// ── Patch bay ───────────────────────────────────────────────────────────────
// Up to `tries` scans until five in a row agree (cords out, hands off).
bool settledScan(pb::Matrix& out, uint32_t& stuck, int tries) {
  pb::Matrix prev, cur;
  int same = 0;
  for (int i = 0; i < tries; i++) {
    if (!pb::scan(bus, cur, stuck)) return false;
    same = (i > 0 && pb::equal(cur, prev)) ? same + 1 : 0;
    prev = cur;
    if (same >= 4) {
      out = cur;
      return true;
    }
    delay(SCAN_INTERVAL_MS);
  }
  return false;
}

bool calibrate(const char* source) {
  pb::Matrix m;
  uint32_t stuck = 0;
  if (!patchOk || !settledScan(m, stuck, 40)) {
    Serial.println("calibrate: no settled scan (bus error or cords moving)");
    return false;
  }
  baseline = m;
  stuckNow = stuck;
  prefs.putUInt("ver", kBaselineVersion);
  prefs.putBytes("base", baseline.adj, sizeof baseline.adj);
  baselineSource = source;
  stab.reset(baseline, millis());
  statePending = true;  // an empty patch: stagehand sees the reset
  diagPending = true;
  ringState.setOverride(ring::kWhite, 1, millis());
  Serial.printf("calibrate (%s): baseline stored\n", source);
  return true;
}

void startPatchBay() {
  patchOk = bus.begin();
  if (!patchOk) {
    Serial.println("patch bay: MCP23017s not answering (check 0x20/0x21, SDA 21, SCL 22)");
    diagPending = true;
    return;
  }
  if (prefs.getUInt("ver", 0) == kBaselineVersion &&
      prefs.getBytes("base", baseline.adj, sizeof baseline.adj) == sizeof baseline.adj) {
    // A stored baseline survives a brownout with cords in; only a deliberate
    // recalibration replaces it.
    baselineSource = "stored";
    stab.reset(baseline, millis());
    diagPending = true;
    Serial.println("patch bay: stored baseline loaded");
  } else if (!calibrate("boot")) {
    pb::clear(baseline);
    baselineSource = "none";
    stab.reset(baseline, millis());
  }
}

void pollPatch(uint32_t now) {
  if (!patchOk) {
    if (now - lastMcpTry > 5000) {
      lastMcpTry = now;
      startPatchBay();
    }
    return;
  }
  if (now - lastScan < SCAN_INTERVAL_MS) return;
  lastScan = now;
  pb::Matrix m;
  uint32_t stuck = 0;
  if (!pb::scan(bus, m, stuck)) {
    patchOk = false;
    lastMcpTry = now;
    diagPending = true;
    Serial.println("patch bay: bus error, retrying in 5 s");
    return;
  }
  if (stuck != stuckNow) {
    stuckNow = stuck;
    stuckSince = now;
  } else if (stuck != stuckReported && now - stuckSince >= pb::kStableMs) {
    diagPending = true;
  }
  pb::Matrix before = stab.accepted;
  if (stab.feed(m, now)) {
    statePending = true;
    diagPending = true;
    if (pb::newPairs(before, stab.accepted) > 0) click(now);
  }
}

void publishState() {
  char buf[800];
  pb::stateJson(stab.accepted, baseline, buf, sizeof buf);
  if (publish(T_PATCH_STATE, buf, false)) {
    statePending = false;
    Serial.printf("state %s\n", buf);
  }
}

void publishDiag() {
  pb::Pair p[pb::kMaxPairs];
  pb::Matrix none;
  pb::clear(none);
  char base[400], broken[400], stuck[200], buf[1200];
  pb::pairsJson(p, pb::diff(baseline, none, p, pb::kMaxPairs), base, sizeof base);
  pb::pairsJson(p, pb::diff(baseline, stab.accepted, p, pb::kMaxPairs), broken, sizeof broken);
  pb::jacksJson(stuckNow, stuck, sizeof stuck);
  snprintf(buf, sizeof buf,
           "{\"ok\":%s,\"source\":\"%s\",\"baseline\":%s,\"broken\":%s,\"stuck\":%s,\"door_mode\":\"%s\","
           "\"audio\":%s,\"ip\":\"%s\"}",
           patchOk ? "true" : "false", baselineSource, base, broken, stuck, door::modeName(kDoorMode),
           audioOk ? "true" : "false", WiFi.localIP().toString().c_str());
  if (publish(T_PATCH_DIAG, buf, true)) {
    diagPending = false;
    stuckReported = stuckNow;
  }
}

// ── Door ────────────────────────────────────────────────────────────────────
void pollDoor(uint32_t now) {
  // Closed contact pulls the pin LOW; HIGH (incl. unplugged) = open.
  reed.update(digitalRead(PIN_REED) == HIGH, now);
  tape.update(digitalRead(PIN_TAPE) == HIGH, now);
  if (doorState.update(door::combine(kDoorMode, reed.stable, tape.stable), now)) doorPending = true;
}

void publishDoor() {
  char buf[80];
  snprintf(buf, sizeof buf, "{\"open\":%s,\"reed\":%s,\"tape\":%s}", doorState.stable ? "true" : "false",
           reed.stable ? "true" : "false", tape.stable ? "true" : "false");
  if (publish(T_DOOR, buf, true)) {
    doorPending = false;
    Serial.printf("door %s\n", buf);
  }
}

// ── House → box ─────────────────────────────────────────────────────────────
void onMessage(char* topic, byte* payload, unsigned int length) {
  char body[256];
  unsigned int n = length < sizeof body - 1 ? length : sizeof body - 1;
  memcpy(body, payload, n);
  body[n] = 0;
  uint32_t now = millis();
  char val[24];

  if (strcmp(topic, T_LOCK) == 0) {
    if (!msg::text(body, "state", val, sizeof val)) return;
    if (strcmp(val, "locked") == 0) ringState.lock = ring::kLocked;
    else if (strcmp(val, "unlocked") == 0) ringState.lock = ring::kUnlocked;
  } else if (strcmp(topic, T_ALARM) == 0) {
    if (!msg::text(body, "state", val, sizeof val)) return;
    if (strcmp(val, "on") == 0) {
      if (!ringState.alarming()) siren(now);
      ringState.startAlarm((uint32_t)msg::number(body, "seconds", 120), now);
    } else if (strcmp(val, "off") == 0) {
      ringState.stopAlarm();
      if (sirenOn && audioOk) dfp.stop();
      sirenOn = false;
    }
  } else if (strcmp(topic, T_RING) == 0) {
    ring::Look look;
    if (!msg::text(body, "mode", val, sizeof val)) return;
    long seconds = msg::number(body, "seconds", 90);
    if (strcmp(val, "clear") == 0 || seconds <= 0) ringState.clearOverride();
    else if (ring::parseLook(val, look)) ringState.setOverride(look, (uint32_t)seconds, now);
  } else if (strcmp(topic, T_SOUND) == 0) {
    if (!audioOk) return;
    long volume = msg::number(body, "volume", -1);
    if (volume >= 0 && volume <= 30) dfp.volume((uint8_t)volume);
    long track = msg::number(body, "track", -1);
    if (track == 0) dfp.stop();
    else if (track > 0 && track < 3000) dfp.playMp3Folder((int)track);
  } else if (strcmp(topic, T_CALIBRATE) == 0) {
    // Guard against a stray or retained message re-baselining with cords in.
    if (n == 0 || !strstr(body, "empty")) return;
    calibrate("mqtt");
    publish(T_CALIBRATE, "", true);  // clear it if someone published it retained
  }
}

// ── Network ─────────────────────────────────────────────────────────────────
void startWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.config(ip(SR_IP), ip(SR_GATEWAY), ip(SR_SUBNET), ip(SR_DNS));
  WiFi.begin(WIFI_SSID, WIFI_PSK);
}

void maintainMqtt(uint32_t now) {
  ringState.online = mqtt.connected();
  if (mqtt.connected()) {
    mqtt.loop();
    return;
  }
  if (WiFi.status() != WL_CONNECTED || now - lastMqttTry < 2000) return;
  lastMqttTry = now;
  if (!mqtt.connect(SR_CLIENT_ID, SR_MQTT_USER, SR_MQTT_PASS, T_HEALTH, 1, true, "lost")) {
    Serial.printf("mqtt: connect failed (%d)\n", mqtt.state());
    return;
  }
  Serial.println("mqtt: connected");
  mqtt.publish(T_HEALTH, "online", true);
  mqtt.subscribe(T_SHOW_ALL, 1);
  doorPending = true;  // retained, so a changed door while offline still lands
  diagPending = true;
  ringState.online = true;
}

// ── Arduino ─────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  pinMode(PIN_REED, INPUT_PULLUP);  // plus the external 4.7–10 kΩ pull-up (README)
  pinMode(PIN_TAPE, INPUT_PULLUP);
  pinMode(PIN_CAL_BUTTON, INPUT_PULLUP);
  pinMode(PIN_RELAY, OUTPUT);
  digitalWrite(PIN_RELAY, LOW);

  pixels.begin();
  pixels.setBrightness(RING_MAX_BRIGHTNESS);
  pixels.clear();
  pixels.show();

  uint32_t now = millis();
  bool reedOpen = digitalRead(PIN_REED) == HIGH, tapeOpen = digitalRead(PIN_TAPE) == HIGH;
  reed.reset(reedOpen, now);
  tape.reset(tapeOpen, now);
  doorState.reset(door::combine(kDoorMode, reedOpen, tapeOpen), now);

  dfSerial.begin(9600, SERIAL_8N1, PIN_DF_RX, PIN_DF_TX);
  audioOk = dfp.begin(dfSerial, true, true);
  if (audioOk) dfp.volume(DF_VOLUME);
  else Serial.println("audio: DFPlayer not answering (card in? TX via 1 kΩ?)");

  prefs.begin("serverroom", false);
  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(I2C_HZ);
  startPatchBay();

  startWifi();
  mqtt.setServer(ip(SR_BROKER_IP), SR_BROKER_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(1400);
  mqtt.setKeepAlive(SR_KEEPALIVE_S);
  mqtt.setSocketTimeout(2);
}

void loop() {
  uint32_t now = millis();
  maintainMqtt(now);
  pollDoor(now);
  pollPatch(now);

  if (doorPending) publishDoor();
  if (statePending) publishState();
  if (diagPending) publishDiag();

  // BOOT button held 3 s → recalibrate (cords out!).
  if (digitalRead(PIN_CAL_BUTTON) == LOW) {
    if (!calHeld) {
      calHeld = true;
      calPressedAt = now;
    } else if (calPressedAt && now - calPressedAt >= CAL_HOLD_MS) {
      calibrate("button");
      calPressedAt = 0;  // once per press
    }
  } else {
    calHeld = false;
  }

  if (relayOn && (int32_t)(relayOffAt - now) <= 0) {
    digitalWrite(PIN_RELAY, LOW);
    relayOn = false;
  }
  if (sirenOn && (int32_t)(sirenOffAt - now) <= 0) {
    if (audioOk) dfp.stop();
    sirenOn = false;
  }

  if (now - lastFrame >= 20) {
    lastFrame = now;
    ringState.tick(now);
    for (int i = 0; i < RING_LEDS; i++) {
      ring::Rgb c = ring::pixel(ringState, i, RING_LEDS, now);
      pixels.setPixelColor(i, c.r, c.g, c.b);
    }
    pixels.show();
  }
}
