// Build pipeline for the SPA. Pure Bun — no Vite, no webpack.
//
// Order:
//   1. Bundle src/main.ts into dist/assets/main.js
//   2. Bundle src/bridge/worker.ts into dist/assets/worker.js
//   3. Bundle Monaco's language workers into dist/monaco-workers/
//   4. Copy index.html, styles.css, public/ (including jvm/rell-playground-bridge-all.jar) into dist/

import { existsSync, rmSync, mkdirSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const PUBLIC = join(ROOT, "public");

// Monaco's standalone modules do `import './standalone-tokens.css'` (and a
// handful of other .css files). Bun.build's default resolver silently drops
// CSS imports from JS modules, leaving the production bundle with no Monaco
// styles at all — the editor renders but every Monaco-positioned element
// (most visibly textarea.inputarea, which Monaco places via inline
// top/left) falls back to `position: static`, parking the caret at the
// editor's top-left corner regardless of click target.
//
// This plugin matches the runtime shim in scripts/dev.ts: CSS imports turn
// into a JS module that appends a <style> tag at load time. Same effect as
// shipping a separate <link>, but keeps the bundle a single entrypoint and
// preserves the existing index.html shape.
const cssAsStyleTagPlugin: import("bun").BunPlugin = {
  name: "css-as-style-tag",
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      let css = await Bun.file(args.path).text();
      // Inline url(...) font/asset refs as data: URIs. Once the CSS is a
      // <style> tag, relative urls resolve against the document base (site
      // root), not the original file — so e.g. Monaco's
      //   src: url(./codicon.ttf)
      // would 404. Resolving + base64-inlining keeps it self-contained.
      const dir = dirname(args.path);
      const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
      const matches = [...css.matchAll(urlRe)];
      for (const mt of matches) {
        const ref = mt[2]!;
        if (/^(data:|https?:|\/)/.test(ref)) continue; // already absolute
        const assetPath = join(dir, ref.split(/[?#]/)[0]!);
        if (!existsSync(assetPath)) continue;
        const ext = assetPath.split(".").pop()!.toLowerCase();
        const mime =
          ext === "ttf" ? "font/ttf" :
          ext === "woff" ? "font/woff" :
          ext === "woff2" ? "font/woff2" :
          ext === "svg" ? "image/svg+xml" :
          "application/octet-stream";
        const b64 = Buffer.from(await Bun.file(assetPath).arrayBuffer()).toString("base64");
        css = css.replace(mt[0], `url("data:${mime};base64,${b64}")`);
      }
      return {
        contents:
          `const __s = document.createElement("style");\n` +
          `__s.textContent = ${JSON.stringify(css)};\n` +
          `document.head.appendChild(__s);\n` +
          `export default null;\n`,
        loader: "js",
      };
    });
  },
};

if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// Main bundle: hashed for cache-busting. The output filename includes a hash
// so the SPA can be reloaded with confidence after a deploy.
const mainResult = await Bun.build({
  entrypoints: [join(ROOT, "src/main.ts")],
  outdir: join(DIST, "assets"),
  target: "browser",
  format: "esm",
  minify: true,
  sourcemap: "external",
  naming: "main.[hash].[ext]",
  plugins: [cssAsStyleTagPlugin],
});
if (!mainResult.success) {
  for (const log of mainResult.logs) console.error(log);
  throw new Error("main bundle failed");
}

// Worker bundle: stable name. main.ts references it as `./worker.js` relative
// to its own URL, so the file must sit next to main.HASH.js without a hash.
const workerResult = await Bun.build({
  entrypoints: [join(ROOT, "src/bridge/worker.ts")],
  outdir: join(DIST, "assets"),
  target: "browser",
  format: "esm",
  minify: true,
  sourcemap: "external",
  naming: "worker.[ext]",
});
if (!workerResult.success) {
  for (const log of workerResult.logs) console.error(log);
  throw new Error("worker bundle failed");
}

// 3. Monaco's web workers. monaco-editor ships them under esm/vs/.
//    For simplicity we bundle the five we use.
const monacoWorkers = [
  { id: "editor.worker.js", entry: "monaco-editor/esm/vs/editor/editor.worker.js" },
  { id: "json.worker.js", entry: "monaco-editor/esm/vs/language/json/json.worker.js" },
  { id: "css.worker.js", entry: "monaco-editor/esm/vs/language/css/css.worker.js" },
  { id: "html.worker.js", entry: "monaco-editor/esm/vs/language/html/html.worker.js" },
  { id: "ts.worker.js", entry: "monaco-editor/esm/vs/language/typescript/ts.worker.js" },
];
mkdirSync(join(DIST, "monaco-workers"), { recursive: true });
for (const w of monacoWorkers) {
  const out = await Bun.build({
    entrypoints: [require.resolve(w.entry)],
    target: "browser",
    format: "iife",
    minify: true,
  });
  if (!out.success) {
    for (const log of out.logs) console.error(log);
    throw new Error(`monaco worker bundle failed: ${w.id}`);
  }
  const text = await out.outputs[0]!.text();
  writeFileSync(join(DIST, "monaco-workers", w.id), text);
}

// 4. Static files.
cpSync(join(ROOT, "src/styles.css"), join(DIST, "styles.css"));
if (existsSync(PUBLIC)) {
  cpSync(PUBLIC, DIST, { recursive: true });
}

// Rewrite index.html to point at the hashed bundle.
const indexHtml = readFileSync(join(ROOT, "index.html"), "utf8");
const mainOut = mainResult.outputs.find((o) => o.path.endsWith(".js"));
if (!mainOut) throw new Error("no main JS output");
const mainHref = `./assets/${mainOut.path.split("/").pop()!}`;
const stylesHref = "./styles.css";
const patched = indexHtml
  .replace('href="./src/styles.css"', `href="${stylesHref}"`)
  .replace('src="./src/main.ts"', `src="${mainHref}"`);
writeFileSync(join(DIST, "index.html"), patched);

// 5. Sanity: did the bridge JAR make it in?
if (!existsSync(join(DIST, "jvm/rell-playground-bridge-all.jar"))) {
  console.warn(
    "WARNING: dist/jvm/rell-playground-bridge-all.jar missing. Run `./gradlew :bridge:build` first, " +
      "which copies the shadow JAR into web/public/jvm.",
  );
}

console.log(`Built into ${DIST}`);
