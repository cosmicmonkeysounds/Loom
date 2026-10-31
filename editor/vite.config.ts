import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// The Loom SaaS backend (auth + projects + events + live event routes).
// Override with LOOM_SERVER, e.g. http://192.168.x.x:7000.
const apiTarget = process.env.LOOM_SERVER ?? 'http://localhost:7000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Same-origin from the browser so the BetterAuth session cookie flows.
      '/api': { target: apiTarget, changeOrigin: true },
      '/e': { target: apiTarget, changeOrigin: true },
    },
  },
  resolve: {
    // `@loom/play` sources sit next to their own (older) React install; one
    // React for the whole page, or the embedded app's hooks break.
    dedupe: ['react', 'react-dom'],
    alias: {
      // Loom engine as TypeScript source (no wasm). Subpaths first so
      // they win over the bare-package fallback. `sim` is the ecosystem
      // runtime (drives Sim mode locally); `chat` + `views` are the
      // server's pure, dependency-free projections (message composition
      // + snapshot shapes) reused verbatim so the local simulator and
      // the live event render identically.
      '@loom/core/parser': path.resolve(__dirname, '../core/src/parser/index.ts'),
      '@loom/core/lsp': path.resolve(__dirname, '../core/src/lsp/index.ts'),
      '@loom/core/sim': path.resolve(__dirname, '../core/src/runtime/sim/index.ts'),
      // Not imported by the editor itself — `@loom/bank` (aliased to source
      // below) resolves its value/expression helpers through it.
      '@loom/core/runtime': path.resolve(__dirname, '../core/src/runtime/index.ts'),
      '@loom/core/chat': path.resolve(__dirname, '../core/server/chat.ts'),
      '@loom/core/views': path.resolve(__dirname, '../core/server/views.ts'),
      '@loom/core/mod-patch': path.resolve(__dirname, '../core/server/mod-patch.ts'),
      '@loom/core/cue-sheet': path.resolve(__dirname, '../core/src/cue-sheet.ts'),
      // The host board (wave 13): the judging / queue / parts / guests /
      // wallet / award / needs helpers a Play host booth shares.
      '@loom/core/host-board': path.resolve(__dirname, '../core/src/host-board.ts'),
      // The house desk (wave 25): the cue list, its timelines, the checks and
      // the status chips Run → House draws (pure, dependency-free).
      '@loom/core/house-desk': path.resolve(__dirname, '../core/src/house-desk.ts'),
      '@loom/core/house-mixer': path.resolve(__dirname, '../core/src/house-mixer.ts'),
      // The credits (wave 44): Run's Credits card reads the roll as text.
      '@loom/core/credits': path.resolve(__dirname, '../core/src/credits.ts'),
      '@loom/core/voice-fx': path.resolve(__dirname, '../core/src/voice-fx.ts'),
      '@loom/core/audio-ads': path.resolve(__dirname, '../core/src/audio-ads.ts'),
      '@loom/core/link-health': path.resolve(__dirname, '../core/src/link-health.ts'),
      '@loom/core/photos': path.resolve(__dirname, '../core/src/photos.ts'),
      '@loom/core': path.resolve(__dirname, '../core/src/index.ts'),
      // The house model (wave 30): the Cue designer edits, plans and
      // previews `lights.json` looks with the server's own rules. `/three`
      // is the embedded map's 3D preview (its own lazy chunk, wave 49).
      '@loom/house/three': path.resolve(__dirname, '../house/src/three/index.ts'),
      '@loom/house': path.resolve(__dirname, '../house/src/index.ts'),
      // Bank compiler as TypeScript source — the desktop app compiles
      // .loombank artifacts in the webview and hands bytes to the host.
      '@loom/bank': path.resolve(__dirname, '../bank/src/index.ts'),
      // The participant app as TypeScript source — Run → Players embeds the
      // real guest / performer app (one per pane) instead of a look-alike.
      '@loom/play/embed': path.resolve(__dirname, '../play/src/embed.tsx'),
      // The rest of play by path, for the embedded map's `client.ts` and our
      // own `lazy-chunk.tsx`.
      '@loom/play': path.resolve(__dirname, '../play/src'),
      // The real house map editor (wave 49), loaded lazily by Run → House → 🗺 Map.
      '@loom/reinstall/map': path.resolve(__dirname, '../reinstall/web/src/map/embed.tsx'),
      '@': path.resolve(__dirname, './src'),
      // The browser has no `node:crypto`; `@loom/core/chat` reaches it
      // through the server's wallet + identity modules (the claim HMAC,
      // never called here). Vite's externalized stub throws on import, so
      // the dev server and the build get a stand-in; vitest (Node) keeps
      // the real module.
      ...(process.env.VITEST ? {} : { 'node:crypto': path.resolve(__dirname, './src/lib/node-crypto-stub.ts') }),
    },
  },
  // Unit tests only — the Playwright `e2e/*.spec.ts` suites run via the
  // separate `test:e2e` script and must not be swept up by vitest.
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
