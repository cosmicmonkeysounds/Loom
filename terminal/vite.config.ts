import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { execSync } from "node:child_process";

// The Loom event server (API + SSE) to proxy to during `pnpm dev`.
// Override with LOOM_SERVER, e.g. http://192.168.x.x:7000.
const target = process.env.LOOM_SERVER ?? "http://localhost:7000";

// The build stamp every poll reports (SW-SCR-21, `src/health.ts`): the git
// short sha (when there is a .git — not in the Docker build) + the build
// time, since a show build is often an uncommitted tree. The Run card marks
// a tablet whose stamp differs from the others' (a cached old build).
function buildStamp(): string {
  let sha = "";
  try {
    sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    /* no git */
  }
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  const time = `${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
  return sha === "" ? time : `${sha}.${time}`;
}

export default defineConfig({
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(process.env.LOOM_BUILD ?? buildStamp()) },
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
    // as source and must share ours. One three too: `@loom/house/three`
    // (workspace source) builds the scene the terminal's renderer draws.
    dedupe: ["react", "react-dom", "three"],
    alias: {
      // The participant app's transport + shapes, reused verbatim: the SSE
      // reducer (`history` / `message` / `typing` / `lifecycle`), the JSON
      // POST helper, and the message / view types — so a terminal reads the
      // same threads a phone does, off the same stream.
      "@loom/play": path.resolve(__dirname, "../play/src"),
      // The reinstallation flow + game (wave 18b, `view=reinstall` on the
      // tent laptop): the reinstall app's own source, mounted in a lazy
      // chunk. Its files import the terminal's scanner as `@loom/terminal/…`,
      // which here is this package's own `src`.
      "@loom/reinstall": path.resolve(__dirname, "../reinstall/web/src"),
      "@loom/terminal": path.resolve(__dirname, "src"),
    },
  },
  build: {
    // The oldest wall tablets (#15, OCT31 K-14): Chrome/WebView 87 = Android
    // 5's last Chrome; Safari 14 for the iPads. Pinned rather than Vite's
    // moving default. Syntax only — runtime APIs newer than 87 need a
    // fallback in code (e.g. `cloneData` for `structuredClone`).
    target: ["chrome87", "safari14"],
    // The lazy world-view chunk is mostly three.js (~600 kB, ~160 kB gzip),
    // loaded only by a terminal that shows the simulation.
    chunkSizeWarningLimit: 700,
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
