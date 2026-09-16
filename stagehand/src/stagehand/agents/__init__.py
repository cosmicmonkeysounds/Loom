"""Agent-voiced characters — the `agents:` module.

A `CHARACTER` marked `mind: external` in the story has no performer. The
event server turns every conversation with it into an **agent request**
and streams those to workers (`GET /api/agent/stream`); this module is
such a worker. For each request it builds a prompt from the character's
persona file plus the live state the server sends (the character's
variables and codex, who is talking and what they know, the thread so
far), asks a local OpenAI-compatible model (Ollama), and answers with
`POST /api/agent/reply {id, say, adjust}`. The server commits the line
into the thread and clamps the variable nudges to the story's declared
ranges; the story's own `when` watchers decide what the numbers mean.

    persona.py  — the persona file (frontmatter knobs + system prompt)
    prompt.py   — request → chat messages
    llm.py      — the OpenAI-compatible chat call
    reply.py    — model text → {say, adjust}, clamped
    config.py   — the `agents:` section
    module.py   — the worker loop (stream, concurrency, cancel, reply)
"""
