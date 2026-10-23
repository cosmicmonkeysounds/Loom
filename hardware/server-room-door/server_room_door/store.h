// The settings record in flash (FlashStorage_SAMD's emulated EEPROM). On the
// board the real library backs FlashStore; on a laptop test/shim/ provides a
// FlashStorage_SAMD.h with the same EEPROM calls over a byte array, so the
// same code is tested. Include this from the sketch only (the library must be
// included in one translation unit).
#pragma once
#include <stdint.h>

#include "door_ldr.h"

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

struct Store {
  virtual bool load(dl::Settings& out) = 0;
  virtual bool save(const dl::Settings& s) = 0;
  virtual ~Store() {}
};

}  // namespace store

#if defined(DOOR_FLASH)
#include <FlashStorage_SAMD.h>

namespace store {

// The record at EEPROM address 0. FlashStorage_SAMD commits on put() unless
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
};

}  // namespace store
#endif
