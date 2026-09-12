//! The model call — one OpenAI-compatible `chat/completions` request.
//! Ollama (`ollama serve`, default `http://localhost:11434/v1`), llama.cpp's
//! server, LM Studio, and vLLM all speak this shape, so "a tiny local LLM
//! on my laptop" needs no SDK. JSON mode is requested; the reply parser
//! copes when a model ignores it.

import type { ChatTurn } from "./prompt.ts";

export interface LlmOptions {
  endpoint: string;
  model: string;
  temperature: number;
  maxTokens: number;
  /** Bearer token for hosted OpenAI-compatible endpoints; local ones need none. */
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Ask the model; returns the assistant text (possibly empty). */
export async function complete(messages: ChatTurn[], o: LlmOptions): Promise<string> {
  const f = o.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? 60_000);
  try {
    const r = await f(`${o.endpoint.replace(/\/+$/u, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(o.apiKey ? { authorization: `Bearer ${o.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: o.model,
        messages,
        temperature: o.temperature,
        max_tokens: o.maxTokens,
        response_format: { type: "json_object" },
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`model endpoint → HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const data = (await r.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
    return data.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}
