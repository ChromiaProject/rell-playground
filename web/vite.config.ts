import { defineConfig } from "vite";
import { resolve } from "node:path";

// Vite drives both dev (HMR over native ESM) and prod (Rollup bundle). The SPA has two
// JS entry points: the main bundle (loaded from index.html) and the worker (instantiated
// from main.ts via `new Worker(new URL("./bridge/worker.ts", import.meta.url))`). Vite
// handles the worker entrypoint natively via the `?worker` query suffix in source, but
// to keep the SPA shape identical to the legacy Bun build (worker.js next to main.HASH.js,
// stable filename) we explicitly opt into a second Rollup input.

export default defineConfig({
  root: resolve(__dirname),
  publicDir: resolve(__dirname, "public"),
  // Relative base — the SPA is served from a sub-path on GitHub Pages.
  base: "./",
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    rollupOptions: {
      input: {
        // Index produces the main bundle (hashed for cache-busting via Vite's defaults).
        index: resolve(__dirname, "index.html"),
      },
      output: {
        assetFileNames: "assets/[name].[hash][extname]",
        chunkFileNames: "assets/[name].[hash].js",
        entryFileNames: "assets/[name].[hash].js",
      },
    },
  },
  // Monaco's web workers and our bridge worker both get the standard ?worker treatment.
  worker: {
    format: "es",
    rollupOptions: {
      output: {
        // Stable worker name (no hash) so main.ts's `new URL("./worker.js", import.meta.url)`
        // path resolves correctly in prod.
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].[hash].js",
        assetFileNames: "assets/[name].[hash][extname]",
      },
    },
  },
  resolve: {
    // Resolve the bare `import * as monaco from "monaco-editor"` to its ESM bundle
    // entrypoint. The alias must be exact-match (regex with `$` anchor) so deep imports
    // like `monaco-editor/esm/vs/editor/editor.worker.js?worker` aren't rewritten into a
    // nonsensical doubled path.
    alias: [
      {
        find: /^monaco-editor$/,
        replacement: "monaco-editor/esm/vs/editor/editor.api.js",
      },
    ],
  },
  optimizeDeps: {
    // Pre-bundle Monaco. The alias above rewrites `monaco-editor` → the ESM api.js entry,
    // so listing just `monaco-editor` here is enough — Vite walks its transitive imports
    // and bundles them. Listing the deep path would double up via the alias and crash
    // optimizeDeps' resolver with a recursive path.
    include: ["monaco-editor"],
  },
});
