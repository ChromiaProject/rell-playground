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
       └─ rell-playground-bridge.js  (TeaVM AOT JS, ~few MB)
            ├─ PlaygroundJsBridge    @JSExport static API (version / runFile / runModule / repl*)
            ├─ ReplSession           wraps ReplInterpreter (Run + REPL modes)
            ├─ ModuleSession         compiles source as module 'main' (SQL dry-run)
            ├─ CapturingSqlManager   records SQL before returning empty results
            └─ BufferedReplChannel   emits a JSON event envelope
                 + net.postchain.rell:0.16.0-SNAPSHOT + deps (jOOQ DSL, jackson, …)
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

## TeaVM compatibility surface

TeaVM ships ~30 emulated JDK packages; rell-base's transitive deps (jOOQ,
Jackson, SLF4J, kotlin-reflect, …) reach into ~50 classes TeaVM does not.
We close that gap with two narrow surfaces:

1. **`bridge/build.gradle.kts`** generates a stubs JAR with empty bytecode for
   `java.sql.*`, `java.beans.ConstructorProperties`, `java.security.MessageDigest`,
   `java.util.HexFormat`, `java.util.Scanner`, `java.util.concurrent.{LinkedBlockingQueue,locks,atomic.*Array}`,
   `java.lang.{Module,RuntimePermission,StackWalker,annotation.Documented,reflect.*}`,
   `jakarta.persistence.*`, `javax.xml.*`. The JAR also carries a
   `META-INF/teavm.properties` that re-includes these packages — TeaVM's classlib
   *excludes* the `java.*` hierarchy by default (`includePackageHierarchy|java=false`),
   relying on its own emulation to fill them in.
2. **rell3 source patches** (carte-blanche edits in the parent repo): replace
   `java.util.HexFormat` with hand-written hex codecs in `utils/CommonUtils.kt`,
   and drop the `Class.getResource("/rell-base-maven.properties")` lookup in
   `Rt_RellVersion` (the fallback was already there for non-classpath runs).

None of the stubs are exercised at runtime in the browser dry-run path:
`CapturingSqlExecutor` throws before touching JDBC, log calls go through
kotlin-logging's no-op binding (no SLF4J StaticLoggerBinder is found), and
Rell's JSON support uses Jackson lazily — touched only when a Rell program
declares a `json`-typed value.

## Build

Requires JDK 21 to drive Gradle (TeaVM 0.12 cannot read class files from JDK
25+). Node is downloaded into `web/build/nodejs/` by the
`com.github.node-gradle.node` plugin — no system Node needed.

```sh
# Step 1: publish rell3 modules the bridge depends on. From a sibling rell3 checkout:
cd ../rell3
./gradlew \
  :rell-base:utils:publishToMavenLocal \
  :rell-base:rr-tree:publishToMavenLocal \
  :rell-base:frontend:publishToMavenLocal \
  :rell-base:runtime-core:publishToMavenLocal \
  :rell-base:runtime-interpreter:publishToMavenLocal \
  :rell-base:publishToMavenLocal \
  :rell-api-base:publishToMavenLocal

# Step 2: build the bridge JS + the SPA bundle.
cd ../rell-playground
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

- **bridge** — JDK 21; checks out rell3 at the pinned ref (only if not already
  cached in `~/.m2/`), publishes the rell-base sub-modules + rell-api-base into
  mavenLocal, runs `:bridge:build`, uploads `web/public/teavm/` as an artifact.
- **build** — JDK 21 (drives Gradle, which drives the bundled Node); downloads
  the bridge artifact and runs `:web:assemble` to produce `web/dist/`.
- **deploy** — on `master`, publishes `web/dist/` to GitHub Pages.
