// The patch bay's digital all-pairs scan (CHECKLIST #18), pure C++ with no
// Arduino dependency so test/test_logic.cpp runs it on a laptop against a
// simulated bay.
//
// 24 jacks: V1–V12 on the top MCP23017, D1–D12 on the bottom one (V1–V8 and
// D1–D8 are the story's jacks, 9–12 are decoys). Each jack uses one MCP pin:
// GPA0–6 + GPB0–4. GPA7/GPB7 are output-only since datasheet rev D, so they
// are never used (a top-to-top patch between two GPx7 jacks would be
// invisible).
//
// Scan: every pin is an input with a pull-up and an output latch of 0. Drive
// one jack LOW (flip its direction bit), read both chips: any other jack that
// reads LOW shares a cable with it. A pair only counts if it reads in both
// directions. A jack that reads LOW with nothing driven is "stuck" (a 75 Ω
// self-termination or a short to the shell): it is reported and left out.
//
// Baseline: a normalled bay connects top-N to bottom-N with no cord in. The
// baseline is the connection map with every cord out; the patch is what the
// current map has that the baseline does not. On a bay whose normals break
// when a plug goes in (the usual video bay), a cord V2→D5 breaks V2–D2 and
// V5–D5 and adds V2–D5, so the patch is exactly V2–D5. A bay whose normals do
// NOT break merges the cord into the normal's net, which no scan can untangle
// (the patch then reads as extra pairs and never completes): fix that bay.
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

namespace pb {

constexpr int kRowJacks = 12;
constexpr int kJacks = 2 * kRowJacks;
constexpr int kComboCables = 4;
constexpr uint32_t kStableMs = 1000;
constexpr size_t kLabel = 5;  // "V12" + NUL, with room the compiler can prove
// MCP pin per jack within a row: GPA0–6 (0–6), GPB0–4 (8–12). Never 7 or 15.
inline constexpr uint8_t kPins[kRowJacks] = {0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12};

inline uint32_t jbit(int j) { return 1u << j; }
inline int chipOf(int j) { return j / kRowJacks; }
inline uint8_t pinOf(int j) { return kPins[j % kRowJacks]; }

// "V1".."V12", "D1".."D12". Index order is the canonical order: all V by
// number, then all D by number.
inline void label(int j, char out[kLabel]) {
  snprintf(out, kLabel, "%c%d", j < kRowJacks ? 'V' : 'D', j % kRowJacks + 1);
}

// Jacks reading LOW on the two 16-bit ports (top chip, bottom chip).
inline uint32_t lowMask(const uint16_t ports[2]) {
  uint32_t m = 0;
  for (int c = 0; c < 2; c++)
    for (int k = 0; k < kRowJacks; k++)
      if (!((ports[c] >> kPins[k]) & 1u)) m |= jbit(c * kRowJacks + k);
  return m;
}

// The two expanders. The firmware talks I²C; the test simulates a bay.
struct Bus {
  // Every pin of `chip` an input, except `pin` (an output at its 0 latch).
  // pin < 0 = all inputs.
  virtual bool setInputsExcept(int chip, int pin) = 0;
  virtual bool readPorts(uint16_t ports[2]) = 0;
  virtual ~Bus() {}
};

// adj[a] has bit b ⇔ a and b are connected. Always symmetric.
struct Matrix {
  uint32_t adj[kJacks];
};
inline void clear(Matrix& m) { memset(m.adj, 0, sizeof m.adj); }
inline bool equal(const Matrix& a, const Matrix& b) { return memcmp(a.adj, b.adj, sizeof a.adj) == 0; }

// One full scan (~2 + 3×24 bus transactions). False on any bus error; `out`
// is then unusable.
inline bool scan(Bus& bus, Matrix& out, uint32_t& stuck) {
  uint16_t ports[2];
  if (!bus.setInputsExcept(0, -1) || !bus.setInputsExcept(1, -1)) return false;
  if (!bus.readPorts(ports)) return false;
  stuck = lowMask(ports);
  uint32_t seen[kJacks];
  for (int j = 0; j < kJacks; j++) {
    seen[j] = 0;
    if (stuck & jbit(j)) continue;
    if (!bus.setInputsExcept(chipOf(j), pinOf(j))) return false;
    bool ok = bus.readPorts(ports);
    if (!bus.setInputsExcept(chipOf(j), -1) || !ok) return false;
    seen[j] = lowMask(ports) & ~jbit(j) & ~stuck;
  }
  for (int a = 0; a < kJacks; a++) {
    out.adj[a] = 0;
    for (int b = 0; b < kJacks; b++)
      if ((seen[a] & jbit(b)) && (seen[b] & jbit(a))) out.adj[a] |= jbit(b);
  }
  return true;
}

struct Pair {
  uint8_t a, b;  // a < b
};

// Pairs in `x` and not in `y`, canonical order (by first jack, then second).
inline int diff(const Matrix& x, const Matrix& y, Pair* out, int max) {
  int n = 0;
  for (int a = 0; a < kJacks; a++)
    for (int b = a + 1; b < kJacks; b++)
      if ((x.adj[a] & jbit(b)) && !(y.adj[a] & jbit(b)) && n < max) out[n++] = Pair{(uint8_t)a, (uint8_t)b};
  return n;
}
constexpr int kMaxPairs = kJacks * (kJacks - 1) / 2;

// "V2-D5,V4-D1,V6-D8,V7-D3": the string trapped.house.yaml compares.
inline void comboString(const Pair* p, int n, char* out, size_t cap) {
  size_t len = 0;
  out[0] = 0;
  for (int i = 0; i < n; i++) {
    char a[kLabel], b[kLabel];
    label(p[i].a, a);
    label(p[i].b, b);
    int w = snprintf(out + len, cap - len, "%s%s-%s", i ? "," : "", a, b);
    if (w < 0 || (size_t)w >= cap - len) break;
    len += (size_t)w;
  }
}

// [["V2","D5"],…]
inline void pairsJson(const Pair* p, int n, char* out, size_t cap) {
  size_t len = (size_t)snprintf(out, cap, "[");
  for (int i = 0; i < n && len < cap; i++) {
    char a[kLabel], b[kLabel];
    label(p[i].a, a);
    label(p[i].b, b);
    int w = snprintf(out + len, cap - len, "%s[\"%s\",\"%s\"]", i ? "," : "", a, b);
    if (w < 0 || (size_t)w >= cap - len) break;
    len += (size_t)w;
  }
  if (len + 2 <= cap) {
    out[len++] = ']';
    out[len] = 0;
  }
}

// ["D3","V12"]
inline void jacksJson(uint32_t mask, char* out, size_t cap) {
  size_t len = (size_t)snprintf(out, cap, "[");
  bool first = true;
  for (int j = 0; j < kJacks && len < cap; j++) {
    if (!(mask & jbit(j))) continue;
    char l[kLabel];
    label(j, l);
    int w = snprintf(out + len, cap - len, "%s\"%s\"", first ? "" : ",", l);
    if (w < 0 || (size_t)w >= cap - len) break;
    len += (size_t)w;
    first = false;
  }
  if (len + 2 <= cap) {
    out[len++] = ']';
    out[len] = 0;
  }
}

// The sensors/patchbay/state payload for `accepted` against `baseline`.
inline void stateJson(const Matrix& accepted, const Matrix& baseline, char* out, size_t cap) {
  Pair p[kMaxPairs];
  int n = diff(accepted, baseline, p, kMaxPairs);
  char pairs[400], combo[300];
  pairsJson(p, n, pairs, sizeof pairs);
  comboString(p, n, combo, sizeof combo);
  snprintf(out, cap, "{\"pairs\":%s,\"combo\":\"%s\",\"count\":%d,\"complete\":%s}", pairs, combo, n,
           n == kComboCables ? "true" : "false");
}

// A map is accepted once it has held, unchanged, for kStableMs.
struct Stabilizer {
  Matrix candidate, accepted;
  uint32_t since = 0;

  void reset(const Matrix& m, uint32_t now) {
    candidate = m;
    accepted = m;
    since = now;
  }
  // True when `accepted` just changed.
  bool feed(const Matrix& m, uint32_t now) {
    if (!equal(m, candidate)) {
      candidate = m;
      since = now;
      return false;
    }
    if (equal(candidate, accepted) || (uint32_t)(now - since) < kStableMs) return false;
    accepted = candidate;
    return true;
  }
};

// Pairs added between two accepted maps (the "click" on each new cable).
inline int newPairs(const Matrix& before, const Matrix& after) {
  Pair p[kMaxPairs];
  return diff(after, before, p, kMaxPairs);
}

}  // namespace pb
