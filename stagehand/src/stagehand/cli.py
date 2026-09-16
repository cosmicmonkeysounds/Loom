"""The `stagehand` command.

    stagehand run    --config laptop.yaml [--only agents]   run every enabled module
    stagehand check  --config laptop.yaml [--only agents]   validate + describe, exit
    stagehand modules                                        list the module kinds
    stagehand ask    --config laptop.yaml [--character Trabolta] [--name Ada] [text…]
                     talk to an agent persona straight through the model — no
                     server, no story; one line, or an interactive chat
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

from . import app
from .config import ConfigError, StagehandConfig, load_config
from .module import REGISTRY


def _describe(cfg: StagehandConfig) -> str:
    s = cfg.server
    lines = [f"server   : {s.url} (event: {s.event}, auth: {'token' if s.mod_token else 'passcode'})"]
    for module in cfg.modules.values():
        lines.append(f"[{module.name}]")
        lines.extend(module.describe())
    return "\n".join(lines)


def _only(value: str | None) -> list[str] | None:
    return None if not value else [v.strip() for v in value.split(",") if v.strip()]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="stagehand", description="Loom live-event bridge")
    parser.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    sub = parser.add_subparsers(dest="command", required=True)
    for name, help_text in (("run", "run the enabled modules"), ("check", "validate a config and exit")):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("--config", required=True, help="path to the machine's stagehand YAML")
        p.add_argument("--only", help="comma list of modules to run from the config (default: all present)")
    sub.add_parser("modules", help="list the available modules")
    ask = sub.add_parser("ask", help="chat with an agent persona through the model (no server)")
    ask.add_argument("--config", required=True)
    ask.add_argument("--character", help="which persona (default: the only / first one)")
    ask.add_argument("--name", default="Guest", help="who you are, as the character sees it")
    ask.add_argument("--var", action="append", default=[], metavar="NAME=VALUE", help="a character variable (repeatable)")
    ask.add_argument("text", nargs="*", help="one line to send; omit for an interactive chat")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    if not args.verbose:
        logging.getLogger("httpx").setLevel(logging.WARNING)  # one line per request is noise

    if args.command == "modules":
        for name, spec in REGISTRY.items():
            print(f"{name:<8} {spec.summary}")
        return 0

    try:
        cfg = load_config(args.config, only=["agents"] if args.command == "ask" else _only(args.only))
    except ConfigError as err:
        print(f"config error: {err}", file=sys.stderr)
        return 2

    if args.command == "ask":
        return _ask(cfg, args)

    print(_describe(cfg))
    if args.command == "check":
        print("config OK")
        return 0
    try:
        asyncio.run(app.run(cfg, base_dir=str(Path(args.config).resolve().parent)))
    except KeyboardInterrupt:
        print("stagehand: stopped")
    return 0


def _ask(cfg: StagehandConfig, args: argparse.Namespace) -> int:
    from .agents.module import Agents, answer

    agents = cfg.modules["agents"]
    assert isinstance(agents, Agents)
    personas = agents.cfg.personas
    name = args.character or next(iter(personas))
    if name not in personas:
        print(f"no persona for {name!r} (have: {', '.join(personas)})", file=sys.stderr)
        return 2
    persona, model = personas[name], agents.cfg.models[name]
    variables = {}
    for pair in args.var:
        key, _, value = pair.partition("=")
        variables[key.strip()] = value.strip()
    history: list[dict] = []

    async def say(text: str) -> None:
        history.append({"seq": len(history), "mine": False, "from": args.name, "text": text})
        req = {
            "id": "ask",
            "character": name,
            "speaker": {"kind": "guest", "id": "ask", "name": args.name, "faction": None},
            "text": text,
            "history": history[-30:],
            "self": {"vars": variables, "ranges": {}, "codex": []},
            "them": {"vars": {}, "codex": [], "location": None},
            "world": {},
        }
        reply = await answer(persona, model, req, gate=False)
        print(f"{name}: {reply.say or '(silence)'}")
        if reply.adjust:
            print(f"  adjust {json.dumps(reply.adjust)}")
            for key, delta in reply.adjust.items():
                try:
                    variables[key] = str(float(variables.get(key, 0)) + delta)
                except ValueError:
                    pass
        if reply.say:
            history.append({"seq": len(history), "mine": True, "from": name, "text": reply.say})

    if args.text:
        asyncio.run(say(" ".join(args.text)))
        return 0
    print(f"talking to {name} via {model.model} — Ctrl+D to stop")
    try:
        while True:
            line = input(f"{args.name}> ").strip()
            if line:
                asyncio.run(say(line))
    except (EOFError, KeyboardInterrupt):
        print()
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
