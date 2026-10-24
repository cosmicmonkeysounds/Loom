// The settings records in flash (FlashStorage_SAMD's emulated EEPROM). On the
// board the real library backs FlashStore; on a laptop test/shim/ provides a
// FlashStorage_SAMD.h with the same EEPROM calls over a byte array, so the
// same code is tested. Include this from the sketch only (the library must be
// included in one translation unit).
#pragma once
#include <stdint.h>

#include "door_ldr.h"
#include "patch.h"

namespace store {

constexpr uint16_t kMagic = 0xD00E;
constexpr uint8_t kVersion = 1;
constexpr uint8_t kFlagCal = 1;

// Field order as in the contract (§2.9), plus `flags` so `cal` survives a
// reboot. Bump kVersion when the layout changes: an old record then reads
// as missing and the defaults run.
struct Record {
  uint16_t magic;
  uint8_t ver;
  uint8_t flags;
  uint16_t close;
  uint16_t open;
  uint8_t mode;
  uint8_t pad;
  uint16_t settle;
};
static_assert(sizeof(Record) == 12, "the flash record is 12 bytes");

inline Record toRecord(const dl::Settings& s) {
  Record r;
  r.magic = kMagic;
  r.ver = kVersion;
  r.flags = s.cal ? kFlagCal : 0;
  r.close = s.close;
  r.open = s.open;
  r.mode = (uint8_t)s.mode;
  r.pad = 0;
  r.settle = s.settle;
  return r;
}

// False (and `out` untouched) for blank flash, another layout or values out
// of range.
inline bool fromRecord(const Record& r, dl::Settings& out) {
  if (r.magic != kMagic || r.ver != kVersion || r.mode > dl::kSteady) return false;
  dl::Settings s;
  s.close = r.close;
  s.open = r.open;
  s.settle = r.settle;
  s.mode = (dl::Mode)r.mode;
  s.cal = (r.flags & kFlagCal) != 0;
  if (!dl::valid(s)) return false;
  out = s;
  return true;
}

// ── The patch bay's record (wave 22) ──────────────────────────────────────
// A second record at its own address, so the door's 12 bytes (and its
// kVersion) never move: a board flashed with 1.1.0 keeps its door
// calibration, and `pb save` never touches it.

constexpr uint16_t kBayMagic = 0xBA7E;
constexpr uint8_t kBayVersion = 1;
constexpr int kBayAddr = 16;

struct BayRecord {
  uint16_t magic;
  uint8_t ver;
  uint8_t sources;  // pb::kSources when written: another build's record reads as missing
  uint16_t level[pb::kSources];
  uint16_t floor;
  uint16_t tol;
};
static_assert(kBayAddr >= (int)sizeof(Record), "the bay's record sits after the door's");

inline BayRecord toRecord(const pb::Settings& s) {
  BayRecord r;
  r.magic = kBayMagic;
  r.ver = kBayVersion;
  r.sources = (uint8_t)pb::kSources;
  for (int k = 0; k < pb::kSources; k++) r.level[k] = s.level[k];
  r.floor = s.floor;
  r.tol = s.tol;
  return r;
}

inline bool fromRecord(const BayRecord& r, pb::Settings& out) {
  if (r.magic != kBayMagic || r.ver != kBayVersion || r.sources != pb::kSources) return false;
  pb::Settings s;
  for (int k = 0; k < pb::kSources; k++) s.level[k] = r.level[k];
  s.floor = r.floor;
  s.tol = r.tol;
  if (!pb::valid(s)) return false;
  out = s;
  return true;
}

struct Store {
  virtual bool load(dl::Settings& out) = 0;
  virtual bool save(const dl::Settings& s) = 0;
  // The patch bay's levels (a store with none: never saved).
  virtual bool loadBay(pb::Settings&) { return false; }
  virtual bool saveBay(const pb::Settings&) { return false; }
  virtual ~Store() {}
};

}  // namespace store

#if defined(DOOR_FLASH)
#include <FlashStorage_SAMD.h>

namespace store {

// The door's record at EEPROM address 0, the bay's at kBayAddr. FlashStorage_SAMD commits on put() unless
// commit-ASAP was turned off, so commit() is called only then.
struct FlashStore : Store {
  bool load(dl::Settings& out) override {
    Record r;
    EEPROM.get(0, r);
    return fromRecord(r, out);
  }
  bool save(const dl::Settings& s) override {
    Record r = toRecord(s);
    EEPROM.put(0, r);
    if (!EEPROM.getCommitASAP()) EEPROM.commit();
    Record back;
    EEPROM.get(0, back);
    dl::Settings check;
    return fromRecord(back, check) && check == s;
  }
  bool loadBay(pb::Settings& out) override {
    BayRecord r;
    EEPROM.get(kBayAddr, r);
    return fromRecord(r, out);
  }
  bool saveBay(const pb::Settings& s) override {
    BayRecord r = toRecord(s);
    EEPROM.put(kBayAddr, r);
    if (!EEPROM.getCommitASAP()) EEPROM.commit();
    BayRecord back;
    EEPROM.get(kBayAddr, back);
    pb::Settings check;
    return fromRecord(back, check) && check == s;
  }
};

}  // namespace store
#endif
