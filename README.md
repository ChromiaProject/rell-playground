# rell-playground

Backend-less SPA for trying [Rell](https://rell.chromia.com) in the browser.
**Live:** <https://chromiaproject.github.io/rell-playground/>

Three modes:

- Run — paste a complete program, click Run. For pure functions, `print`,
  expression evaluation, struct/enum defs, etc. Output appears in the right
  pane. (Entity / query / operation declarations aren't allowed here — use SQL
  dry-run for those.)
- SQL dry-run — declare entities + a `query main()`; the playground compiles
  every `@`-expression to SQL and shows the statements postchain *would* issue
  in the **SQL** pane. Nothing actually executes (there's no database), so
  queries run against an empty result set.
- REPL

The Rell compiler + interpreter is compiled ahead-of-time to JavaScript by
[TeaVM](https://teavm.org). The browser loads the resulting ESM module directly
— no JVM bytecode interpreter, no CheerpJ runtime, just a single `.js` file.

## Architecture

```
SPA (TypeScript, Vite)
  └─ Web Worker (ESM)
       └─ rell-playground-bridge.js  (TeaVM AOT JS)
            ├─ PlaygroundJsBridge    @JSExport static API (version / runFile / runModule / repl*)
            ├─ ReplSession           wraps ReplInterpreter (Run + REPL modes)
            ├─ ModuleSession         compiles source as module 'main' (SQL dry-run)
            ├─ CapturingSqlManager   records SQL before returning empty results
            └─ BufferedReplChannel   emits a JSON event envelope
```

The worker imports `rell-playground-bridge.js` as ESM and calls the
`@JSExport`-annotated static methods (`version`, `runFile`, `runModule`,
`replCreate`, `replExecute`, `replDispose`) directly. Each call returns a JSON
envelope `{"ok": bool, "events": […]}` whose events are stdout lines, REPL
value prints, compiler diagnostics, runtime errors, and **`sql`** entries. The
worker forwards each as a `postMessage`; `main.ts` routes them — `sql` → SQL
pane, everything else → the output panel.

### SQL capture

`CapturingSqlManager` replaces Rell's `NoConnSqlManager`. Every SQL string Rell
hands the executor is appended to the event channel; the executor then returns
an **empty** result (rather than throwing "no database connection"), so a whole
routine's worth of statements is captured in one run instead of just the first.
This is something the stock `rell.sh` can't do — without `--db-url` it bails on
the first SQL call.

## Build

```sh
./gradlew assembleAll        # → web/dist/

# Or, for dev:
./gradlew dev                # http://localhost:5173
```

The bridge JS lands at `web/public/teavm/rell-playground-bridge.js` (mirrored
there by `:bridge:copyTeavmToWeb`). Vite copies `web/public/` verbatim into
`web/dist/`, so the worker's static `/teavm/rell-playground-bridge.js` import
resolves both in dev and prod.

## CI / deployment

`.github/workflows/ci.yml` runs three jobs:

- **bridge** — runs `:bridge:build`, uploads `web/public/teavm/` as an artifact.
- **build** — downloads the bridge artifact and runs `:web:assemble` to
  produce `web/dist/`. Also runs the Vitest survival kit against the bridge.
- **deploy** — on `master`, publishes `web/dist/` to GitHub Pages.
