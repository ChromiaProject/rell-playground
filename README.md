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

The Rell compiler + interpreter runs in the browser via
[CheerpJ](https://leaningtech.com/cheerpj/), a JVM bytecode runtime for the
web. No server, no database — entity-backed Rell features can't *execute*, but
in SQL dry-run mode the generated SQL is shown.

## Why the bundled Rell is rebuilt at Java 17

CheerpJ 4.x ships a JRE that tops out at **Java 17** bytecode. The published
`net.postchain.rell` artifacts (and the playground bridge) are compiled to
**Java 21**, which CheerpJ refuses to load. So CI rebuilds Rell from source at
the pinned tag with `jvmTarget = 17` + `javac --release 17` (see
`scripts/build-rell-java17.sh`).

That rebuild also patches one upstream incompatibility: `UniqueStack.pop()` in
`rell-base` calls `MutableList.removeLast()`, which Kotlin 2.x compiles to a
call against `java.util.List.removeLast()` — a method that only exists in Java
21 (`SequencedCollection`). On a Java 17 JRE that throws `NoSuchMethodError`,
which surfaced as the REPL silently failing to initialise. The script rewrites
it to `removeAt(size - 1)`.

## Architecture

```
SPA (TypeScript, Bun)
  └─ Web Worker
       └─ CheerpJ runtime (cjrtnc.leaningtech.com/4.2, version: 17)
            └─ rell-playground-bridge-all.jar  (Java-17 shadow fat JAR, ~35 MB)
                 ├─ PlaygroundBridge      entry surface (version/runFile/runModule/repl*)
                 ├─ ReplSession           wraps ReplInterpreter (Run + REPL modes)
                 ├─ ModuleSession         compiles source as module 'main' (SQL dry-run)
                 ├─ CapturingSqlManager   records SQL before returning empty results
                 └─ BufferedReplChannel   emits a JSON event envelope
                      + net.postchain.rell:0.15.4 (rebuilt at Java 17) + deps
```

The worker calls static methods on `PlaygroundBridge` through CheerpJ's
Java↔JS bridge. Each call returns a JSON envelope `{"ok": bool, "events":
[…]}` whose events are stdout lines, REPL value prints, compiler diagnostics,
runtime errors, and **`sql`** entries. The worker forwards each as a
`postMessage`; `main.ts` routes them — `sql` → SQL pane, `progress` → the
load bar, everything else → the output panel.

### SQL capture

`CapturingSqlManager` replaces Rell's `NoConnSqlManager`. Every SQL string Rell
hands the executor is appended to the event channel; the executor then returns
an **empty** result (rather than throwing "no database connection"), so a whole
routine's worth of statements is captured in one run instead of just the first.
This is something the stock `rell.sh` can't do — without `--db-url` it bails on
the first SQL call.

### Why not TeaVM

We initially tried TeaVM (ahead-of-time JVM → JS). It failed at link time:
TeaVM's reachability analysis pulled jOOQ classes in through polymorphic
dispatch (`String.format("%h", obj) → Object.hashCode()`) and demanded JDBC
interfaces TeaVM's classlib doesn't ship. Each stub fixes one error and exposes
the next. CheerpJ side-steps the class by running the original JVM bytecode
unmodified.

## Build

Requires JDK 21 (to *run* Gradle/Native toolchains) and [Bun](https://bun.sh)
1.1+. The bridge itself is emitted as Java 17 bytecode.

```sh
# Step 1: rebuild the Rell artifacts at Java 17 and publish to mavenLocal.
#   Clones Rell at tag 0.15.4 into .rell-src/, patches jvmTarget + the
#   removeLast() trap, runs publishToMavenLocal.
bash scripts/build-rell-java17.sh

# Step 2: assemble the bridge shadow JAR (resolved against the Java-17 Rell
#   in mavenLocal). Produces:
#     web/public/jvm/rell-playground-bridge-all.jar      (~89 MB, stored)
#     web/public/jvm/rell-playground-bridge-all.jar.gz   (~22 MB, served)
./gradlew :bridge:build

# Step 3: install web dependencies and build the SPA bundle.
cd web
bun install
bun run build      # → web/dist/

# Or, for dev:
bun run dev        # http://localhost:5173
```

The bridge JAR is **slimmed** at shadow time (Netty, gRPC, Postgres JDBC,
BouncyCastle, protobuf, JAXB, jline/mordant, JNA, multi-release overlays, …
are excluded — none are reachable from a browser dry-run) and stored
uncompressed so the outer `gzip -9` pass collapses cross-entry redundancy.
The worker fetches `.jar.gz`, decodes with `DecompressionStream("gzip")`, and
mounts the bytes into CheerpJ's `/str/` virtual filesystem.

The first Gradle build downloads non-Rell deps from the public GitLab Maven
repos configured in `settings.gradle.kts`; these resolve anonymously, so no
credentials are needed in CI or locally.

## CI / deployment

`.github/workflows/ci.yml` runs the three build stages above as separate jobs:

- **rell-java17** — JDK 21; runs `build-rell-java17.sh`, builds the bridge
  shadow JAR + `.gz`, uploads `web/public/jvm/` as an artifact. The Java-17
  Rell artifacts in `~/.m2` are cached, keyed on the Rell tag + the build
  script, so an unchanged tag skips the heavy clone + republish.
- **build** — Bun; downloads the JVM artifact and builds the SPA into
  `web/dist/`.
- **deploy** — on `master`, publishes `web/dist/` to GitHub Pages at the live
  URL above.

### Self-hosting CheerpJ (optional)

The worker loads the CheerpJ runtime from `cjrtnc.leaningtech.com` by default.
For fully offline deployment, vendor the loader + WASM blobs under
`web/public/cheerpj/` and change the URL in `src/bridge/worker.ts`.
`scripts/fetch-cheerpj.ts` is a starting point (loader script only; a full
mirror needs everything under `cjrtnc.leaningtech.com/4.2/`).
