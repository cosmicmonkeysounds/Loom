import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The Loom event server (API + SSE) to proxy to during `pnpm dev`.
// Override with LOOM_SERVER, e.g. http://192.168.x.x:7000.
const target = process.env.LOOM_SERVER ?? "http://localhost:7000";

export default defineConfig({
  plugins: [react()],
  // Served by the event server under `/terminal/` (next to the play app at `/`).
  base: "/terminal/",
  server: {
    port: 5175,
    host: true, // expose on the LAN so a tablet can hit the dev server too
    proxy: {
      "/api": { target, changeOrigin: true },
      "/e": { target, changeOrigin: true },
    },
  },
  resolve: {
    // One React for the page — the play app's transport hooks are imported
    // as source and must share ours.
    dedupe: ["react", "react-dom"],
    alias: {
      // The participant app's transport + shapes, reused verbatim: the SSE
      // reducer (`history` / `message` / `typing` / `lifecycle`), the JSON
      // POST helper, and the message / view types — so a terminal reads the
      // same threads a phone does, off the same stream.
      "@loom/play": path.resolve(__dirname, "../play/src"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
