"""MQTT words: the mirror of `@loom/house` `lightTopic` / `z2mPayload` /
`wledPayload` (pinned by `lights-plan.json`), plus Zigbee2MQTT's own topics
and the reduction of its device list into `Z2mDevice`s for the server.

    zigbee / zigbee-group  zigbee2mqtt/<device>/set  {state, brightness, color: {hex}, color_temp, effect, transition}
    wled                   <device>/api               {on, bri, transition (tenths), seg: [{col, fx}]}

Both builders clamp for safety again (the planner already did), so a test's
`set` from the map editor can never darken a safety light either.
"""

from __future__ import annotations

import math
from typing import Any

from .plan import clamp_for_safety, ordered

Z2M_BASE = "zigbee2mqtt"
WLED_FX = {"blink": 1, "breathe": 2}
#: The cap on one `/api/mod/lights/devices` post (the server's).
DEVICES_MAX = 500


def light_topic(f: dict, base: str = Z2M_BASE) -> str:
    return f"{f['device']}/api" if f.get("kind") == "wled" else f"{base}/{f['device']}/set"


def z2m_payload(f: dict, s: dict) -> dict:
    c = ordered(clamp_for_safety(f, s))
    out: dict[str, Any] = {}
    for k in ("state", "brightness"):
        if k in c:
            out[k] = c[k]
    if "color" in c:
        out["color"] = {"hex": c["color"]}
    for k in ("color_temp", "effect", "transition"):
        if k in c:
            out[k] = c[k]
    return out


def _js_round(x: float) -> int:
    """`Math.round` (half up), never Python's half-to-even."""
    return int(math.floor(x + 0.5))


def wled_payload(f: dict, s: dict) -> dict:
    c = ordered(clamp_for_safety(f, s))
    out: dict[str, Any] = {}
    if "state" in c:
        out["on"] = c["state"] != "OFF"
    if "brightness" in c:
        out["bri"] = c["brightness"]
    if "transition" in c:
        out["transition"] = _js_round(c["transition"] * 10)
    seg: dict[str, Any] = {}
    if "color" in c:
        h = c["color"][1:]
        seg["col"] = [[int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)]]
    if "effect" in c:
        seg["fx"] = WLED_FX.get(c["effect"], 0)
    if seg:
        out["seg"] = [seg]
    return out


def payload_for(f: dict, s: dict) -> dict:
    return wled_payload(f, s) if f.get("kind") == "wled" else z2m_payload(f, s)


def identify_payload(f: dict) -> dict:
    """Identify (a test with no `set`): Z2M's `okay` effect; WLED blinks (2 s,
    then the module puts the fixture's look back)."""
    return {"on": True, "seg": [{"fx": 1}]} if f.get("kind") == "wled" else {"effect": "okay"}


def permit_join_topic(base: str = Z2M_BASE) -> str:
    return f"{base}/bridge/request/permit_join"


def permit_join_payload(seconds: int) -> dict:
    """Zigbee2MQTT 2.x: `{"time": N}` opens joining for N s; 0 closes it."""
    return {"time": max(0, min(254, int(seconds)))}


# -- the device list -------------------------------------------------------------


def _walk_features(exposes: Any):
    for e in exposes if isinstance(exposes, list) else []:
        if not isinstance(e, dict):
            continue
        yield e
        yield from _walk_features(e.get("features"))


def caps_of(definition: Any) -> dict | None:
    """A Z2M device definition's light caps, or None when it exposes no light."""
    if not isinstance(definition, dict):
        return None
    exposes = definition.get("exposes")
    if not any(isinstance(e, dict) and e.get("type") == "light" for e in exposes or []):
        return None
    names = {str(e.get("name") or e.get("property") or "") for e in _walk_features(exposes)}
    return {
        "color": bool(names & {"color_xy", "color_hs", "color", "color_rgb"}),
        "ct": "color_temp" in names,
        "dim": "brightness" in names,
    }


def _cut(v: Any, n: int) -> str | None:
    return v[:n] if isinstance(v, str) else None


def reduce_devices(devices: Any, groups: Any = None) -> list[dict]:
    """`zigbee2mqtt/bridge/devices` (+ `bridge/groups`) → `Z2mDevice[]` for
    `POST /api/mod/lights/devices`: friendly name, ieee, type, model / vendor
    / description, light caps (null: not a light), a group's members."""
    out: list[dict] = []
    by_ieee: dict[str, dict] = {}
    for d in devices if isinstance(devices, list) else []:
        if not isinstance(d, dict) or not isinstance(d.get("friendly_name"), str) or not d["friendly_name"].strip():
            continue
        definition = d.get("definition") if isinstance(d.get("definition"), dict) else {}
        dev = {
            "friendly": d["friendly_name"][:128],
            "ieee": str(d.get("ieee_address") or "")[:64],
            "type": str(d.get("type") or "Unknown")[:32],
            "model": _cut(definition.get("model") or d.get("model_id"), 128),
            "vendor": _cut(definition.get("vendor") or d.get("manufacturer"), 128),
            "description": _cut(definition.get("description"), 256),
            "caps": caps_of(definition),
        }
        by_ieee[dev["ieee"]] = dev
        out.append(dev)
    for g in groups if isinstance(groups, list) else []:
        if not isinstance(g, dict) or not isinstance(g.get("friendly_name"), str) or not g["friendly_name"].strip():
            continue
        members: list[str] = []
        caps: dict | None = None
        for m in g.get("members") or []:
            dev = by_ieee.get(str(m.get("ieee_address") or "")) if isinstance(m, dict) else None
            if dev is None:
                continue
            if dev["friendly"] not in members:
                members.append(dev["friendly"])
            if dev["caps"] is not None:
                caps = {k: bool((caps or {}).get(k)) or dev["caps"][k] for k in ("color", "ct", "dim")}
        out.append({
            "friendly": g["friendly_name"][:128],
            "ieee": str(g.get("id", ""))[:64],
            "type": "Group",
            "model": None,
            "vendor": None,
            "description": _cut(g.get("description"), 256),
            "caps": caps,
            "members": members[:64],
        })
    return out[:DEVICES_MAX]


def bridge_online(payload: bytes | str) -> bool | None:
    """`zigbee2mqtt/bridge/state`: JSON `{"state": "online"}` (2.x) or the
    bare word (1.x) → True / False; None when unreadable."""
    import json

    text = payload.decode("utf-8", "replace") if isinstance(payload, bytes) else str(payload)
    text = text.strip()
    try:
        doc = json.loads(text)
    except ValueError:
        doc = text
    state = doc.get("state") if isinstance(doc, dict) else doc
    if state == "online":
        return True
    if state == "offline":
        return False
    return None
