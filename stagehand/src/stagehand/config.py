"""stagehand.yaml loading: the shared `server:` link + one section per module.

    server:  { url, event?, mod_token? | mod_passcode? }
    show:    { … }     # stagehand.show   — see show.example.yaml
    agents:  { … }     # stagehand.agents — see agents.example.yaml

A top-level key that isn't `server` or a registered module is an error
(a typo'd section would otherwise silently switch a job off). A config
with no module sections is an error too — there'd be nothing to run.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from .module import REGISTRY, ConfigError, Module, ServerConfig

__all__ = ["ConfigError", "ServerConfig", "StagehandConfig", "load_config", "parse_config"]


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


def parse_config(doc: Any, base_dir: str = ".", only: list[str] | None = None) -> StagehandConfig:
    if not isinstance(doc, dict):
        raise ConfigError("config must be a YAML mapping")
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
    modules: dict[str, Module] = {}
    for name in doc:
        if name == "server" or (only is not None and name not in only):
            continue
        modules[name] = REGISTRY[name].build(doc[name], base_dir)
    if not modules:
        raise ConfigError(f"nothing to run — add a module section ({', '.join(REGISTRY)})")
    return StagehandConfig(server=server, modules=modules)


def load_config(path: str | Path, only: list[str] | None = None) -> StagehandConfig:
    p = Path(path)
    try:
        text = p.read_text(encoding="utf-8")
    except OSError as err:
        raise ConfigError(f"cannot read {path}: {err}") from err
    try:
        doc = yaml.safe_load(text)
    except yaml.YAMLError as err:
        raise ConfigError(f"bad YAML in {path}: {err}") from err
    return parse_config(doc, base_dir=str(p.resolve().parent), only=only)
