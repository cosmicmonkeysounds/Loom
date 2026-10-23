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
#include "../server_room_door/config.h"
#include "../server_room_door/door_ldr.h"
#include "../server_room_door/engine.h"
#include "../server_room_door/proto.h"
#include "../server_room_door/store.h"

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
  bool ledOnPin = true;    // the LED's anode on D2 (else on 3V3: always lit)
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
  // The cathode over 47 Ω: ≈ 5 mA → ≈ 0.24 V → ≈ 290 while driven.
  uint16_t sense() override { return lit() && ledOnPin ? 290 : 0; }
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
  explicit Rig(bool sense = false) : e(d, flash, out, sense) {}
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
  proto::hello({DOOR_FW, "steady", true, 1800, 1200, 150, false, false}, l, sizeof l);
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
  proto::cfg({DOOR_FW, "mod", false, 1800, 1200, 150, true, false}, true, l, sizeof l);
  got.push_back(l);
  proto::cal("closed", 2400, 1880, 1320, l, sizeof l);
  got.push_back(l);
  proto::ok("set close 1900", l, sizeof l);
  got.push_back(l);
  proto::err("cal span too small", "cal open", l, sizeof l);
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
  Rig r;  // the engine in mod: an opening reads within ≈ 320–640 ms
  r.begin();
  CHECK(r.e.mode() == dl::kMod);
  r.run(1000);
  CHECK(!r.e.open());
  r.d.shut = false;
  // The beam breaks at some point in a frame: the first open frame ends
  // 150–450 ms later, the second (≥ OPEN_MS into the run) 300 ms after that.
  int t = r.until(true, 2000);
  CHECK(t >= 450 && t <= 760);
  r.d.shut = true;
  t = r.until(false, 3000);
  CHECK(t >= 1000 && t <= 1650);
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
  CHECK(reply("version").find("{\"t\":\"hello\",\"fw\":\"door-m4 1.0.0\"") == 0);
  CHECK_STR(reply("get"),
            "{\"t\":\"cfg\",\"fw\":\"door-m4 1.0.0\",\"mode\":\"steady\",\"auto\":true,\"close\":1800,\"open\":1200,"
            "\"settle\":150,\"cal\":false,\"sense\":false,\"saved\":false}");
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
            "{\"t\":\"cfg\",\"fw\":\"door-m4 1.0.0\",\"mode\":\"steady\",\"auto\":false,\"close\":1950,\"open\":1300,"
            "\"settle\":200,\"cal\":false,\"sense\":false,\"saved\":true}");
  CHECK(reply("get").find("\"saved\":true}") != std::string::npos);
  CHECK_STR(reply("reset"), "{\"t\":\"ok\",\"cmd\":\"reset\"}");
  CHECK(reply("get").find("\"close\":1800,\"open\":1200,\"settle\":150,\"cal\":false,\"sense\":false,\"saved\":false}") !=
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
  Rig r;
  r.d.ledOnPin = false;
  r.begin();
  CHECK(r.e.settings() == dl::Settings());
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
  printf("%d checks, %d failed\n", checks, failures);
  return failures ? 1 : 0;
}
