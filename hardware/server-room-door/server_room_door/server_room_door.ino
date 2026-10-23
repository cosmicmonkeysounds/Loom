// Server-room door sensor (Trapped in the Internet, wave 20): an Adafruit
// Grand Central M4 on Steph's laptop that reads an LED shining on an LDR
// across the server-room door (lit = shut) and reports the door as JSON
// lines over USB serial, 115200. The server-room terminal page reads them
// with Web Serial and posts door_sensor_opened / door_sensor_closed to the
// event; nothing here talks to the network.
//
// Wiring, the protocol and calibration on site: ../README.md. The logic lives
// in the pure headers (door_ldr.h, proto.h, store.h, engine.h), tested on a
// laptop by ../test/run.sh.
//
// Libraries (arduino-cli lib install …): FlashStorage_SAMD, "Adafruit
// NeoPixel". Board: adafruit:samd:adafruit_grandcentral_m4.

#include <Adafruit_NeoPixel.h>

#include "config.h"
#define DOOR_FLASH 1
#include "store.h"
#include "door_ldr.h"
#include "engine.h"
#include "proto.h"

// ── The pins ───────────────────────────────────────────────────────────────

struct BoardPins : dl::Pins {
  void led(bool on) override { digitalWrite(PIN_DOOR_LED, on ? HIGH : LOW); }
  uint16_t ldr() override { return (uint16_t)analogRead(PIN_DOOR_LDR); }
  uint16_t sense() override { return (uint16_t)analogRead(PIN_DOOR_SENSE); }
  void wait(uint32_t ms) override { delay(ms); }
};

struct SerialSink : door::Sink {
  void line(const char* s) override {
    // No host has the port open (DTR low): drop the line rather than fill
    // the USB buffer. A page that connects later sends `version` for the
    // hello, and the periodic door line repeats the state within 1 s.
    if (!Serial) return;
    Serial.write(s, strlen(s));
    Serial.write('\n');
  }
};

static BoardPins pins;
static store::FlashStore flash;
static SerialSink sink;
static door::Engine engine(pins, flash, sink, LED_SENSE != 0);
static proto::LineReader reader;
static Adafruit_NeoPixel pixel(1, PIN_NEOPIXEL, NEO_GRB + NEO_KHZ800);
static door::Status shown = door::kWaiting;
static bool pixelSet = false;

static uint32_t colourOf(door::Status s) {
  switch (s) {
    case door::kFault: return pixel.Color(60, 0, 60);   // purple
    case door::kShut: return pixel.Color(0, 50, 0);     // green
    case door::kOpen: return pixel.Color(60, 25, 0);    // amber
    default: return pixel.Color(0, 0, 60);              // blue: the host hasn't spoken
  }
}

void setup() {
  analogReadResolution(12);  // SAMD defaults to 10-bit; the thresholds assume 12
  pinMode(PIN_DOOR_LED, OUTPUT);
  digitalWrite(PIN_DOOR_LED, HIGH);
#if LED_SENSE
  pinMode(PIN_DOOR_SENSE, INPUT);
#endif
  pixel.begin();
  pixel.setPixelColor(0, colourOf(door::kWaiting));
  pixel.show();
  Serial.begin(DOOR_BAUD);
  // Don't wait for a host: the door reads from power-on, and `version`
  // re-sends the hello to a page that connects later.
  engine.begin(millis());
}

void loop() {
  uint32_t now = millis();
  while (Serial.available() > 0) {
    const char* line;
    bool tooLong;
    if (reader.feed((char)Serial.read(), line, tooLong)) engine.command(line, tooLong, now);
  }
  engine.tick(now);
  door::Status s = engine.status();
  if (!pixelSet || s != shown) {
    shown = s;
    pixelSet = true;
    pixel.setPixelColor(0, colourOf(s));
    pixel.show();
  }
}
