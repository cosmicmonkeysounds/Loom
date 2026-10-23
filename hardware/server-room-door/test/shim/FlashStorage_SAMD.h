// Host stand-in for FlashStorage_SAMD's emulated EEPROM (get / put / commit
// / getCommitASAP / setCommitASAP), over a byte array that starts erased
// (0xFF), so store.h's FlashStore runs unchanged in test/test_logic.cpp.
#pragma once
#include <stdint.h>
#include <string.h>

struct EEPROMClass {
  uint8_t data[256];
  bool asap = true;
  int commits = 0, puts = 0;

  EEPROMClass() { erase(); }
  void erase() { memset(data, 0xFF, sizeof data); }
  template <class T>
  T& get(int addr, T& t) {
    memcpy(&t, data + addr, sizeof t);
    return t;
  }
  template <class T>
  const T& put(int addr, const T& t) {
    memcpy(data + addr, &t, sizeof t);
    puts++;
    if (asap) commits++;
    return t;
  }
  void commit() { commits++; }
  bool getCommitASAP() { return asap; }
  void setCommitASAP(bool v) { asap = v; }
};

static EEPROMClass EEPROM;
