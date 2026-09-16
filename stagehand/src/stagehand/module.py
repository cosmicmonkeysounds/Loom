"""The module contract — what makes stagehand one daemon with many jobs.

Each machine runs the same `stagehand` binary with its own YAML. A
top-level section names a module and holds its config; a section that is
absent means the module is off on that machine:

    server:  { url, event, mod_passcode }   # shared by every module
    show:    { mqtt, osc, cues, sensors }    # show control (the desktop)
    agents:  { llm, characters }             # agent-voiced characters (the laptop)

A module is a small class registered in `REGISTRY` under its section
name. It parses its own section at load (so a bad map fails at boot, not
mid-show), describes itself for `stagehand check`, and runs as one
long-lived coroutine alongside the others, sharing the process's single
authenticated `ModClient`. Adding a job (vision workers, the VR feed, …)
is a new subpackage + one registry line — nothing else changes.
"""

from __future__ import annotations

import importlib
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

from .modapi import ModClient


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class ServerConfig:
    url: str
    event: str = "default"
    mod_token: str | None = None
    mod_passcode: str | None = None


@dataclass
class Context:
    """What a running module gets: the shared server link + its config's home."""

    server: ServerConfig
    mod: ModClient
    #: Directory of the config file — relative paths in a section resolve here.
    base_dir: str = "."


class Module(Protocol):
    #: The section name (`show`, `agents`).
    name: str

    def describe(self) -> list[str]:
        """Human lines for `stagehand check` / the boot banner."""
        ...

    async def run(self, ctx: Context) -> None:
        """Run until cancelled. Must survive the server going away."""
        ...


@dataclass(frozen=True)
class ModuleSpec:
    #: One line for `stagehand modules`.
    summary: str
    #: `package.module:function` — parse + validate the section into a ready
    #: module (`build(section, base_dir) -> Module`, raising `ConfigError`).
    #: A string so a machine that only runs `agents` never imports paho-mqtt
    #: / python-osc, and vice versa.
    entry: str

    def build(self, section: Any, base_dir: str) -> Module:
        mod_name, _, fn = self.entry.partition(":")
        factory: Callable[[Any, str], Module] = getattr(importlib.import_module(mod_name), fn)
        return factory(section, base_dir)


REGISTRY: dict[str, ModuleSpec] = {
    "show": ModuleSpec(
        "show control — story events → OSC/MQTT cues; MQTT sensors → story mutations",
        "stagehand.show.module:build_show",
    ),
    "agents": ModuleSpec(
        "agent-voiced characters — answer `mind: external` conversations through a language model",
        "stagehand.agents.module:build_agents",
    ),
}
