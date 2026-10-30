"""Zigbee flow control: never more on Zigbee2MQTT's plate than the radio carries.

Z2M takes every `/set` it is given and queues it per device, without limit. A
looping look across the house sends a dozen a few seconds apart; while a few
bulbs stop answering (each failure holds the adapter for seconds) the queue
only grows, and after a night of it Z2M spins at 100% and answers nothing: no
look, no dashboard (2026-10-30). So this module owns the backlog instead, and
keeps it to one state per bulb:

    send(device)   the newest state waits in that bulb's slot, merged over
                   what was waiting (a superseded colour is never delivered)
    one at a time  a bulb gets its next command only after Z2M's state echo
                   for the last one (`zigbee2mqtt/<device>`, 100-300 ms), or
                   `ACK_MS` without it; at most `MAX_IN_FLIGHT` across the house
    dark           `FAILS_TO_DARK` commands in a row with no echo, or Z2M's
                   `availability` saying offline: the bulb gets one probe every
                   `PROBE_MS`, carrying its newest state, until it answers

An idle bulb still gets a cue at once, so nothing here slows a healthy house.
A command that is only an `effect` has no echo: its bulb is free again after
`NO_ECHO_MS` and no failure is counted. Pure: the clock and the publish are
passed in, and the module calls `tick()` a few times a second.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

MAX_IN_FLIGHT = 6
ACK_MS = 5000.0
NO_ECHO_MS = 500.0
FAILS_TO_DARK = 3
PROBE_MS = 30_000.0
#: The keys of a command Z2M answers with no state.
ECHOLESS = {"effect", "transition"}


def merge_pending(old: dict | None, new: dict) -> dict:
    """The newer command over the one still waiting; what it replaces goes."""
    out = dict(old or {})
    if "color" in new:
        out.pop("color_temp", None)
    if "color_temp" in new:
        out.pop("color", None)
    if new.get("state") == "OFF":
        for k in ("brightness", "color", "color_temp"):
            out.pop(k, None)
    out.update(new)
    return out


@dataclass
class Slot:
    device: str
    topic: str = ""
    pending: dict | None = None
    queued_at: float = 0.0
    #: The command Z2M has not echoed yet: when it went, and until when it waits.
    sent_at: float | None = None
    due_at: float = 0.0
    echoless: bool = False
    fails: int = 0
    offline: bool = False
    last_sent: float = float("-inf")

    @property
    def dark(self) -> bool:
        return self.offline or self.fails >= FAILS_TO_DARK


class Pacer:
    def __init__(
        self,
        publish: Callable[[str, dict], None],
        now: Callable[[], float],
        *,
        on_dark: Callable[[str, bool], None] | None = None,
    ) -> None:
        self.publish = publish
        self.now = now
        self.on_dark = on_dark
        self.slots: dict[str, Slot] = {}
        #: Z2M is down: hold every bulb's newest state until it is back.
        self.paused = False
        self.superseded = 0

    def _slot(self, device: str) -> Slot:
        slot = self.slots.get(device)
        if slot is None:
            slot = self.slots[device] = Slot(device)
        return slot

    def send(self, device: str, topic: str, payload: dict) -> None:
        slot = self._slot(device)
        slot.topic = topic
        if slot.pending is None:
            slot.queued_at = self.now()
        else:
            self.superseded += 1
        slot.pending = merge_pending(slot.pending, payload)
        self.pump()

    def _changed(self, slot: Slot, was_dark: bool) -> None:
        if slot.dark != was_dark and self.on_dark is not None:
            self.on_dark(slot.device, slot.dark)

    def acked(self, device: str) -> None:
        """A state from Z2M: this bulb's command landed, and the bulb is alive."""
        slot = self.slots.get(device)
        if slot is None:
            return
        was = slot.dark
        slot.sent_at = None
        slot.fails = 0
        slot.offline = False
        self._changed(slot, was)
        self.pump()

    def availability(self, device: str, online: bool) -> None:
        slot = self._slot(device)
        was = slot.dark
        slot.offline = not online
        if online:
            slot.fails = 0
        self._changed(slot, was)
        self.pump()

    def tick(self) -> None:
        now = self.now()
        for slot in self.slots.values():
            if slot.sent_at is None or now < slot.due_at:
                continue
            slot.sent_at = None
            if not slot.echoless:
                was = slot.dark
                slot.fails += 1
                self._changed(slot, was)
        self.pump()

    def reset(self) -> None:
        """Z2M restarted: what it held is gone. The waiting states stay."""
        for slot in self.slots.values():
            was = slot.dark
            slot.sent_at = None
            slot.fails = 0
            slot.last_sent = float("-inf")
            self._changed(slot, was)

    def is_dark(self, device: str) -> bool:
        slot = self.slots.get(device)
        return slot is not None and slot.dark

    def dark(self) -> list[str]:
        return sorted(s.device for s in self.slots.values() if s.dark)

    def waiting(self) -> int:
        return sum(1 for s in self.slots.values() if s.pending is not None)

    def in_flight(self) -> int:
        return sum(1 for s in self.slots.values() if s.sent_at is not None)

    def pump(self) -> None:
        if self.paused:
            return
        now = self.now()
        free = MAX_IN_FLIGHT - self.in_flight()
        for slot in sorted((s for s in self.slots.values() if s.pending is not None), key=lambda s: s.queued_at):
            if free <= 0:
                return
            if slot.sent_at is not None or (slot.dark and now - slot.last_sent < PROBE_MS):
                continue
            payload, slot.pending = slot.pending, None
            slot.echoless = set(payload) <= ECHOLESS
            slot.sent_at = slot.last_sent = now
            slot.due_at = now + (NO_ECHO_MS if slot.echoless else ACK_MS)
            free -= 1
            self.publish(slot.topic, payload)
