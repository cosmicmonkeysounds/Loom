// Host tests for the door sensor's pure logic: the classifier's debounce and
// hysteresis, a modelled CdS cell under room light, the boot probe, the
// faults and the warning, calibration, every command and its reply, the
// periodic line, the flash record (through test/shim/FlashStorage_SAMD.h)
// and the output lines against test/fixtures/lines.jsonl.
// Build + run: ../test/run.sh (plain c++17, no Arduino).
#include <math.h>
#include <stdio.h>
#include <string.h>

#include <fstream>
#include <string>
#include <vector>

#define DOOR_FLASH 1
#include "../server_room_m4/config.h"
#include "../server_room_m4/door_ldr.h"
#include "../server_room_m4/engine.h"
#include "../server_room_m4/proto.h"
#include "../server_room_m4/store.h"

static int failures = 0, checks = 0;
#define CHECK(cond)                                                            \
  do {                                                                         \
    checks++;                                                                  \
    if (!(cond)) {                                                             \
      failures++;                                                              \
      fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #cond); \
    }                                                                          \
  } while (0)
#define CHECK_STR(a, b)                                                                           \
  do {                                                                                            \
    checks++;                                                                                     \
    if (std::string(a) != std::string(b)) {                                                       \
      failures++;                                                                                 \
      fprintf(stderr, "%s:%d: \"%s\" != \"%s\"\n", __FILE__, __LINE__, std::string(a).c_str(), \
              std::string(b).c_str());                                                            \
    }                                                                                             \
  } while (0)

// ── A modelled door ─────────────────────────────────────────────────────────
// A CdS cell, R = 10 kΩ · (10 lux / E)^0.7 (dark resistance capped at 1 MΩ),
// from 3V3 to A0 with 10 kΩ to GND: reading = 4095 · 10k / (10k + R). The
// LED puts `ledLux` on the cell through the shroud while the door is shut;
// `ambient` is the room light that gets into the shroud either way; an open
// door lets `spill` of the LED reach it. Engineering judgment, not a
// datasheet: N-20 measures the real cell.

struct Door : dl::Pins {
  bool ledOnPin = true;    // the LED switched by D2 (else on 5V / 3V3: always lit)
  bool ledAlive = true;
  bool pinHigh = false;
  bool shut = true;
  bool cut = false;        // the LDR's wire cut: A0 reads 0 through the 10 kΩ
  double ambient = 1.0;    // lux inside the shroud
  double ledLux = 300.0;
  double spill = 0.0;
  int forced = -1;         // ≥ 0: A0 reads exactly this (a bench injection)
  uint32_t now = 0;
  int ledWrites = 0;

  bool lit() const { return ledAlive && (ledOnPin ? pinHigh : true); }
  void led(bool on) override {
    pinHigh = on;
    ledWrites++;
  }
  uint16_t ldr() override {
    if (forced >= 0) return (uint16_t)forced;
    if (cut) return 0;
    double e = ambient + (lit() ? (shut ? ledLux : spill) : 0.0);
    double r = e <= 0 ? 1e6 : fmin(1e6, 1e4 * pow(10.0 / e, 0.7));
    return (uint16_t)lround(4095.0 * 1e4 / (1e4 + r));
  }
  // The cathode over 47 Ω: ≈ 5 mA → ≈ 0.24 V → ≈ 290 while lit (off D2 or
  // on 5V alike: the 47 Ω holds the cathode near GND either way).
  uint16_t sense() override { return lit() ? 290 : 0; }
  void wait(uint32_t ms) override { now += ms; }
};

struct Lines : door::Sink {
  std::vector<std::string> all;
  void line(const char* s) override { all.push_back(s); }
  std::string last() const { return all.empty() ? "" : all.back(); }
  // The newest line of type `t` (door lines keep coming between replies).
  std::string lastOf(const char* t) const {
    std::string tag = std::string("{\"t\":\"") + t + "\"";
    for (auto it = all.rbegin(); it != all.rend(); ++it)
      if (it->find(tag) == 0) return *it;
    return "";
  }
  void clear() { all.clear(); }
  int count(const char* needle) const {
    int n = 0;
    for (auto& l : all) n += l.find(needle) != std::string::npos;
    return n;
  }
};

struct Rig {
  Door d;
  store::FlashStore flash;
  Lines out;
  door::Engine e;
  // `build`: the firmware's LED_MODE. Most tests below were written against
  // `auto` (which probes D2); the shipped build's own tests pass kBuildMode.
  explicit Rig(bool sense = false, dl::Mode build = dl::kAuto) : e(d, flash, out, sense, build) {}
  void begin() { e.begin(d.now); }
  // Runs loop() every 5 ms for `ms`.
  void run(uint32_t ms) {
    for (uint32_t t = 0; t < ms; t += 5) {
      d.now += 5;
      e.tick(d.now);
    }
  }
  void say(const char* line) { e.command(line, false, d.now); }
  // The time from now until the engine reports `open == want`, or -1.
  int until(bool want, uint32_t limit) {
    for (uint32_t t = 0; t <= limit; t += 5) {
      if (e.open() == want) return (int)t;
      d.now += 5;
      e.tick(d.now);
    }
    return -1;
  }
};

static void erase() {
  EEPROM.erase();
  EEPROM.asap = true;
  EEPROM.commits = EEPROM.puts = 0;
}

// ── The output lines ───────────────────────────────────────────────────────

static void test_every_line_matches_the_fixture(const char* path) {
  std::ifstream f(path);
  CHECK(f.good());
  std::vector<std::string> want;
  for (std::string l; std::getline(f, l);)
    if (!l.empty()) want.push_back(l);
  char l[proto::kLine];
  std::vector<std::string> got;
  proto::hello({DOOR_FW, "steady", false, 1800, 1200, 150, false, false, 8, 7}, l, sizeof l);
  got.push_back(l);
  proto::door(17, false, 2410, 3020, 610, nullptr, nullptr, l, sizeof l);
  got.push_back(l);
  proto::door(18, true, 35, 640, 605, nullptr, nullptr, l, sizeof l);
  got.push_back(l);
  proto::door(19, true, 0, 3, 2, nullptr, dl::kLdrOpen, l, sizeof l);
  got.push_back(l);
  proto::door(20, true, 0, 4095, 4095, dl::kLdrSaturated, nullptr, l, sizeof l);
  got.push_back(l);
  proto::pong(123456, l, sizeof l);
  got.push_back(l);
  proto::cfg({DOOR_FW, "mod", false, 1800, 1200, 150, true, false, 8, 7}, true, l, sizeof l);
  got.push_back(l);
  proto::cal("closed", 2400, 1880, 1320, l, sizeof l);
  got.push_back(l);
  proto::ok("set close 1900", l, sizeof l);
  got.push_back(l);
  proto::err("cal span too small", "cal open", l, sizeof l);
  got.push_back(l);
  // The patch bay (wave 22): a bay settling with D2 between levels, a
  // complete one (four V–D pairs; none of them a combination the story
  // knows), learnt levels, and a refused learn.
  const uint16_t raw1[] = {1340, 610, 0, 2251, 3, 0, 1};
  const int8_t src1[] = {3, -1, 0, 5, 0, 0, 0};
  proto::patch(41, "V3-D1,V5-D4", 2, false, raw1, src1, 7, false, l, sizeof l);
  got.push_back(l);
  const uint16_t raw2[] = {1336, 444, 2, 2249, 0, 3648, 0};
  const int8_t src2[] = {3, 1, 0, 5, 0, 8, 0};
  proto::patch(42, "V1-D2,V3-D1,V5-D4,V8-D6", 4, true, raw2, src2, 7, true, l, sizeof l);
  got.push_back(l);
  const uint16_t levels[] = {441, 917, 1405, 1842, 2240, 2749, 3166, 3619};
  proto::pbcal(3, 1405, levels, 8, 150, 120, false, l, sizeof l);
  got.push_back(l);
  proto::err("pb: need exactly one cable", "pb learn V3", l, sizeof l);
  got.push_back(l);
  CHECK(want.size() == got.size());
  for (size_t i = 0; i < want.size() && i < got.size(); i++) CHECK_STR(got[i], want[i]);
}

static void test_a_reply_escapes_what_it_echoes() {
  char l[proto::kLine];
  proto::err("unknown command", "say \"hi\"\\\t", l, sizeof l);
  CHECK_STR(l, "{\"t\":\"err\",\"error\":\"unknown command\",\"cmd\":\"say \\\"hi\\\"\\\\\\u0009\"}");
}

// ── The classifier ─────────────────────────────────────────────────────────

static dl::Settings defaults() { return dl::Settings(); }

// Feeds `level` every `frame` ms for `ms`; returns how many changes.
static int feed(dl::Classifier& c, uint16_t level, uint32_t& now, uint32_t ms, uint32_t frame = 50) {
  int changes = 0;
  dl::Settings s = defaults();
  for (uint32_t t = 0; t < ms; t += frame) {
    now += frame;
    changes += c.update(level, s, now);
  }
  return changes;
}

static void test_the_first_frame_decides_then_debounce() {
  dl::Classifier c;
  uint32_t now = 0;
  CHECK(c.update(2400, defaults(), now) && !c.open);  // shut at boot
  // Open after OPEN_MS of open frames, not before.
  CHECK(feed(c, 100, now, 200) == 0 && !c.open);
  CHECK(feed(c, 100, now, 100) == 1 && c.open);
  // Closed after CLOSE_MS of closed frames, not before.
  CHECK(feed(c, 2400, now, 950) == 0 && c.open);
  CHECK(feed(c, 2400, now, 100) == 1 && !c.open);
  dl::Classifier boot;
  CHECK(boot.update(1499, defaults(), now) && boot.open);  // below the band's middle
  // A run counts from the start of its first frame: one 300 ms frame opens.
  dl::Classifier whole;
  whole.update(2400, defaults(), now);
  CHECK(whole.update(100, defaults(), now += 300, 300) && whole.open);
  CHECK(!whole.update(2400, defaults(), now += 300, 300) && whole.open);  // 300 < CLOSE_MS
}

static void test_the_band_holds_the_last_state() {
  dl::Classifier c;
  uint32_t now = 0;
  c.update(2400, defaults(), now);
  CHECK(feed(c, 1500, now, 5000) == 0 && !c.open);  // shut stays shut in the band
  CHECK(feed(c, 1200, now, 300) == 1 && c.open);     // `open` is inclusive
  CHECK(feed(c, 1700, now, 5000) == 0 && c.open);    // open stays open in the band
  CHECK(feed(c, 1800, now, 1100) == 1 && !c.open);   // `close` is inclusive
}

static void test_a_flicker_on_an_open_door_never_reads_closed() {
  dl::Classifier c;
  uint32_t now = 0;
  c.update(100, defaults(), now);
  CHECK(c.open);
  // A hand sweeping the beam back: 900 ms closed, a band frame, again.
  int changes = 0;
  for (int i = 0; i < 20; i++) {
    changes += feed(c, 2400, now, 900);
    changes += feed(c, 1500, now, 50);
  }
  CHECK(changes == 0 && c.open);
}

static void test_a_door_bouncing_every_300_ms_reports_each_settled_change_once() {
  Rig r;
  r.d.ledOnPin = false;  // steady
  r.begin();
  r.run(200);
  CHECK(!r.e.open());
  r.out.clear();
  for (int i = 0; i < 10; i++) {  // open / shut every 300 ms for 6 s
    r.d.shut = !r.d.shut;
    r.run(300);
  }
  r.d.shut = false;
  r.run(2000);  // settles open
  r.d.shut = true;
  r.run(2000);  // settles shut
  std::vector<std::string> edges;
  for (auto& l : r.out.all)
    if (l.find("\"t\":\"door\"") != std::string::npos) {
      bool open = l.find("\"open\":true") != std::string::npos;
      if (edges.empty() || (edges.back() == "open") != open) edges.push_back(open ? "open" : "shut");
    }
  // One opening (the first 300 ms open run), never a close until it settles.
  CHECK(edges.size() == 2 && edges[0] == "open" && edges[1] == "shut");
}

// ── Room light on a CdS cell ───────────────────────────────────────────────

static dl::Frame frameAt(Door& d, bool mod) {
  dl::Sampler s;
  d.now = 0;
  s.begin(mod ? dl::kMod : dl::kSteady, 150, false, d, 0);
  dl::Frame f;
  for (uint32_t t = 5; t < 2000; t += 5)
    if (s.tick(d, t, f)) return f;
  return f;
}

static void test_room_light_raises_dark_and_shrinks_the_level_in_mod() {
  Door d;
  int lastDark = -1, lastLevel = 1 << 20;
  for (double amb : {0.0, 1.0, 5.0, 20.0, 100.0, 500.0}) {
    d.ambient = amb;
    dl::Frame f = frameAt(d, true);
    CHECK(f.dark >= lastDark);
    CHECK(f.level <= lastLevel);  // the cell is non-linear: more light, a smaller step
    CHECK(f.level == f.lit - f.dark);
    lastDark = f.dark;
    lastLevel = f.level;
  }
  // The worst case inside a shroud (5 lux): a shut door still clears the
  // default `close` with room to spare.
  d.ambient = 5.0;
  CHECK(frameAt(d, true).level >= DEF_CLOSE + 100);
  // An open door under a bright room (500 lux) reads open in `mod`…
  d.shut = false;
  d.spill = 3.0;
  d.ambient = 500.0;
  CHECK(frameAt(d, true).level <= DEF_OPEN);
  // …where `steady` would read it shut: room light fakes the beam.
  d.ledOnPin = false;
  CHECK(frameAt(d, false).level >= DEF_CLOSE);
}

static void test_mod_frames_take_two_settles_and_blink_the_led() {
  Door d;
  dl::Sampler s;
  s.begin(dl::kMod, 150, false, d, 0);
  dl::Frame f;
  std::vector<uint32_t> at;
  for (uint32_t t = 5; t <= 1500; t += 5)
    if (s.tick(d, t, f)) at.push_back(t);
  CHECK(at.size() == 5 && at[0] == 300 && at[1] == 600);
  CHECK(d.ledWrites >= 10 && d.pinHigh);  // back on, ready for the next lit phase
  // The engine in mod: a run counts from the start of its first frame, so
  // one whole open frame (300 ms ≥ OPEN_MS) opens the door. The beam breaks
  // at some point in a frame; the first frame whose lit read follows the
  // break ends 150–450 ms later, and that frame decides (contract §2.9).
  int lo = 1 << 20, hi = 0;
  for (uint32_t phase = 0; phase < 300; phase += 25) {
    Rig r;
    r.begin();
    CHECK(r.e.mode() == dl::kMod);
    r.run(1000 + phase);
    CHECK(!r.e.open());
    r.d.shut = false;
    int t = r.until(true, 2000);
    CHECK(t >= 150 && t <= 455);
    lo = t < lo ? t : lo;
    hi = t > hi ? t : hi;
    r.d.shut = true;
    t = r.until(false, 3000);
    CHECK(t >= 1050 && t <= 1355);  // CLOSE_MS: four frames, the first counted whole
  }
  CHECK(hi - lo >= 250);  // the phases really did spread over a frame
}

// ── auto ───────────────────────────────────────────────────────────────────

static void test_auto_picks_mod_with_the_led_on_d2_else_steady() {
  erase();
  Rig onPin;
  onPin.begin();
  CHECK(onPin.e.mode() == dl::kMod);
  CHECK(onPin.out.all.size() == 1 && onPin.out.last().find("\"mode\":\"mod\",\"auto\":true") != std::string::npos);
  CHECK(onPin.d.now >= 6 * 150);  // three low / high pairs, each settled
  CHECK(onPin.d.pinHigh);

  Rig on3v3;
  on3v3.d.ledOnPin = false;
  on3v3.begin();
  CHECK(on3v3.e.mode() == dl::kSteady);
  CHECK(on3v3.out.last().find("\"mode\":\"steady\",\"auto\":true") != std::string::npos);

  Rig dead;  // no LED at all: nothing moves, steady (and the door reads open)
  dead.d.ledAlive = false;
  dead.begin();
  CHECK(dead.e.mode() == dl::kSteady);

  dl::Probe p;  // the threshold itself
  p.add(1000, 1199);
  CHECK(p.pick() == dl::kSteady);
  dl::Probe q;
  q.add(1000, 1200);
  CHECK(q.pick() == dl::kMod);

  on3v3.say("set mode mod");  // an override is not auto
  on3v3.say("get");
  CHECK(on3v3.out.last().find("\"mode\":\"mod\",\"auto\":false") != std::string::npos);
  on3v3.say("set mode auto");
  on3v3.say("get");
  CHECK(on3v3.out.last().find("\"mode\":\"steady\",\"auto\":true") != std::string::npos);
}

static void test_auto_booted_with_the_door_open_moves_to_mod_once_it_shuts() {
  erase();
  Rig r;  // the LED on D2, the beam blocked at boot: the probe sees nothing
  r.d.shut = false;
  r.begin();
  CHECK(r.e.mode() == dl::kSteady && r.d.pinHigh);
  r.run(1000);
  CHECK(r.e.open());
  r.d.shut = true;  // the door shuts: steady reads it, then the probe sees the LED
  r.run(2000);
  CHECK(r.e.mode() == dl::kMod && !r.e.open());
  r.say("get");
  CHECK(r.out.last().find("\"mode\":\"mod\",\"auto\":true") != std::string::npos);
  r.out.clear();
  r.run(2000);
  CHECK(r.out.count("\"open\":true") == 0);  // the switch never reads as an opening
  r.d.shut = false;  // and now room light can't fake shut
  r.d.ambient = 500.0;
  r.d.spill = 3.0;
  r.run(1000);
  CHECK(r.e.open());

  r.d.ambient = 1.0;  // a terminal reconnect re-sends set mode auto with the door open
  r.d.spill = 0.0;
  r.say("set mode auto");
  CHECK(r.e.mode() == dl::kSteady);
  r.d.shut = true;
  r.run(2000);
  CHECK(r.e.mode() == dl::kMod && !r.e.open());

  Rig wired;  // the LED on 3V3: every probe says steady, the door still reads
  wired.d.ledOnPin = false;
  wired.d.shut = false;
  wired.begin();
  wired.run(1000);
  wired.d.shut = true;
  wired.run(2000);
  CHECK(wired.e.mode() == dl::kSteady && !wired.e.open());

  Rig fixed;  // `set mode steady` is an override: never re-probed
  fixed.d.shut = false;
  fixed.begin();
  fixed.say("set mode steady");
  fixed.d.shut = true;
  fixed.run(2000);
  CHECK(fixed.e.mode() == dl::kSteady);
}

// ── The two wirings (LED_MODE, Q5) ─────────────────────────────────────────

static void storeMode(dl::Mode m);
static int openWithoutFault(const Lines& out);

// When the engine reports `open == want` after the door moves at `phase` ms
// into a run; -1 if never.
static int edgeAfter(Rig& r, bool shut, uint32_t limit) {
  r.d.shut = shut;
  return r.until(!shut, limit);
}

static void test_the_shipped_build_is_steady_with_the_led_on_5v() {
  // Today's rig: the LED on the board's 5V, always lit. The shipped build
  // runs `steady` from a blank board without probing or touching D2.
  CHECK(dl::kBuildMode == dl::kSteady && dl::Settings().mode == dl::kSteady);
  CHECK(LED_MODE == LED_STEADY);
  erase();
  Rig r(false, dl::kBuildMode);
  r.d.ledOnPin = false;
  r.begin();
  CHECK(r.e.mode() == dl::kSteady);
  CHECK(r.d.now == 0);        // no boot probe: nothing waited
  CHECK(r.d.ledWrites == 1);  // D2 set high once, then left alone
  CHECK(r.out.all.size() == 1 && r.out.last().find("\"mode\":\"steady\",\"auto\":false") != std::string::npos);
  r.run(500);
  CHECK(!r.e.open());
  // An opening reads 250–300 ms after the beam breaks (OPEN_MS, counted from
  // the start of the first 50 ms frame), a close about a second after.
  for (int i = 0; i < 4; i++) {
    r.run(37 * i);  // a different phase each time
    int t = edgeAfter(r, false, 2000);
    CHECK(t >= 200 && t <= 305);
    t = edgeAfter(r, true, 3000);
    CHECK(t >= 950 && t <= 1055);
  }
  CHECK(r.d.ledWrites == 1);  // no re-probe on a close: the loop never blocks
  r.say("reset");             // `reset` goes back to the build's mode
  r.say("get");
  CHECK(r.out.last().find("\"mode\":\"steady\",\"auto\":false") != std::string::npos);
  // Its weak spot: room light inside the shroud reads as the beam. With 5 lux
  // getting in (the shroud's worst case, test above) and a little of the LED
  // spilling round the open door, the open door reads shut.
  r.run(2000);
  r.d.shut = false;
  r.d.ambient = 5.0;
  r.d.spill = 3.0;
  r.run(2000);
  CHECK(!r.e.open());
}

static void test_the_pulsed_build_rejects_room_light() {
  // The LED moved to D2 (through a resistor, or an NPN for the 5 V LED) and
  // the firmware built with LED_MODE LED_PULSED: `mod` from a blank board.
  erase();
  Rig r(false, dl::kMod);
  r.begin();
  CHECK(r.e.mode() == dl::kMod);
  CHECK(r.d.now == 0);  // no probe: the build says where the LED is
  CHECK(r.out.last().find("\"mode\":\"mod\",\"auto\":false") != std::string::npos);
  r.run(1000);
  CHECK(!r.e.open());
  // The same scene as the steady build's weak spot: 5 lux of the red heart
  // bulb (or a hall lamp) in the shroud, the LED spilling round the open
  // door. It raises lit and dark alike, so lit − dark stays low: open.
  r.d.ambient = 5.0;
  r.d.spill = 3.0;
  int t = edgeAfter(r, false, 2000);
  CHECK(t >= 150 && t <= 455);  // §2.9: 150–450 ms at settle 150
  r.run(3000);
  CHECK(r.e.open() && r.e.status() != door::kFault);
  // …and the shut door under that light still reads shut on the defaults.
  t = edgeAfter(r, true, 3000);
  CHECK(t >= 1050 && t <= 1355);
  // Far more light in the shroud shrinks a CdS cell's step below `close`
  // (the cell is non-linear): it then reads open, never a false shut, and
  // calibrating with the room lit as on the night moves the thresholds.
  r.d.ambient = 500.0;
  r.run(3000);
  CHECK(r.e.open());
  r.d.ambient = 1.0;
  r.d.spill = 0.0;
  // `pulsed` is a name for `mod` on the wire; the lines keep saying `mod`.
  r.out.clear();
  r.say("set mode steady");
  r.say("set mode pulsed");
  CHECK_STR(r.out.last(), "{\"t\":\"ok\",\"cmd\":\"set mode pulsed\"}");
  r.say("get");
  CHECK(r.out.last().find("\"mode\":\"mod\",\"auto\":false") != std::string::npos);
  r.say("reset");
  r.say("get");
  CHECK(r.out.last().find("\"mode\":\"mod\",\"auto\":false") != std::string::npos);
  // A board saved in another mode boots what it saved, whatever the build.
  storeMode(dl::kSteady);
  Rig saved(false, dl::kMod);
  saved.begin();
  CHECK(saved.e.mode() == dl::kSteady);
  erase();
}

static void test_a_dead_led_in_either_build() {
  // Pulsed, with the sense wire: a dead LED is the blocking fault, the door
  // forced open and nothing posted, within FAULT_MS (+ a frame).
  erase();
  Rig p(true, dl::kMod);
  p.begin();
  p.run(1000);
  CHECK(!p.e.open());
  p.out.clear();
  p.d.ledAlive = false;
  p.run(2700);
  CHECK(p.out.count("\"fault\":\"led_dead\"") >= 1 && p.e.status() == door::kFault);
  CHECK(openWithoutFault(p.out) == 0);  // never a plain opening first
  // Steady on 5V with the same 47 Ω under the cathode: the same fault.
  Rig s(true, dl::kSteady);
  s.d.ledOnPin = false;
  s.begin();
  s.run(1000);
  s.out.clear();
  s.d.ledAlive = false;
  s.run(2700);
  CHECK(s.out.count("\"fault\":\"led_dead\"") >= 1 && s.e.status() == door::kFault);
  // Without the sense wire, in either build, lit − dark (or lit) falls just
  // as it does when the door opens: the LDR alone can't tell the two apart,
  // so it reads open, unflagged. The README asks for the sense wire with
  // the pulsed wiring for this reason.
  for (dl::Mode m : {dl::kMod, dl::kSteady}) {
    Rig b(false, m);
    b.d.ledOnPin = m == dl::kMod;
    b.begin();
    b.run(1000);
    b.d.ledAlive = false;
    b.run(4000);
    CHECK(b.e.open() && b.out.count("led_dead") == 0 && b.e.status() != door::kFault);
  }
}

// ── Faults and the warning ────────────────────────────────────────────────

static void test_a_saturated_ldr_is_a_blocking_fault_after_2_s() {
  erase();
  Rig r;
  r.begin();
  r.run(1000);
  CHECK(!r.e.open());
  r.d.forced = 4095;  // a lamp straight into the shroud: dark > 4000
  r.run(1500);
  CHECK(r.out.count("ldr_saturated") == 0 && r.e.status() != door::kFault);
  r.run(1500);
  CHECK(r.out.last().find("\"open\":true") != std::string::npos);
  CHECK(r.out.last().find("\"fault\":\"ldr_saturated\"") != std::string::npos);
  CHECK(r.e.open() && r.e.status() == door::kFault);
  r.d.forced = -1;  // clears after 2 s clean
  r.run(1500);
  CHECK(r.e.status() == door::kFault);
  r.run(1500);
  CHECK(r.out.last().find("\"fault\":null") != std::string::npos);
  r.run(1500);
  CHECK(!r.e.open());
  // In steady a bright LDR is just a shut door.
  Rig s;
  s.d.ledOnPin = false;
  s.begin();
  s.d.forced = 4095;
  s.run(5000);
  CHECK(s.out.count("ldr_saturated") == 0 && !s.e.open());
}

// A door line the bridge would post as door_sensor_opened.
static int openWithoutFault(const Lines& out) {
  int n = 0;
  for (auto& l : out.all)
    n += l.find("\"t\":\"door\"") != std::string::npos && l.find("\"open\":true") != std::string::npos &&
         l.find("\"fault\":null") != std::string::npos;
  return n;
}

static void storeMode(dl::Mode m) {
  erase();
  dl::Settings s;
  s.mode = m;
  store::FlashStore().save(s);
}

static void test_a_flood_of_light_never_reads_open_without_its_fault() {
  storeMode(dl::kMod);
  Rig boot;  // flooded from power-on: silent until the fault latches
  boot.d.ambient = 1e7;
  boot.begin();
  boot.run(5000);
  CHECK(openWithoutFault(boot.out) == 0);
  CHECK(boot.out.count("\"open\":true,") >= 1 && boot.out.lastOf("door").find("\"fault\":\"ldr_saturated\"") != std::string::npos);
  boot.out.clear();  // the terminal reconnects and re-sends its settings
  boot.say("set mode mod");
  boot.say("set settle 150");
  boot.run(5000);
  CHECK(openWithoutFault(boot.out) == 0 && boot.out.count("ldr_saturated") >= 1);
  boot.d.ambient = 1.0;  // the lamp goes: the shut door reads shut, never open first
  boot.out.clear();
  boot.run(5000);
  CHECK(openWithoutFault(boot.out) == 0 && !boot.e.open());
  CHECK(boot.out.lastOf("door").find("\"open\":false") != std::string::npos);

  Rig flash;  // the room's RGB bulb flashes into the shroud for 1.5 s
  flash.begin();
  flash.run(1000);
  CHECK(!flash.e.open());
  flash.out.clear();
  flash.d.forced = 4095;
  flash.run(1500);
  flash.d.forced = -1;
  flash.run(3000);
  CHECK(openWithoutFault(flash.out) == 0 && flash.out.count("\"open\":true") == 0 && !flash.e.open());
  CHECK(flash.out.count("\"t\":\"door\"") >= 4);  // the periodic line kept coming, shut
  erase();
}

static void test_a_dead_led_is_a_fault_only_with_the_sense_wire() {
  erase();
  Rig r(true);
  r.begin();
  r.run(1000);
  CHECK(r.e.mode() == dl::kMod && !r.e.open());
  r.out.clear();
  r.d.ledAlive = false;
  r.run(3500);
  CHECK(r.out.count("\"fault\":\"led_dead\"") >= 1 && r.e.status() == door::kFault);
  r.d.ledAlive = true;
  r.run(4000);
  CHECK(r.out.last().find("\"fault\":null") != std::string::npos);
  Rig h(true);
  h.begin();
  CHECK(h.out.all[0].find("\"sense\":true") != std::string::npos);

  Rig blind;  // no sense wire: a dead LED just reads as an open door
  blind.begin();
  blind.run(1000);
  blind.d.ledAlive = false;
  blind.run(4000);
  CHECK(blind.out.count("led_dead") == 0 && blind.e.open() && blind.e.status() != door::kFault);
}

static void test_a_cut_ldr_wire_is_a_warning_that_still_reports_open() {
  erase();
  Rig r;
  r.begin();
  r.run(1000);
  r.out.clear();
  r.d.cut = true;
  r.run(1000);
  CHECK(r.out.count("ldr_open") == 0);
  CHECK(r.out.count("\"open\":true,") >= 1);  // the door reads open before the warning
  r.run(1500);
  CHECK(r.out.last().find("\"open\":true") != std::string::npos);
  CHECK(r.out.last().find("\"fault\":null,\"warn\":\"ldr_open\"") != std::string::npos);
  CHECK(r.e.status() != door::kFault);
  r.d.cut = false;
  r.run(2500);
  CHECK(r.out.last().find("\"warn\":null") != std::string::npos);
}

// ── Calibration ────────────────────────────────────────────────────────────

static void test_calibration_sets_thresholds_from_both_references() {
  uint16_t o, c;
  CHECK(dl::calThresholds(800, 2400, o, c) && o == 1360 && c == 1840);
  CHECK(!dl::calThresholds(1000, 1199, o, c));
  CHECK(dl::calThresholds(1000, 1200, o, c) && o == 1070 && c == 1130);

  erase();
  Rig r;
  r.begin();
  r.run(1000);
  r.out.clear();
  r.say("cal closed");
  CHECK(r.out.all.empty() && r.e.calibrating());
  r.say("cal open");
  CHECK(r.out.last() == "{\"t\":\"err\",\"error\":\"cal busy\",\"cmd\":\"cal open\"}");
  r.run(2400);
  CHECK(!r.e.calibrating());
  CHECK(r.out.lastOf("cal").find("{\"t\":\"cal\",\"which\":\"closed\",\"ref\":") == 0);
  CHECK(r.out.lastOf("cal").find("\"close\":1800,\"open\":1200}") != std::string::npos);  // one ref: unchanged
  r.d.shut = false;
  r.d.spill = 2.0;
  r.run(1000);
  r.say("cal open");
  r.run(2400);
  const dl::Settings& s = r.e.settings();
  CHECK(s.cal && s.open < s.close && s.open > 0);
  char want[80];
  snprintf(want, sizeof want, "\"close\":%u,\"open\":%u}", s.close, s.open);
  CHECK(r.out.lastOf("cal").find("\"which\":\"open\"") != std::string::npos);
  CHECK(r.out.lastOf("cal").find(want) != std::string::npos);
  r.say("get");
  CHECK(r.out.last().find("\"cal\":true") != std::string::npos);
  char same[40];  // the terminal's connect re-sends the same values: still calibrated
  snprintf(same, sizeof same, "set close %u", s.close);
  r.say(same);
  snprintf(same, sizeof same, "set open %u", s.open);
  r.say(same);
  CHECK(r.out.last().find("{\"t\":\"ok\"") == 0);
  r.say("get");
  CHECK(r.out.last().find("\"cal\":true") != std::string::npos);
  r.say("set close 3000");  // a hand-set threshold is no longer calibrated
  r.say("get");
  CHECK(r.out.last().find("\"cal\":false,") != std::string::npos);
}

static void test_a_calibration_without_a_span_is_refused() {
  erase();
  Rig r;
  r.begin();
  r.run(1000);
  r.say("cal closed");
  r.run(2400);
  r.say("cal open");  // the door still shut: no span
  r.run(2400);
  CHECK(r.out.lastOf("err") == "{\"t\":\"err\",\"error\":\"cal span too small\",\"cmd\":\"cal open\"}");
  CHECK(r.out.count("\"which\":\"open\"") == 0);
  CHECK(r.e.settings().close == DEF_CLOSE && r.e.settings().open == DEF_OPEN && !r.e.settings().cal);
  Rig mid;  // a fault that comes on mid-average aborts it
  mid.begin();
  mid.run(1000);
  mid.say("cal closed");
  mid.d.forced = 4095;
  mid.out.clear();
  mid.run(3000);
  CHECK(!mid.e.calibrating() && mid.out.count("\"t\":\"cal\"") == 0);
  CHECK(mid.out.count("{\"t\":\"err\",\"error\":\"sensor fault\",\"cmd\":\"cal closed\"}") == 1);
  CHECK(mid.e.settings().close == DEF_CLOSE);
  r.d.forced = 4095;  // no calibration through a fault
  r.run(3000);
  r.say("cal closed");
  CHECK(r.out.last() == "{\"t\":\"err\",\"error\":\"sensor fault\",\"cmd\":\"cal closed\"}");
}

static void test_a_restart_answers_a_running_calibration() {
  for (const char* cmd : {"set mode mod", "set settle 200", "reset"}) {
    erase();
    Rig r;
    r.begin();
    r.run(1000);
    r.say("cal closed");
    r.out.clear();
    r.say(cmd);
    CHECK(r.out.all.size() == 2);
    CHECK_STR(r.out.all[0], "{\"t\":\"err\",\"error\":\"cal cancelled\",\"cmd\":\"cal closed\"}");
    CHECK_STR(r.out.all[1], std::string("{\"t\":\"ok\",\"cmd\":\"") + cmd + "\"}");
    CHECK(!r.e.calibrating());
    r.run(2400);
    CHECK(r.out.count("\"t\":\"cal\"") == 0);
  }
  erase();
  Rig idle;  // nothing running: no err
  idle.begin();
  idle.out.clear();
  idle.say("set settle 200");
  CHECK(idle.out.count("cal cancelled") == 0);
}

// ── Commands ───────────────────────────────────────────────────────────────

static void test_every_command_and_its_reply() {
  erase();
  Rig r;
  r.d.ledOnPin = false;
  r.begin();
  r.run(100);
  auto reply = [&](const char* cmd) {
    r.out.clear();
    r.say(cmd);
    return r.out.last();
  };
  CHECK_STR(reply("ping"), "{\"t\":\"pong\",\"up\":" + std::to_string(r.d.now) + "}");
  CHECK(reply("version").find("{\"t\":\"hello\",\"fw\":\"door-m4 1.2.0\"") == 0);
  CHECK_STR(reply("get"),
            "{\"t\":\"cfg\",\"fw\":\"door-m4 1.2.0\",\"mode\":\"steady\",\"auto\":true,\"close\":1800,\"open\":1200,"
            "\"settle\":150,\"cal\":false,\"sense\":false,\"pbv\":0,\"pbd\":0,\"saved\":false}");
  CHECK_STR(reply("set close 1900"), "{\"t\":\"ok\",\"cmd\":\"set close 1900\"}");
  CHECK_STR(reply("  set close 1950 \r"), "{\"t\":\"ok\",\"cmd\":\"set close 1950\"}");
  CHECK_STR(reply("set close 5000"), "{\"t\":\"err\",\"error\":\"out of range\",\"cmd\":\"set close 5000\"}");
  CHECK_STR(reply("set close 1200"), "{\"t\":\"err\",\"error\":\"open must be below close\",\"cmd\":\"set close 1200\"}");
  CHECK_STR(reply("set open 1950"), "{\"t\":\"err\",\"error\":\"open must be below close\",\"cmd\":\"set open 1950\"}");
  CHECK_STR(reply("set open 1300"), "{\"t\":\"ok\",\"cmd\":\"set open 1300\"}");
  CHECK_STR(reply("set open -1"), "{\"t\":\"err\",\"error\":\"bad value\",\"cmd\":\"set open -1\"}");
  CHECK_STR(reply("set open 12x"), "{\"t\":\"err\",\"error\":\"bad value\",\"cmd\":\"set open 12x\"}");
  CHECK_STR(reply("set mode bright"), "{\"t\":\"err\",\"error\":\"bad mode\",\"cmd\":\"set mode bright\"}");
  CHECK_STR(reply("set mode steady"), "{\"t\":\"ok\",\"cmd\":\"set mode steady\"}");
  CHECK_STR(reply("set settle 10"), "{\"t\":\"err\",\"error\":\"out of range\",\"cmd\":\"set settle 10\"}");
  CHECK_STR(reply("set settle 1001"), "{\"t\":\"err\",\"error\":\"out of range\",\"cmd\":\"set settle 1001\"}");
  CHECK_STR(reply("set settle 200"), "{\"t\":\"ok\",\"cmd\":\"set settle 200\"}");
  CHECK(r.e.settings().settle == 200 && r.e.settings().close == 1950 && r.e.settings().open == 1300);
  CHECK_STR(reply("save"),
            "{\"t\":\"cfg\",\"fw\":\"door-m4 1.2.0\",\"mode\":\"steady\",\"auto\":false,\"close\":1950,\"open\":1300,"
            "\"settle\":200,\"cal\":false,\"sense\":false,\"pbv\":0,\"pbd\":0,\"saved\":true}");
  CHECK(reply("get").find("\"saved\":true}") != std::string::npos);
  CHECK_STR(reply("reset"), "{\"t\":\"ok\",\"cmd\":\"reset\"}");
  CHECK(reply("get").find("\"close\":1800,\"open\":1200,\"settle\":150,\"cal\":false,\"sense\":false,\"pbv\":0,\"pbd\":0,\"saved\":false}") !=
        std::string::npos);
  CHECK_STR(reply("hello"), "{\"t\":\"err\",\"error\":\"unknown command\",\"cmd\":\"hello\"}");
  CHECK_STR(reply("set close"), "{\"t\":\"err\",\"error\":\"unknown command\",\"cmd\":\"set close\"}");
  CHECK_STR(reply("cal closed now"), "{\"t\":\"err\",\"error\":\"unknown command\",\"cmd\":\"cal closed now\"}");
  CHECK_STR(reply("PING"), "{\"t\":\"err\",\"error\":\"unknown command\",\"cmd\":\"PING\"}");
  r.out.clear();
  r.say("   ");
  CHECK(r.out.all.empty());  // a blank line answers nothing

  // The reset wasn't saved: a reboot comes back with the saved settings.
  Rig again;
  again.d.ledOnPin = false;
  again.begin();
  CHECK(again.e.settings().close == 1950 && again.e.settings().settle == 200);
  CHECK(again.out.last().find("\"mode\":\"steady\",\"auto\":false,\"close\":1950,\"open\":1300,\"settle\":200") !=
        std::string::npos);
}

static void test_the_line_reader() {
  proto::LineReader lr;
  const char* line = nullptr;
  bool tooLong = false;
  std::vector<std::string> got;
  for (const char* p = "ping\r\nget\n"; *p; p++)
    if (lr.feed(*p, line, tooLong)) got.push_back(std::string(line) + (tooLong ? "!" : ""));
  CHECK(got.size() == 2 && got[0] == "ping" && got[1] == "get");
  std::string big(100, 'x');
  big += "\nping\n";
  got.clear();
  for (char c : big)
    if (lr.feed(c, line, tooLong)) got.push_back(std::string(line) + (tooLong ? "!" : ""));
  CHECK(got.size() == 2 && got[0] == std::string(proto::kCmd, 'x') + "!" && got[1] == "ping");

  erase();
  Rig r;
  r.begin();
  r.e.command(std::string(proto::kCmd, 'x').c_str(), true, 0);
  CHECK(r.out.last().find("{\"t\":\"err\",\"error\":\"line too long\",\"cmd\":\"xxx") == 0);
}

// ── The periodic line and the status light ─────────────────────────────────

static void test_a_door_line_every_second_with_seq_counting_up() {
  erase();
  Rig r;
  r.d.ledOnPin = false;
  r.begin();
  r.out.clear();
  r.run(5000);
  int n = r.out.count("\"t\":\"door\"");
  CHECK(n >= 5 && n <= 6);  // the first frame + one a second, no change in between
  for (size_t i = 0; i < r.out.all.size(); i++) {
    std::string want = "{\"t\":\"door\",\"seq\":" + std::to_string(i + 1) + ",";
    CHECK(r.out.all[i].find(want) == 0);
  }
  CHECK(r.out.last().find("\"open\":false") != std::string::npos);
}

static void test_the_status_light() {
  erase();
  Rig r;
  r.begin();
  CHECK(r.e.status() == door::kWaiting);
  r.run(1000);
  CHECK(r.e.status() == door::kWaiting);  // blue until the host has spoken once
  r.say("version");
  CHECK(r.e.status() == door::kShut);
  r.d.shut = false;
  r.run(1000);
  CHECK(r.e.status() == door::kOpen);
  r.d.forced = 4095;
  r.run(3000);
  CHECK(r.e.status() == door::kFault);
  Rig f;  // a fault shows before the host speaks
  f.begin();
  f.d.forced = 4095;
  f.run(3000);
  CHECK(f.e.status() == door::kFault);
}

// ── Flash ──────────────────────────────────────────────────────────────────

static void test_the_flash_record() {
  CHECK(store::kMagic == 0xD00E && store::kVersion == 1 && sizeof(store::Record) == 12);
  dl::Settings s;
  s.close = 2222;
  s.open = 1111;
  s.settle = 300;
  s.mode = dl::kMod;
  s.cal = true;
  store::Record rec = store::toRecord(s);
  CHECK(rec.magic == 0xD00E && rec.ver == 1 && rec.mode == 1 && rec.flags == 1);
  dl::Settings back;
  CHECK(store::fromRecord(rec, back) && back == s);

  erase();  // blank flash → defaults
  store::FlashStore fs;
  dl::Settings got;
  CHECK(!fs.load(got));
  CHECK(fs.save(s) && fs.load(got) && got == s);
  CHECK(EEPROM.puts == 1 && EEPROM.commits == 1);
  EEPROM.asap = false;  // commit-ASAP off: save() commits itself
  CHECK(fs.save(s) && EEPROM.commits == 2);
  uint8_t magicLo;
  memcpy(&magicLo, EEPROM.data, 1);
  CHECK(magicLo == 0x0E);

  store::Record bad = rec;
  bad.ver = 2;
  CHECK(!store::fromRecord(bad, back));
  bad = rec;
  bad.magic = 0xFFFF;
  CHECK(!store::fromRecord(bad, back));
  bad = rec;
  bad.open = 3000;  // open ≥ close
  CHECK(!store::fromRecord(bad, back));
  bad = rec;
  bad.settle = 5;
  CHECK(!store::fromRecord(bad, back));
  bad = rec;
  bad.mode = 7;
  CHECK(!store::fromRecord(bad, back));

  erase();
  EEPROM.put(0, bad);  // a corrupt record boots with the defaults
  Rig r(false, dl::kBuildMode);
  r.d.ledOnPin = false;
  r.begin();
  CHECK(r.e.settings() == dl::Settings());
}

// ── The patch bay (wave 22) ────────────────────────────────────────────────
// A modelled bay: each source an E24 divider off 3V3 (the README's table),
// 1 kΩ in series to its jack; each input 220 kΩ to GND, 1 kΩ to the pin.
// A cable V<k> → D<i> reads V<k>'s open-circuit voltage less the droop
// across its Thevenin resistance into the 220 kΩ, plus a little noise; an
// empty input reads a few counts. `forced` injects a reading (a half-seated
// plug, a wiring fault); `bounce` a tip brushing the sleeve on its way in.

struct Bay : pb::Pins {
  static constexpr double kTop[8] = {8.2, 6.2, 6.8, 6.2, 5.1, 3.3, 1.8, 1.0};  // kΩ, 3V3 → tap
  static constexpr double kBot[8] = {1.0, 1.8, 3.3, 5.1, 6.2, 6.8, 6.2, 8.2};  // kΩ, tap → GND
  int plug[pb::kMaxInputs] = {};    // input → source (0: empty)
  int forced[pb::kMaxInputs];       // ≥ 0: the input reads exactly this
  bool bounce[pb::kMaxInputs] = {}; // the tip touches the sleeve: reads 0
  double scale[8] = {1, 1, 1, 1, 1, 1, 1, 1};  // a resistor off its value
  uint32_t reads = 0;
  Bay() {
    for (int& f : forced) f = -1;
  }
  static double counts(int k, double scale = 1.0) {
    double t = kTop[k - 1], b = kBot[k - 1];
    double vs = 3.3 * b / (t + b) * scale, rth = t * b / (t + b);
    return vs * 220.0 / (220.0 + rth + 1.0) / 3.3 * 4095.0;
  }
  uint16_t adc(int i) override {
    reads++;
    int noise = (int)((reads * 2654435761u) >> 28) % 9 - 4;  // −4 … +4
    if (forced[i] >= 0) return (uint16_t)forced[i];
    if (plug[i] == 0 || bounce[i]) return (uint16_t)(noise < 0 ? -noise : noise);
    return (uint16_t)lround(counts(plug[i], scale[plug[i] - 1]) + noise);
  }
  // A cable between two jacks ("V3", "D5"). Only a V–D cable moves an input:
  // V–V joins two sources (no input sees it), D–D two pulled-down inputs.
  void cable(const char* a, const char* b) {
    const char* v = a[0] == 'V' ? a : b[0] == 'V' ? b : nullptr;
    const char* d = a[0] == 'D' ? a : b[0] == 'D' ? b : nullptr;
    if (v == nullptr || d == nullptr) return;
    plug[atoi(d + 1) - 1] = atoi(v + 1);
  }
  void pull(const char* d) { plug[atoi(d + 1) - 1] = 0; }
  void clear() {
    for (int& p : plug) p = 0;
  }
};
constexpr double Bay::kTop[8];
constexpr double Bay::kBot[8];

// The door rig with a bay on the same engine.
struct M4 {
  Door d;
  Bay bay;
  store::FlashStore flash;
  Lines out;
  door::Engine e;
  M4() : e(d, flash, out, false, dl::kSteady, &bay) { d.ledOnPin = false; }
  void begin() { e.begin(d.now); }
  void run(uint32_t ms) {
    for (uint32_t t = 0; t < ms; t += 5) {
      d.now += 5;
      e.tick(d.now);
    }
  }
  void say(const char* line) { e.command(line, false, d.now); }
  std::vector<std::string> patches() const {
    std::vector<std::string> v;
    for (auto& l : out.all)
      if (l.find("{\"t\":\"patch\"") == 0) v.push_back(l);
    return v;
  }
  // The settled pairs on the newest `patch` line.
  std::string pairs() const {
    std::string l = out.lastOf("patch");
    size_t a = l.find("\"pairs\":\"");
    if (a == std::string::npos) return "?";
    a += 9;
    return l.substr(a, l.find('"', a) - a);
  }
};

static pb::Bay decode(Bay& b, const pb::Settings& s = pb::Settings()) {
  pb::Bay out;
  for (int i = 0; i < pb::kInputs; i++) out.src[i] = pb::classify(pb::readInput(b, i), s);
  return out;
}

static void test_every_source_on_every_input_reads_as_itself() {
  pb::Settings s;
  for (int k = 1; k <= pb::kSources; k++) {
    // The nominal table is the model's level within a fraction of the tolerance.
    CHECK(labs((long)lround(Bay::counts(k)) - (long)s.level[k - 1]) < s.tol / 2);
    for (int i = 0; i < pb::kInputs; i++) {
      Bay b;
      b.plug[i] = k;
      pb::Bay got = decode(b, s);
      for (int j = 0; j < pb::kInputs; j++) CHECK(got.src[j] == (j == i ? k : pb::kEmpty));
    }
  }
  // Every pair of neighbouring levels at least 2·tol apart, so no reading is two sources.
  for (int k = 1; k < pb::kSources; k++) CHECK(s.level[k] - s.level[k - 1] >= 2 * s.tol);
  Bay empty;
  pb::Summary none = pb::summarise(decode(empty));
  CHECK(none.count == 0 && !none.complete && none.between == 0);
}

static void test_a_reading_between_levels_is_never_a_source() {
  pb::Settings s;
  CHECK(pb::classify(0, s) == pb::kEmpty && pb::classify(149, s) == pb::kEmpty);
  CHECK(pb::classify(150, s) == pb::kBetween);  // above the floor, near nothing
  for (int k = 1; k < pb::kSources; k++) {
    uint16_t mid = (uint16_t)((s.level[k - 1] + s.level[k]) / 2);
    CHECK(pb::classify(mid, s) == pb::kBetween);
    CHECK(pb::classify((uint16_t)(s.level[k - 1] + s.tol), s) == k);
    CHECK(pb::classify((uint16_t)(s.level[k - 1] + s.tol + 1), s) == pb::kBetween);
  }
  CHECK(pb::classify(4095, s) == pb::kBetween);
  // Four good cables and a fifth input between levels: never complete.
  Bay b;
  b.cable("V1", "D2");
  b.cable("V3", "D1");
  b.cable("V5", "D4");
  b.cable("V8", "D6");
  b.forced[6] = (s.level[5] + s.level[6]) / 2;
  pb::Summary sum = pb::summarise(decode(b));
  CHECK(sum.count == 4 && sum.between == 1 && !sum.complete);
}

static void test_four_pairs_are_complete_in_one_canonical_order() {
  const char* want = "V1-D2,V3-D1,V5-D4,V8-D6";
  const char* cables[4][2] = {{"V8", "D6"}, {"D1", "V3"}, {"V1", "D2"}, {"D4", "V5"}};
  int orders[3][4] = {{0, 1, 2, 3}, {3, 2, 1, 0}, {2, 0, 3, 1}};
  for (auto& o : orders) {
    Bay b;
    for (int n : o) b.cable(cables[n][0], cables[n][1]);
    pb::Bay got = decode(b);
    char text[64];
    CHECK(pb::pairsText(got, text, sizeof text) == 4);
    CHECK_STR(text, want);
    CHECK(pb::summarise(got).complete);
  }
  Bay three;
  three.cable("V2", "D7");
  three.cable("V4", "D3");
  three.cable("V6", "D5");
  char text[64];
  pb::Bay got = decode(three);
  CHECK(pb::pairsText(got, text, sizeof text) == 3 && !pb::summarise(got).complete);
  CHECK_STR(text, "V2-D7,V4-D3,V6-D5");
  three.cable("V7", "D1");
  three.cable("V1", "D2");
  got = decode(three);
  CHECK(pb::pairsText(got, text, sizeof text) == 5 && !pb::summarise(got).complete);  // five is not four
  CHECK_STR(text, "V1-D2,V2-D7,V4-D3,V6-D5,V7-D1");
  // One source on two inputs can't happen with TS cables: a wiring fault, never complete.
  Bay dup;
  dup.cable("V1", "D2");
  dup.cable("V3", "D1");
  dup.cable("V5", "D4");
  dup.plug[5] = 3;
  pb::Summary sum = pb::summarise(decode(dup));
  CHECK(sum.dup && sum.count == 4 && !sum.complete);
  pb::Bay none;
  CHECK(pb::pairsText(none, text, sizeof text) == 0);
  CHECK_STR(text, "");
}

static void test_v_to_v_and_d_to_d_cables_read_as_nothing() {
  Bay b;
  b.cable("V1", "D2");
  b.cable("V3", "D1");
  b.cable("V5", "D4");
  b.cable("V6", "V8");  // top to top
  pb::Summary sum = pb::summarise(decode(b));
  CHECK(sum.count == 3 && !sum.complete && sum.between == 0);
  b.clear();
  b.cable("V1", "D2");
  b.cable("V3", "D1");
  b.cable("V5", "D4");
  b.cable("D6", "D7");  // bottom to bottom
  sum = pb::summarise(decode(b));
  CHECK(sum.count == 3 && !sum.complete);
}

static void test_the_bay_settles_for_a_second_before_it_counts() {
  erase();
  M4 m;
  m.begin();
  CHECK(m.out.all[0].find("\"pbv\":8,\"pbd\":7}") != std::string::npos);
  m.run(1100);
  // The empty bay settles at boot: one line with nothing, then one a second.
  CHECK(m.pairs() == "" && m.out.lastOf("patch").find("\"stable\":true") != std::string::npos);
  m.out.clear();
  m.run(2000);
  CHECK(m.patches().size() == 2);  // the periodic line, nothing new

  // Four cables over 1.5 s, the last one's tip brushing the sleeve for 300 ms.
  m.out.clear();
  m.bay.cable("V1", "D2");
  m.run(500);
  m.bay.cable("V3", "D1");
  m.run(500);
  m.bay.cable("V5", "D4");
  m.run(500);
  m.bay.cable("V8", "D6");
  for (int i = 0; i < 6; i++) {
    m.bay.bounce[5] = i % 2 == 0;
    m.run(50);
  }
  m.bay.bounce[5] = false;
  // No settled change yet: every line so far carries the empty bay.
  for (auto& l : m.patches()) CHECK(l.find("\"pairs\":\"\"") != std::string::npos);
  CHECK(m.out.lastOf("patch").find("\"stable\":false") != std::string::npos);
  m.out.clear();
  m.run(1100);  // the last cable has held a second
  auto lines = m.patches();
  int complete = 0;
  for (auto& l : lines) complete += l.find("\"pairs\":\"V1-D2,V3-D1,V5-D4,V8-D6\",\"count\":4,\"complete\":true") != std::string::npos;
  CHECK(complete == 1);
  CHECK(m.out.lastOf("patch").find("\"src\":[3,1,0,5,0,8,0],\"stable\":true}") != std::string::npos);
  // Then once a second, the same bay.
  m.out.clear();
  m.run(3000);
  CHECK(m.patches().size() == 3);
  for (auto& l : m.patches()) CHECK(l.find("\"complete\":true") != std::string::npos);

  // A cable pulled for half a second and pushed back never settles as three.
  m.out.clear();
  m.bay.pull("D4");
  m.run(500);
  m.bay.cable("V5", "D4");
  m.run(1500);
  for (auto& l : m.patches()) CHECK(l.find("\"count\":4,\"complete\":true") != std::string::npos);
  CHECK(m.out.lastOf("patch").find("\"stable\":true") != std::string::npos);
  // Pulled for good: three pairs after a second, not complete.
  m.bay.pull("D4");
  m.run(1100);
  CHECK(m.pairs() == "V1-D2,V3-D1,V8-D6");
  CHECK(m.out.lastOf("patch").find("\"count\":3,\"complete\":false") != std::string::npos);
}

static void test_the_door_keeps_working_beside_the_bay() {
  erase();
  M4 m;
  m.begin();
  m.say("get");
  m.run(1500);
  CHECK(m.out.count("{\"t\":\"door\"") >= 1 && !m.e.open());
  m.bay.cable("V2", "D7");
  m.d.shut = false;
  m.run(1500);
  CHECK(m.e.open());
  CHECK(m.pairs() == "V2-D7");
  m.d.shut = true;
  m.run(1500);
  CHECK(!m.e.open() && m.e.status() == door::kShut);
}

// One ADC behind one mux: the first read after the mux moves carries the
// last channel's charge (the worst case: all of it). The bay's own reads
// throw one away; the door's must too, or a bay scan of a high source on
// A8 drags a door in its band over `close`.
struct SharedAdc {
  bool moved = false;
  uint16_t carry = 0;
};
struct MuxDoor : Door {
  SharedAdc* adc = nullptr;
  uint16_t ldr() override {
    uint16_t own = Door::ldr();
    if (!adc->moved) return own;
    adc->moved = false;
    return adc->carry;
  }
};
struct MuxBay : Bay {
  SharedAdc* mux = nullptr;
  uint16_t adc(int i) override {
    uint16_t v = Bay::adc(i);
    mux->moved = true;
    mux->carry = v;
    return v;
  }
};

static void test_a_bay_scan_never_bleeds_into_the_door_reads() {
  erase();
  SharedAdc mux;
  MuxDoor d;
  MuxBay bay;
  d.adc = &mux;
  bay.mux = &mux;
  d.ledOnPin = false;
  store::FlashStore flash;
  Lines out;
  door::Engine e(d, flash, out, false, dl::kSteady, &bay);
  e.begin(d.now);
  auto run = [&](uint32_t ms) {
    for (uint32_t t = 0; t < ms; t += 5) {
      d.now += 5;
      e.tick(d.now);
    }
  };
  bay.cable("V8", "D7");  // the highest source on the last input scanned
  d.forced = 600;         // open
  run(1500);
  CHECK(e.open());
  d.forced = 1700;  // in the band: open stays open
  run(3000);
  CHECK(e.open());
  CHECK(out.count("\"open\":false") == 0);
}

static void test_pb_learn_takes_one_cable_and_refuses_the_rest() {
  erase();
  M4 m;
  m.begin();
  m.run(200);
  auto reply = [&](const char* cmd, uint32_t ms = 0) {
    m.out.clear();
    m.say(cmd);
    m.run(ms);
    for (auto it = m.out.all.rbegin(); it != m.out.all.rend(); ++it)
      if (it->find("{\"t\":\"patch\"") != 0 && it->find("{\"t\":\"door\"") != 0) return *it;
    return std::string();
  };
  // V3's divider reads 5 % high: still V3 by the nominal table, and learnt exactly.
  m.bay.scale[2] = 1.05;
  m.bay.cable("V3", "D5");
  std::string l = reply("pb learn V3", 1100);
  long want = lround(Bay::counts(3, 1.05));
  CHECK(l.find("{\"t\":\"pbcal\",\"src\":3,\"raw\":") == 0);
  CHECK(labs((long)m.e.baySettings().level[2] - want) <= 4);
  CHECK(l.find("\"floor\":150,\"tol\":120,\"saved\":false}") != std::string::npos);
  CHECK(!m.e.learning());

  m.bay.clear();
  CHECK_STR(reply("pb learn V2", 1100), "{\"t\":\"err\",\"error\":\"pb: need exactly one cable\",\"cmd\":\"pb learn V2\"}");
  m.bay.cable("V2", "D1");
  m.bay.cable("V4", "D2");
  CHECK_STR(reply("pb learn V2", 1100), "{\"t\":\"err\",\"error\":\"pb: need exactly one cable\",\"cmd\":\"pb learn V2\"}");
  // The cable moved to another input mid-learn.
  m.bay.clear();
  m.bay.cable("V2", "D1");
  m.out.clear();
  m.say("pb learn V2");
  m.run(400);
  m.bay.clear();
  m.bay.cable("V2", "D3");
  m.run(700);
  CHECK(m.out.lastOf("err").find("pb: need exactly one cable") != std::string::npos);
  // A level that would sit on V4's: refused, V2 unchanged.
  uint16_t before = m.e.baySettings().level[1];
  m.bay.clear();
  m.bay.forced[0] = m.e.baySettings().level[3] - 100;
  CHECK_STR(reply("pb learn V2", 1100), "{\"t\":\"err\",\"error\":\"pb: too close to V4\",\"cmd\":\"pb learn V2\"}");
  CHECK(m.e.baySettings().level[1] == before);
  m.bay.forced[0] = -1;
  m.bay.cable("V2", "D1");
  m.out.clear();
  m.say("pb learn V2");
  CHECK_STR(reply("pb learn V2"), "{\"t\":\"err\",\"error\":\"pb busy\",\"cmd\":\"pb learn V2\"}");
  CHECK_STR(reply("pb reset"), "{\"t\":\"err\",\"error\":\"pb busy\",\"cmd\":\"pb reset\"}");
  m.run(1100);
  CHECK(m.out.lastOf("pbcal").find("{\"t\":\"pbcal\",\"src\":2,") == 0);
  CHECK_STR(reply("pb learn V9"), "{\"t\":\"err\",\"error\":\"bad value\",\"cmd\":\"pb learn V9\"}");
  CHECK_STR(reply("pb learn V0"), "{\"t\":\"err\",\"error\":\"bad value\",\"cmd\":\"pb learn V0\"}");
  CHECK_STR(reply("pb learn D3"), "{\"t\":\"err\",\"error\":\"bad value\",\"cmd\":\"pb learn D3\"}");
  CHECK_STR(reply("pb learn V12"), "{\"t\":\"err\",\"error\":\"bad value\",\"cmd\":\"pb learn V12\"}");
  CHECK_STR(reply("pb learn"), "{\"t\":\"err\",\"error\":\"unknown command\",\"cmd\":\"pb learn\"}");
  // Lower case reads too (V2's cable is still in: V1 can't learn V2's level).
  CHECK_STR(reply("pb learn v1", 1100), "{\"t\":\"err\",\"error\":\"pb: too close to V2\",\"cmd\":\"pb learn v1\"}");
}

static void test_pb_floor_tol_get_save_and_reset() {
  erase();
  M4 m;
  m.begin();
  m.run(200);
  auto reply = [&](const char* cmd) {
    m.out.clear();
    m.say(cmd);
    return m.out.last();
  };
  CHECK(reply("pb floor 200").find("\"floor\":200,\"tol\":120,\"saved\":false}") != std::string::npos);
  CHECK(reply("pb tol 90").find("\"floor\":200,\"tol\":90,") != std::string::npos);
  CHECK_STR(reply("pb floor 10"), "{\"t\":\"err\",\"error\":\"out of range\",\"cmd\":\"pb floor 10\"}");
  CHECK_STR(reply("pb tol 5000"), "{\"t\":\"err\",\"error\":\"out of range\",\"cmd\":\"pb tol 5000\"}");
  // A floor that would swallow V1 (445): refused.
  CHECK_STR(reply("pb floor 400"), "{\"t\":\"err\",\"error\":\"out of range\",\"cmd\":\"pb floor 400\"}");
  CHECK_STR(reply("pb tol x"), "{\"t\":\"err\",\"error\":\"bad value\",\"cmd\":\"pb tol x\"}");
  // `pb get`: the bay now, then its levels.
  m.out.clear();
  m.say("pb get");
  CHECK(m.out.all.size() == 2 && m.out.all[0].find("{\"t\":\"patch\"") == 0 && m.out.all[1].find("{\"t\":\"pbcal\",\"src\":0,\"raw\":0,") == 0);

  // The door saved first; `pb save` leaves its record byte for byte.
  m.say("set close 2000");
  CHECK(reply("save").find("\"saved\":true}") != std::string::npos);
  uint8_t door[12];
  memcpy(door, EEPROM.data, 12);
  CHECK(reply("pb save").find("\"floor\":200,\"tol\":90,\"saved\":true}") != std::string::npos);
  CHECK(memcmp(door, EEPROM.data, 12) == 0);
  CHECK(EEPROM.data[store::kBayAddr] == 0x7E && EEPROM.data[store::kBayAddr + 1] == 0xBA);
  CHECK(store::kBayMagic == 0xBA7E && sizeof(store::BayRecord) == 24);
  // A reboot loads both.
  M4 again;
  again.begin();
  CHECK(again.e.settings().close == 2000);
  CHECK(again.e.baySettings().floor == 200 && again.e.baySettings().tol == 90);
  // `pb reset`: the nominal table, not saved; the door untouched.
  m.out.clear();
  m.say("pb reset");
  CHECK(m.out.last().find("\"levels\":[445,921,1338,1848,2247,2757,3174,3650],\"floor\":150,\"tol\":120,\"saved\":false}") !=
        std::string::npos);
  CHECK(m.e.settings().close == 2000);
  // The door's `save` leaves the bay's record too.
  CHECK(reply("save").find("\"saved\":true}") != std::string::npos);
  M4 third;
  third.begin();
  CHECK(third.e.baySettings().floor == 200);
  // A record from another layout boots with the nominal table.
  store::BayRecord bad = store::toRecord(pb::Settings());
  bad.sources = 7;
  pb::Settings out;
  CHECK(!store::fromRecord(bad, out));
  bad = store::toRecord(pb::Settings());
  bad.level[0] = 100;  // under the floor
  CHECK(!store::fromRecord(bad, out));
  bad = store::toRecord(pb::Settings());
  CHECK(store::fromRecord(bad, out) && out == pb::Settings());
}

static void test_a_board_without_a_bay_says_so() {
  erase();
  Rig r;
  r.d.ledOnPin = false;
  r.begin();
  CHECK(r.out.all[0].find("\"pbv\":0,\"pbd\":0}") != std::string::npos);
  r.say("get");
  r.run(3000);
  CHECK(r.out.count("{\"t\":\"patch\"") == 0);
  r.out.clear();
  r.say("pb get");
  CHECK_STR(r.out.last(), "{\"t\":\"err\",\"error\":\"pb: no bay\",\"cmd\":\"pb get\"}");
  r.out.clear();
  r.say("pb learn V1");
  CHECK_STR(r.out.last(), "{\"t\":\"err\",\"error\":\"pb: no bay\",\"cmd\":\"pb learn V1\"}");
}

static void test_a_full_patch_line_fits() {
  pb::Bay worst;
  for (int i = 0; i < pb::kInputs; i++) worst.src[i] = (int8_t)(i + 1);
  char text[64];
  CHECK(pb::pairsText(worst, text, sizeof text) == 7);
  uint16_t raw[pb::kMaxInputs];
  int8_t src[pb::kMaxInputs];
  for (int i = 0; i < pb::kInputs; i++) {
    raw[i] = 4095;
    src[i] = -1;
  }
  char l[proto::kLine];
  int n = proto::patch(4294967295ul, text, 7, false, raw, src, pb::kInputs, false, l, sizeof l);
  CHECK(n > 0 && (size_t)n < sizeof l);
  CHECK(std::string(l).back() == '}');
}

int main(int argc, char** argv) {
  const char* fixture = argc > 1 ? argv[1] : "test/fixtures/lines.jsonl";
  test_every_line_matches_the_fixture(fixture);
  test_a_reply_escapes_what_it_echoes();
  test_the_first_frame_decides_then_debounce();
  test_the_band_holds_the_last_state();
  test_a_flicker_on_an_open_door_never_reads_closed();
  test_a_door_bouncing_every_300_ms_reports_each_settled_change_once();
  test_room_light_raises_dark_and_shrinks_the_level_in_mod();
  test_mod_frames_take_two_settles_and_blink_the_led();
  test_auto_picks_mod_with_the_led_on_d2_else_steady();
  test_auto_booted_with_the_door_open_moves_to_mod_once_it_shuts();
  test_the_shipped_build_is_steady_with_the_led_on_5v();
  test_the_pulsed_build_rejects_room_light();
  test_a_dead_led_in_either_build();
  test_a_saturated_ldr_is_a_blocking_fault_after_2_s();
  test_a_flood_of_light_never_reads_open_without_its_fault();
  test_a_dead_led_is_a_fault_only_with_the_sense_wire();
  test_a_cut_ldr_wire_is_a_warning_that_still_reports_open();
  test_calibration_sets_thresholds_from_both_references();
  test_a_calibration_without_a_span_is_refused();
  test_a_restart_answers_a_running_calibration();
  test_every_command_and_its_reply();
  test_the_line_reader();
  test_a_door_line_every_second_with_seq_counting_up();
  test_the_status_light();
  test_the_flash_record();
  test_every_source_on_every_input_reads_as_itself();
  test_a_reading_between_levels_is_never_a_source();
  test_four_pairs_are_complete_in_one_canonical_order();
  test_v_to_v_and_d_to_d_cables_read_as_nothing();
  test_the_bay_settles_for_a_second_before_it_counts();
  test_the_door_keeps_working_beside_the_bay();
  test_a_bay_scan_never_bleeds_into_the_door_reads();
  test_pb_learn_takes_one_cable_and_refuses_the_rest();
  test_pb_floor_tol_get_save_and_reset();
  test_a_board_without_a_bay_says_so();
  test_a_full_patch_line_fits();
  printf("%d checks, %d failed\n", checks, failures);
  return failures ? 1 : 0;
}
