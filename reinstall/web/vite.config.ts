import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The Loom event server (API + SSE) to proxy to during `pnpm dev`.
// Override with LOOM_SERVER, e.g. http://192.168.x.x:7000.
const target = process.env.LOOM_SERVER ?? "http://localhost:7000";

export default defineConfig({
  plugins: [react()],
  // Served by the event server under `/reinstall/` (the map at `/reinstall/map`).
  base: "/reinstall/",
  server: {
    port: 5176,
    host: true, // expose on the LAN so a tablet can hit the dev server too
    proxy: {
      "/api": { target, changeOrigin: true },
      "/e": { target, changeOrigin: true },
    },
  },
  resolve: {
    // One React and one three for the page — the terminal's scanner, the
    // play app's transport and `@loom/house/three` are imported as source
    // and must share ours.
    dedupe: ["react", "react-dom", "three"],
    alias: {
      // The wall terminal's camera scanner + pass parsing, reused verbatim.
      "@loom/terminal": path.resolve(__dirname, "../../terminal/src"),
      // The participant app's JSON POST helper (`api` / `ApiError`).
      "@loom/play": path.resolve(__dirname, "../../play/src"),
    },
  },
  build: {
    // three.js is one big chunk by nature; split it from the app so the
    // map page and the game share it cached.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: { three: ["three"] },
      },
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
