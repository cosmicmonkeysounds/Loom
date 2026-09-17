"""The `stagehand` command.

    stagehand run    --config laptop.yaml [--only agents]   run every enabled module
    stagehand check  --config laptop.yaml [--only agents]   validate + describe, exit
    stagehand modules                                        list the module kinds
    stagehand ask    --config laptop.yaml [--character Trabolta] [--name Ada] [--reflect] [text…]
                     talk to an agent persona straight through the model — no
                     server, no story; one line, or an interactive chat. With
                     --reflect the orchestrator runs after each exchange and the
                     evolving brief / dossier is printed, so the mind can be
                     tuned offline.
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
    ask.add_argument("--reflect", action="store_true", help="run the orchestrator after each exchange and print the mind")
    ask.add_argument("--power", action="append", default=[], metavar="NAME", help="pretend the story declares this power (repeatable)")
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
    from .agents.mind import Mind
    from .agents.module import Agents, answer, thread_key
    from .agents.orchestrator import parse_update, reflect_messages

    agents = cfg.modules["agents"]
    assert isinstance(agents, Agents)
    personas = agents.cfg.personas
    name = args.character or next(iter(personas))
    if name not in personas:
        print(f"no persona for {name!r} (have: {', '.join(personas)})", file=sys.stderr)
        return 2
    persona, model = personas[name], agents.cfg.models[name]
    orchestrator_model = agents.cfg.orchestrator_models[name]
    variables = {}
    for pair in args.var:
        key, _, value = pair.partition("=")
        variables[key.strip()] = value.strip()
    history: list[dict] = []
    mind = Mind(character=name, event="ask")
    powers = [{"id": p, "label": p, "description": None, "limit": None, "used": 0} for p in args.power]

    async def say(text: str) -> None:
        history.append({"seq": len(history) + 1, "mine": False, "from": args.name, "text": text})
        req = {
            "id": "ask",
            "character": name,
            "thread": {"character": name, "channel": f"dm:{name}", "audience": ["ask"]},
            "speaker": {"kind": "guest", "id": "ask", "name": args.name, "faction": None},
            "text": text,
            "history": history[-30:],
            "self": {"vars": variables, "ranges": {}, "codex": []},
            "them": {"vars": {}, "codex": [], "location": None},
            "world": {},
            "powers": powers,
        }
        reply = await answer(persona, model, req, gate=False, mind=mind if args.reflect else None)
        if reply.lookup:
            print(f"  (wanted to look up: {', '.join(reply.lookup)} — no session here)")
        print(f"{name}: {reply.say or '(silence)'}")
        if reply.adjust:
            print(f"  adjust {json.dumps(reply.adjust)}")
            for key, delta in reply.adjust.items():
                try:
                    variables[key] = str(float(variables.get(key, 0)) + delta)
                except ValueError:
                    pass
        if reply.acts:
            print(f"  act {json.dumps(list(reply.acts))}")
        if reply.say:
            history.append({"seq": len(history) + 1, "mine": True, "from": name, "text": reply.say})
        if not args.reflect:
            return
        mind.saw_exchange("ask", args.name, "guest", thread_key(req), len(history))
        from .agents.llm import complete

        raw = await complete(reflect_messages(persona, mind, req, reply, None, persona.summarize_after, thread_key(req)), orchestrator_model)
        update = parse_update(raw)
        if update is None:
            print(f"  [mind] unusable orchestrator output: {raw[:200]!r}")
            return
        touched = mind.apply(update, speaker_id="ask", thread_key=thread_key(req), upto=len(history))
        print(f"  [mind] updated {', '.join(touched) or 'nothing'}")
        if mind.brief:
            print("  [brief] " + " / ".join(mind.brief.splitlines()))
        if mind.mood:
            print(f"  [mood] {mind.mood}")
        for n in mind.notes[-4:]:
            print(f"  [note] {n}")
        d = mind.people.get("ask")
        if d is not None and (d.summary or d.claims):
            print(f"  [you] trust {d.trust}: {d.summary}" + (f" | claims: {'; '.join(d.claims[-3:])}" if d.claims else ""))
        memo = mind.threads.get(thread_key(req))
        if memo is not None and memo.summary:
            print(f"  [thread] {memo.summary}")

    if args.text:
        asyncio.run(say(" ".join(args.text)))
        return 0
    print(f"talking to {name} via {model.model}" + (f"; mind via {orchestrator_model.model}" if args.reflect else "") + " — Ctrl+D to stop")
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
