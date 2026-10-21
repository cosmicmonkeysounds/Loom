"""stagehand.yaml loading: the shared `server:` link + one section per module.

    server:  { url, event?, mod_token? | mod_passcode? }
    show:    { … }     # stagehand.show   — see show.example.yaml
    agents:  { … }     # stagehand.agents — see agents.example.yaml
    alexa:   { … }     # stagehand.alexa  — see trapped.house.yaml
    audio:   { … }     # stagehand.audio  — see audio.example.yaml

Two sections read each other here, because each module may run as its own
job (`--only show`) from the same file: an `audio:` that plays `sound X`
(`play_sounds: true`) takes the `show` module's QLab `sound` cues away, and
an `audio:` that announces (`announce: true`) may not sit beside `alexa:` —
one owner of the house's voice.

A top-level key that isn't `server` or a registered module is an error
(a typo'd section would otherwise silently switch a job off). A config
with no module sections is an error too — there'd be nothing to run.

Secrets stay out of git: `load_config` merges a sibling
`<name>.local.yaml` (git-ignored, e.g. `trapped.house.local.yaml`) over the
`server:` section, then the environment wins over both —
`LOOM_EVENT_ID`, `LOOM_MOD_PASSCODE`, `LOOM_MOD_TOKEN`, `LOOM_SERVER_URL`.
The tracked file can keep its `CHANGE-ME` placeholders.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from .module import REGISTRY, ConfigError, Module, ServerConfig

__all__ = [
    "ConfigError",
    "ServerConfig",
    "StagehandConfig",
    "load_config",
    "local_overlay_path",
    "parse_config",
    "placeholders",
    "server_overrides",
]

#: environment variable → `server:` key it overrides.
ENV_OVERRIDES = {
    "LOOM_SERVER_URL": "url",
    "LOOM_EVENT_ID": "event",
    "LOOM_MOD_PASSCODE": "mod_passcode",
    "LOOM_MOD_TOKEN": "mod_token",
}


@dataclass
class StagehandConfig:
    server: ServerConfig
    #: Enabled modules, in file order.
    modules: dict[str, Module] = field(default_factory=dict)


def _opt_str(raw: dict, key: str) -> str | None:
    value = raw.get(key)
    return value if isinstance(value, str) and value != "" else None


def parse_server(raw: Any) -> ServerConfig:
    if not isinstance(raw, dict):
        raise ConfigError("missing 'server:' section")
    url = raw.get("url")
    if not isinstance(url, str) or url == "":
        raise ConfigError("server: missing 'url'")
    server = ServerConfig(
        url=url,
        event=str(raw.get("event") or "default"),
        mod_token=_opt_str(raw, "mod_token"),
        mod_passcode=_opt_str(raw, "mod_passcode"),
    )
    if server.mod_token is None and server.mod_passcode is None:
        raise ConfigError("server: needs 'mod_token' or 'mod_passcode' (every module acts through the mod API)")
    return server


def server_overrides(env: Mapping[str, str]) -> dict[str, str]:
    """The `server:` keys the environment sets (empty values ignored)."""
    return {key: env[var] for var, key in ENV_OVERRIDES.items() if env.get(var)}


def _with_server(doc: Any, extra: Mapping[str, Any]) -> Any:
    if not extra or not isinstance(doc, dict):
        return doc
    server = doc.get("server")
    merged = {**(server if isinstance(server, dict) else {}), **extra}
    # A token from the overlay/env beats a placeholder passcode in the file.
    if "mod_token" in extra and "mod_passcode" not in extra:
        merged.pop("mod_passcode", None)
    return {**doc, "server": merged}


def parse_config(
    doc: Any,
    base_dir: str = ".",
    only: list[str] | None = None,
    env: Mapping[str, str] | None = None,
) -> StagehandConfig:
    if not isinstance(doc, dict):
        raise ConfigError("config must be a YAML mapping")
    doc = _with_server(doc, server_overrides(env or {}))
    server = parse_server(doc.get("server"))
    unknown = [k for k in doc if k != "server" and k not in REGISTRY]
    if unknown:
        raise ConfigError(f"unknown section(s) {', '.join(map(repr, unknown))} — modules: {', '.join(REGISTRY)}")
    if only is not None:
        for name in only:
            if name not in REGISTRY:
                raise ConfigError(f"--only: no module named {name!r}")
            if name not in doc:
                raise ConfigError(f"--only {name}: the config has no '{name}:' section")
    audio = doc.get("audio")
    if isinstance(audio, dict) and audio.get("announce") is True and "alexa" in doc:
        raise ConfigError("audio.announce is true but the 'alexa:' section is still here — one owner of the house's voice: remove 'alexa:' (or set announce: false)")
    modules: dict[str, Module] = {}
    for name in doc:
        if name == "server" or (only is not None and name not in only):
            continue
        modules[name] = REGISTRY[name].build(doc[name], base_dir)
    show = modules.get("show")
    if show is not None and isinstance(audio, dict) and audio.get("play_sounds") is True:
        show.hand_sounds_to_router()  # type: ignore[attr-defined]
    if not modules:
        raise ConfigError(f"nothing to run — add a module section ({', '.join(REGISTRY)})")
    return StagehandConfig(server=server, modules=modules)


def placeholders(server: ServerConfig) -> list[str]:
    """The `server:` keys still holding a tracked file's `CHANGE-ME` value."""
    fields = {"url": server.url, "event": server.event, "mod_passcode": server.mod_passcode, "mod_token": server.mod_token}
    return [k for k, v in fields.items() if isinstance(v, str) and v.startswith("CHANGE-ME")]


def local_overlay_path(path: str | Path) -> Path:
    """`trapped.house.yaml` → `trapped.house.local.yaml` (same directory)."""
    p = Path(path)
    return p.with_name(f"{p.stem}.local{p.suffix or '.yaml'}")


def _read_yaml(p: Path) -> Any:
    try:
        text = p.read_text(encoding="utf-8")
    except OSError as err:
        raise ConfigError(f"cannot read {p}: {err}") from err
    try:
        return yaml.safe_load(text)
    except yaml.YAMLError as err:
        raise ConfigError(f"bad YAML in {p}: {err}") from err


def load_config(
    path: str | Path,
    only: list[str] | None = None,
    env: Mapping[str, str] | None = None,
) -> StagehandConfig:
    p = Path(path)
    doc = _read_yaml(p)
    overlay = local_overlay_path(p)
    if overlay != p and overlay.is_file():
        local = _read_yaml(overlay)
        if not isinstance(local, dict) or set(local) - {"server"} or not isinstance(local.get("server"), dict):
            raise ConfigError(f"{overlay}: may only hold a 'server:' mapping (event / mod_passcode / mod_token / url)")
        doc = _with_server(doc, local["server"])
    return parse_config(doc, base_dir=str(p.resolve().parent), only=only, env=os.environ if env is None else env)
