// Host tests for the server-room box's pure logic: the patch-bay scan against
// a simulated bay (cords, normals that break or don't, 75 Ω terminations),
// the canonical combo string, the stabilizer, the door debounce, the ring and
// the payload reader. Build + run: ../test/run.sh (plain c++, no Arduino).
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <string>
#include <utility>
#include <vector>

#include "../server_room/door.h"
#include "../server_room/msg.h"
#include "../server_room/patchbay.h"
#include "../server_room/ring.h"

// The sketch's own door settings (server_room.ino defines these aliases).
#define DOOR_BOTH door::kBoth
#define DOOR_REED door::kReed
#define DOOR_TAPE door::kTape
#include "../server_room/config.h"

static int failures = 0, checks = 0;
#define CHECK(cond)                                                    \
  do {                                                                 \
    checks++;                                                          \
    if (!(cond)) {                                                     \
      failures++;                                                      \
      fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #cond); \
    }                                                                  \
  } while (0)
#define CHECK_STR(a, b)                                                               \
  do {                                                                                \
    checks++;                                                                         \
    if (std::string(a) != std::string(b)) {                                           \
      failures++;                                                                     \
      fprintf(stderr, "%s:%d: \"%s\" != \"%s\"\n", __FILE__, __LINE__, std::string(a).c_str(), \
              std::string(b).c_str());                                                \
    }                                                                                 \
  } while (0)

// ── A simulated bay ─────────────────────────────────────────────────────────
static int jack(const char* l) { return (l[0] == 'V' ? 0 : pb::kRowJacks) + atoi(l + 1) - 1; }

struct FakeBay : pb::Bus {
  std::vector<std::pair<int, int>> cords;
  bool normalled = false, normalsBreak = true;
  uint32_t terminated = 0;  // jacks shorted to the shell
  int drivenChip = -1, drivenPin = -1;
  bool failReads = false;
  int transactions = 0;

  void cord(const char* a, const char* b) { cords.push_back({jack(a), jack(b)}); }
  bool plugged(int j) const {
    for (auto& c : cords)
      if (c.first == j || c.second == j) return true;
    return false;
  }
  int find(std::vector<int>& p, int x) const { return p[x] == x ? x : p[x] = find(p, p[x]); }

  bool setInputsExcept(int chip, int pin) override {
    transactions++;
    if (pin >= 0) {
      drivenChip = chip;
      drivenPin = pin;
    } else if (chip == drivenChip) {
      drivenChip = drivenPin = -1;
    }
    return true;
  }
  bool readPorts(uint16_t ports[2]) override {
    transactions++;
    if (failReads) return false;
    std::vector<int> p(pb::kJacks);
    for (int i = 0; i < pb::kJacks; i++) p[i] = i;
    auto join = [&](int a, int b) { p[find(p, a)] = find(p, b); };
    for (auto& c : cords) join(c.first, c.second);
    if (normalled)
      for (int k = 0; k < pb::kRowJacks; k++) {
        int v = k, d = k + pb::kRowJacks;
        if (!normalsBreak || (!plugged(v) && !plugged(d))) join(v, d);
      }
    int driven = -1;
    for (int j = 0; j < pb::kJacks; j++)
      if (pb::chipOf(j) == drivenChip && pb::pinOf(j) == drivenPin) driven = j;
    ports[0] = ports[1] = 0xFFFF;
    for (int j = 0; j < pb::kJacks; j++) {
      bool low = driven >= 0 && find(p, j) == find(p, driven);
      for (int t = 0; t < pb::kJacks; t++)
        if ((terminated & pb::jbit(t)) && find(p, j) == find(p, t)) low = true;
      if (low) ports[pb::chipOf(j)] &= (uint16_t) ~(1u << pb::pinOf(j));
    }
    return true;
  }
};

static std::string comboOf(const pb::Matrix& cur, const pb::Matrix& base) {
  pb::Pair p[pb::kMaxPairs];
  int n = pb::diff(cur, base, p, pb::kMaxPairs);
  char s[300];
  pb::comboString(p, n, s, sizeof s);
  return s;
}

static pb::Matrix scanned(FakeBay& bay, uint32_t* stuckOut = nullptr) {
  pb::Matrix m;
  uint32_t stuck = 0;
  bool ok = pb::scan(bay, m, stuck);
  CHECK(ok);
  if (stuckOut) *stuckOut = stuck;
  return m;
}

static const char* kComboA = "V2-D5,V4-D1,V6-D8,V7-D3";  // trapped.house.yaml
static const char* kComboB = "V1-D6,V3-D2,V5-D7,V8-D4";

static void test_pins_and_labels() {
  for (int j = 0; j < pb::kJacks; j++) CHECK(pb::pinOf(j) != 7 && pb::pinOf(j) != 15);  // output-only
  char l[pb::kLabel];
  pb::label(0, l);
  CHECK_STR(l, "V1");
  pb::label(11, l);
  CHECK_STR(l, "V12");
  pb::label(12, l);
  CHECK_STR(l, "D1");
  pb::label(23, l);
  CHECK_STR(l, "D12");
  CHECK(jack("D5") == 16 && pb::chipOf(16) == 1 && pb::pinOf(16) == 4);
}

static void test_empty_bay_reads_nothing() {
  FakeBay bay;
  pb::Matrix none, m = scanned(bay);
  pb::clear(none);
  CHECK(pb::equal(m, none));
  char s[200];
  pb::stateJson(m, none, s, sizeof s);
  CHECK_STR(s, "{\"pairs\":[],\"combo\":\"\",\"count\":0,\"complete\":false}");
}

static void test_combos_are_canonical_whatever_the_order() {
  FakeBay bay;
  pb::Matrix none;
  pb::clear(none);
  // Plugged in a scrambled order, D end first on some.
  bay.cord("D3", "V7");
  bay.cord("V4", "D1");
  bay.cord("D8", "V6");
  bay.cord("V2", "D5");
  pb::Matrix m = scanned(bay);
  CHECK_STR(comboOf(m, none), kComboA);
  char s[300];
  pb::stateJson(m, none, s, sizeof s);
  CHECK_STR(s,
            "{\"pairs\":[[\"V2\",\"D5\"],[\"V4\",\"D1\"],[\"V6\",\"D8\"],[\"V7\",\"D3\"]],"
            "\"combo\":\"V2-D5,V4-D1,V6-D8,V7-D3\",\"count\":4,\"complete\":true}");

  FakeBay b2;
  b2.cord("V8", "D4");
  b2.cord("V1", "D6");
  b2.cord("D7", "V5");
  b2.cord("D2", "V3");
  CHECK_STR(comboOf(scanned(b2), none), kComboB);
}

static void test_wrong_and_decoy_patches_are_seen() {
  FakeBay bay;
  pb::Matrix none;
  pb::clear(none);
  bay.cord("V1", "V3");    // top to top
  bay.cord("D12", "V10");  // decoys
  bay.cord("D2", "D9");
  CHECK_STR(comboOf(scanned(bay), none), "V1-V3,V10-D12,D2-D9");
}

static void test_a_normalled_bay_reports_the_difference_from_its_baseline() {
  FakeBay bay;
  bay.normalled = true;  // V-N ↔ D-N with no cord in; a plug breaks it
  pb::Matrix base = scanned(bay);
  pb::Matrix none;
  pb::clear(none);
  CHECK_STR(comboOf(base, none),
            "V1-D1,V2-D2,V3-D3,V4-D4,V5-D5,V6-D6,V7-D7,V8-D8,V9-D9,V10-D10,V11-D11,V12-D12");
  CHECK_STR(comboOf(scanned(bay), base), "");  // nothing patched yet
  bay.cord("V2", "D5");
  bay.cord("V4", "D1");
  bay.cord("V6", "D8");
  bay.cord("V7", "D3");
  pb::Matrix m = scanned(bay);
  CHECK_STR(comboOf(m, base), kComboA);
  // …and the normals the cords broke are the diagnostic.
  CHECK_STR(comboOf(base, m), "V1-D1,V2-D2,V3-D3,V4-D4,V5-D5,V6-D6,V7-D7,V8-D8");
  // A cord into the jack's own partner is invisible on a normalled bay
  // (V9-D9 was already connected): documented in the README.
  bay.cords.clear();
  bay.cord("V9", "D9");
  CHECK_STR(comboOf(scanned(bay), base), "");
}

static void test_a_bay_whose_normals_do_not_break_never_completes() {
  FakeBay bay;
  bay.normalled = true;
  bay.normalsBreak = false;
  pb::Matrix base = scanned(bay);
  bay.cord("V2", "D5");
  bay.cord("V4", "D1");
  bay.cord("V6", "D8");
  bay.cord("V7", "D3");
  pb::Pair p[pb::kMaxPairs];
  int n = pb::diff(scanned(bay), base, p, pb::kMaxPairs);
  CHECK(n > pb::kComboCables);  // extra pairs: a wrong patch, never a false combo
}

static void test_a_terminated_jack_is_stuck_not_patched_to_everything() {
  FakeBay bay;
  bay.terminated = pb::jbit(jack("D3"));
  bay.cord("V2", "D5");
  uint32_t stuck = 0;
  pb::Matrix none;
  pb::clear(none);
  pb::Matrix m = scanned(bay, &stuck);
  CHECK(stuck == pb::jbit(jack("D3")));
  CHECK_STR(comboOf(m, none), "V2-D5");
  char s[64];
  pb::jacksJson(stuck, s, sizeof s);
  CHECK_STR(s, "[\"D3\"]");
}

static void test_a_bus_error_fails_the_scan() {
  FakeBay bay;
  bay.failReads = true;
  pb::Matrix m;
  uint32_t stuck;
  CHECK(!pb::scan(bay, m, stuck));
}

static void test_the_scan_releases_every_pin_and_fits_20_hz() {
  FakeBay bay;
  scanned(bay);
  CHECK(bay.drivenChip == -1);
  CHECK(bay.transactions <= 3 + 3 * pb::kJacks);  // ~75 I²C transactions ≈ 12 ms at 400 kHz
}

static void test_the_stabilizer_waits_a_second_and_survives_millis_wrap() {
  FakeBay empty, one;
  one.cord("V2", "D5");
  pb::Matrix e = scanned(empty), c = scanned(one);
  pb::Stabilizer st;
  uint32_t t0 = 0xFFFFFF00u;  // 256 ms before millis() wraps
  st.reset(e, t0);
  CHECK(!st.feed(c, t0 + 10));
  CHECK(!st.feed(e, t0 + 400));  // a wobble restarts the clock
  CHECK(!st.feed(c, t0 + 500));
  CHECK(!st.feed(c, t0 + 1400));
  CHECK(st.feed(c, t0 + 1500));  // held 1000 ms (across the wrap)
  CHECK(pb::equal(st.accepted, c));
  CHECK(!st.feed(c, t0 + 3000));  // no repeat publish
  CHECK(pb::newPairs(e, c) == 1 && pb::newPairs(c, e) == 0);
}

static void test_the_door_debounce_is_300_open_50_closed() {
  door::Debounce d(300, 50);
  d.reset(false, 0);
  CHECK(!d.update(true, 0));
  CHECK(!d.update(true, 299));
  CHECK(d.update(true, 300) && d.stable);
  CHECK(!d.update(false, 400));
  CHECK(!d.update(true, 420));  // bounce
  CHECK(!d.update(false, 430));
  CHECK(!d.update(false, 479));
  CHECK(d.update(false, 480) && !d.stable);
  // A 250 ms gap in the copper tape never reports open.
  CHECK(!d.update(true, 1000));
  CHECK(!d.update(false, 1250));
  CHECK(!d.update(false, 2000) && !d.stable);
}

static void test_the_door_inputs_combine() {
  using door::combine;
  CHECK(!combine(door::kBoth, false, false));
  CHECK(combine(door::kBoth, true, true));
  CHECK(!combine(door::kBoth, false, true));  // tape gaps open, reed says shut
  CHECK(!combine(door::kBoth, true, false));
  CHECK(combine(door::kReed, true, false) && !combine(door::kReed, false, true));
  CHECK(combine(door::kTape, false, true) && !combine(door::kTape, true, false));
  // Reed unplugged (reads open forever): the tape decides.
  CHECK(combine(door::kBoth, true, true) && !combine(door::kBoth, true, false));
}

static void test_each_input_has_its_own_polarity() {
  using door::isOpen;
  // A reed: closed (LOW) while the door is shut, unplugged (HIGH) reads open.
  CHECK(!isOpen(door::kClosedWhenShut, true));
  CHECK(isOpen(door::kClosedWhenShut, false));
  // The wire loops: they touch (LOW) when the door opens; an unplugged or
  // broken loop (HIGH) reads shut forever — silent, never a false opening.
  CHECK(isOpen(door::kClosedWhenOpen, true));
  CHECK(!isOpen(door::kClosedWhenOpen, false));
  CHECK_STR(door::polarityName(door::kClosedWhenOpen), "closed_when_open");
  CHECK_STR(door::polarityName(door::kClosedWhenShut), "closed_when_shut");
  // DOOR_TAPE with a closed-when-open contact: the loops alone decide, and
  // whatever the (absent) reed pin floats to never matters.
  CHECK(door::combine(door::kTape, isOpen(door::kClosedWhenShut, false), isOpen(door::kClosedWhenOpen, true)));
  CHECK(!door::combine(door::kTape, isOpen(door::kClosedWhenShut, false), isOpen(door::kClosedWhenOpen, false)));
  CHECK(!door::combine(door::kTape, isOpen(door::kClosedWhenShut, true), isOpen(door::kClosedWhenOpen, false)));
  // Why the default is not kBoth: an unplugged closed-when-open input reads
  // shut and vetoes every opening the reed sees.
  CHECK(!door::combine(door::kBoth, isOpen(door::kClosedWhenShut, false), isOpen(door::kClosedWhenOpen, false)));
}

static void test_the_box_ships_with_the_wire_loops_alone() {
  // Wave 7: the wire loops that touch when the door opens, no reed fitted.
  CHECK(DOOR_MODE == door::kTape);
  CHECK(TAPE_POLARITY == door::kClosedWhenOpen);
  CHECK(REED_POLARITY == door::kClosedWhenShut);
  CHECK(DOOR_OPEN_MS == 300);
  CHECK(DOOR_CLOSE_MS >= 1000 && DOOR_CLOSE_MS <= 3000);
}

static void test_a_flickering_contact_on_an_open_door_never_reports_closed() {
  // The wave 7 numbers: 300 ms to open, 1500 ms to close.
  door::Debounce d(300, 1500);
  d.reset(false, 0);
  // The code is typed, the door swings open: the loops touch.
  CHECK(!d.update(true, 1000));
  CHECK(d.update(true, 1300) && d.stable);
  // Held open, the loops lose contact for a full second, twice: never closed,
  // so the edge never re-arms and stagehand never fires a second opening.
  CHECK(!d.update(false, 5000));
  CHECK(!d.update(false, 5999));
  CHECK(!d.update(true, 6000) && d.stable);
  CHECK(!d.update(false, 9000));
  CHECK(!d.update(true, 10400) && d.stable);
  // Really shut: closed after 1.5 s stable.
  CHECK(!d.update(false, 20000));
  CHECK(!d.update(false, 21499));
  CHECK(d.update(false, 21500) && !d.stable);
  // The next opening (someone walking out by the inside handle) is its own
  // edge.
  CHECK(!d.update(true, 30000));
  CHECK(d.update(true, 30300) && d.stable);
}

static void test_the_door_payload_reports_only_fitted_inputs() {
  char buf[96];
  door::payloadJson(door::kTape, true, true, true, buf, sizeof buf);
  CHECK_STR(buf, "{\"open\":true,\"tape\":true,\"mode\":\"tape\"}");
  door::payloadJson(door::kTape, false, true, false, buf, sizeof buf);
  CHECK_STR(buf, "{\"open\":false,\"tape\":false,\"mode\":\"tape\"}");
  door::payloadJson(door::kReed, true, true, false, buf, sizeof buf);
  CHECK_STR(buf, "{\"open\":true,\"reed\":true,\"mode\":\"reed\"}");
  int n = door::payloadJson(door::kBoth, false, true, false, buf, sizeof buf);
  CHECK_STR(buf, "{\"open\":false,\"reed\":true,\"tape\":false,\"mode\":\"both\"}");
  CHECK(n > 0 && n < (int)sizeof buf);
}

static void test_the_payload_reader_takes_what_stagehand_sends() {
  // json.dumps style (space after the colon) and compact.
  const char* alarm = "{\"state\": \"on\", \"seconds\": 120}";
  char v[24];
  CHECK(msg::text(alarm, "state", v, sizeof v));
  CHECK_STR(v, "on");
  CHECK(msg::number(alarm, "seconds", 0) == 120);
  CHECK(msg::number("{\"state\":\"off\"}", "seconds", 120) == 120);
  CHECK(msg::text("{\"state\":\"unlocked\"}", "state", v, sizeof v));
  CHECK_STR(v, "unlocked");
  CHECK(msg::text("  locked\n", "state", v, sizeof v));  // mosquitto_pub -m locked
  CHECK_STR(v, "locked");
  CHECK(!msg::text("{\"mode\":\"green\"}", "state", v, sizeof v));
  // "state" inside a value is not the key.
  CHECK(msg::text("{\"note\":\"state\",\"state\":\"on\"}", "state", v, sizeof v));
  CHECK_STR(v, "on");
  CHECK(msg::number("{\"track\": 0}", "track", -1) == 0);
  CHECK(msg::number("{\"track\": \"x\"}", "track", -1) == -1);
}

static void test_the_ring() {
  using namespace ring;
  State s;
  // No lock message yet: dim amber; offline: one blue pixel.
  CHECK(pixel(s, 0, 16, 0) == color(kBlue));
  s.online = true;
  Rgb amber = pixel(s, 3, 16, 750);
  CHECK(amber.r > 0 && amber.b == 0 && amber.r < 80);
  s.lock = kLocked;
  CHECK(pixel(s, 3, 16, 1500).r == 255 && pixel(s, 3, 16, 0).r < 30);  // breathing
  s.lock = kUnlocked;
  CHECK(pixel(s, 3, 16, 0) == color(kGreen));
  // Alarm beats everything and strobes at 2.5 Hz (≤ 3 Hz).
  s.startAlarm(120, 1000);
  s.setOverride(kGreen, 90, 1000);
  s.tick(1000);
  CHECK(pixel(s, 0, 16, 1000) == color(kRed) || pixel(s, 0, 16, 1000) == color(kOff));
  CHECK(!(pixel(s, 0, 16, 1000) == pixel(s, 0, 16, 1200)));
  CHECK(1000 / (2 * kStrobeHalfMs) <= 3);
  // It ends on its own timer (no Wi-Fi needed)…
  s.tick(1000 + 120000);
  CHECK(!s.alarming());
  // …the override (chess window) is still green until its own end.
  s.startAlarm(5, 0);
  s.stopAlarm();
  s.override_ = true;
  s.overrideUntil = 1000 + 90000;
  s.tick(50000);
  CHECK(pixel(s, 0, 16, 50000) == color(kGreen));
  s.lock = kLocked;
  s.tick(91000);
  CHECK(pixel(s, 0, 16, 1500 + 3000 * 40).r == 255);  // back to armed
  // A huge duration is clamped to 10 minutes.
  s.startAlarm(100000, 0);
  s.tick(600001);
  CHECK(!s.alarming());
  Look l;
  CHECK(parseLook("green", l) && l == kGreen && !parseLook("purple", l));
}

int main() {
  test_pins_and_labels();
  test_empty_bay_reads_nothing();
  test_combos_are_canonical_whatever_the_order();
  test_wrong_and_decoy_patches_are_seen();
  test_a_normalled_bay_reports_the_difference_from_its_baseline();
  test_a_bay_whose_normals_do_not_break_never_completes();
  test_a_terminated_jack_is_stuck_not_patched_to_everything();
  test_a_bus_error_fails_the_scan();
  test_the_scan_releases_every_pin_and_fits_20_hz();
  test_the_stabilizer_waits_a_second_and_survives_millis_wrap();
  test_the_door_debounce_is_300_open_50_closed();
  test_the_door_inputs_combine();
  test_each_input_has_its_own_polarity();
  test_the_box_ships_with_the_wire_loops_alone();
  test_a_flickering_contact_on_an_open_door_never_reports_closed();
  test_the_door_payload_reports_only_fitted_inputs();
  test_the_payload_reader_takes_what_stagehand_sends();
  test_the_ring();
  printf("%d checks, %d failed\n", checks, failures);
  return failures ? 1 : 0;
}
