//! Minimal Server-Sent-Events parsing over a `fetch` body stream.
//!
//! The event server frames as `event: <name>\ndata: <json>\n\n` with
//! `:ping` comment keepalives (`core/server/http-util.ts::sseSend`). The
//! parser is incremental — feed it arbitrary chunks, get complete frames.

export interface SseFrame {
  event: string;
  data: string;
}

export class SseParser {
  private buf = "";

  /** Append a chunk; return every complete frame it completed. */
  feed(chunk: string): SseFrame[] {
    this.buf = (this.buf + chunk).replace(/\r\n/gu, "\n");
    const frames: SseFrame[] = [];
    let end = this.buf.indexOf("\n\n");
    while (end !== -1) {
      const block = this.buf.slice(0, end);
      this.buf = this.buf.slice(end + 2);
      let event = "message";
      const datas: string[] = [];
      for (const line of block.split("\n")) {
        if (line === "" || line.startsWith(":")) continue;
        if (line.startsWith("event:")) event = line.slice("event:".length).trim();
        else if (line.startsWith("data:")) datas.push(line.slice("data:".length).replace(/^ /u, ""));
      }
      if (datas.length > 0) frames.push({ event, data: datas.join("\n") });
      end = this.buf.indexOf("\n\n");
    }
    return frames;
  }
}

/**
 * Open an SSE stream with `fetch` (so the mod token can ride a header,
 * which `EventSource` can't do) and call `onFrame` for every frame until
 * the connection closes or `signal` aborts. Resolves when the stream ends.
 */
export async function streamSse(
  url: string,
  headers: Record<string, string>,
  onFrame: (frame: SseFrame) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, { headers: { accept: "text/event-stream", ...headers }, signal });
  if (!res.ok || res.body === null) throw new Error(`SSE ${url} → HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    for (const frame of parser.feed(decoder.decode(value, { stream: true }))) await onFrame(frame);
  }
}
