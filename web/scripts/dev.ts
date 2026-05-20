// Dev server. Serves the SPA from source via Bun.serve — no bundling step.
// Worker, Monaco, and main are loaded as ESM directly; bun resolves bare
// imports against node_modules.

import { existsSync, statSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PORT = Number(process.env["PORT"] ?? 5173);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".ts": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".map": "application/json",
};

async function transpile(path: string): Promise<string> {
  // bun supports running .ts directly in scripts, but the *browser* needs JS.
  // Bun's transpiler is the cleanest way to ship single TS files at request time.
  const transpiler = new Bun.Transpiler({ loader: "ts", target: "browser" });
  const code = readFileSync(path, "utf8");
  return transpiler.transform(code);
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = url.pathname === "/" ? "/index.html" : url.pathname;

    // main.ts loads the worker via `new URL("./worker.js", import.meta.url)`.
    // In dev that resolves to /src/worker.js — alias it to src/bridge/worker.ts.
    if (pathname === "/src/worker.js") {
      pathname = "/src/bridge/worker.ts";
    }

    // Resolve under ROOT, then fall through to node_modules for bare imports
    // rewritten by bun's import-map (handled below).
    const candidates: string[] = [
      join(ROOT, pathname),
      join(ROOT, "public", pathname),
    ];
    if (pathname.startsWith("/node_modules/")) {
      candidates.unshift(join(ROOT, pathname.slice(1)));
    }

    for (const file of candidates) {
      if (existsSync(file) && statSync(file).isFile()) {
        const ext = extname(file);
        const mime = MIME[ext] ?? "application/octet-stream";
        if (ext === ".ts") {
          const js = await transpile(file);
          return new Response(rewriteBareImports(js), { headers: { "content-type": MIME[".js"]! } });
        }
        if (ext === ".js" || ext === ".mjs") {
          const text = readFileSync(file, "utf8");
          return new Response(rewriteBareImports(text), { headers: { "content-type": mime } });
        }
        // Monaco's standalone code does `import './foo.css'`. Browsers reject CSS
        // as a JS module, so wrap CSS in a tiny shim that injects a <style> tag.
        // Production build (Bun.build) handles this natively; this is dev-only.
        if (ext === ".css" && req.headers.get("sec-fetch-dest") === "script") {
          const css = readFileSync(file, "utf8");
          const shim = `const s = document.createElement("style");\ns.textContent = ${JSON.stringify(css)};\ndocument.head.appendChild(s);\nexport default null;\n`;
          return new Response(shim, { headers: { "content-type": MIME[".js"]! } });
        }
        return new Response(Bun.file(file), { headers: { "content-type": mime } });
      }
    }
    return new Response("not found", { status: 404 });
  },
});

// Crude bare-import rewriter: `from "monaco-editor"` -> `from "/node_modules/monaco-editor/esm/vs/editor/editor.api.js"`.
function rewriteBareImports(src: string): string {
  return src.replace(/from\s+["']monaco-editor["']/g, 'from "/node_modules/monaco-editor/esm/vs/editor/editor.api.js"');
}

console.log(`rell-playground dev → http://localhost:${PORT}`);
