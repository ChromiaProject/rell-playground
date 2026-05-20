# rell-playground

Backend-less SPA for trying [Rell](https://rell.chromia.com) in the browser.

- **One-file mode** — paste a complete program, click Run. Output appears in the
  right pane.
- **REPL mode** — interactive shell, persistent session across commands.

The Rell compiler + interpreter runs in the browser via
[CheerpJ](https://leaningtech.com/cheerpj/), a JVM bytecode runtime for the
web. No server, no database — entity-backed Rell features (`@`-expressions
hitting persistent storage) are unavailable; everything else (pure functions,
`print`, `log`, expression evaluation, struct/enum definitions, test
functions) works.

## Architecture

```
SPA (TypeScript, Bun)
  └─ Web Worker
       └─ CheerpJ runtime (loaded from cjrtnc.leaningtech.com or self-hosted)
            └─ rell-playground-bridge-all.jar  (Shadow fat JAR)
                 ├─ com.chromia.rellplayground.PlaygroundBridge  (entry surface)
                 ├─ com.chromia.rellplayground.ReplSession       (wraps ReplInterpreter)
                 ├─ com.chromia.rellplayground.BufferedReplChannel (JSON event capture)
                 └─ net.postchain.rell:rell-tools:0.15.4  + transitive deps
```

The worker calls static methods on `PlaygroundBridge` through CheerpJ's
Java↔JS bridge: each call returns a JSON envelope `{"ok": bool, "events":
[…]}` listing stdout lines, REPL value prints, compiler diagnostics, and
runtime errors. The worker forwards each event as a `postMessage` to the
main thread, which routes them to the output panel.

We initially tried TeaVM (ahead-of-time JVM → JS compiler). It failed at
link time: TeaVM's reachability analysis pulled jOOQ classes in through
polymorphic dispatch (`String.format("%h", obj) → Object.hashCode()`) and
demanded JDBC interfaces (`java.sql.DatabaseMetaData`, …) that TeaVM's
classlib doesn't ship. Stubbing JDBC works for the first error but the same
pattern recurs for every `compareTo` / `equals` / `toString` call site —
each one is another stub-spiral candidate. CheerpJ side-steps the whole
class by running the original JVM bytecode unmodified.

## Repository layout

```
rell-playground/
├── bridge/                Kotlin/JVM module assembled into a shadow fat JAR.
│   build.gradle.kts         alias(libs.plugins.shadow); depends on rell-tools:0.15.4
│   src/main/kotlin/com/chromia/rellplayground/
│     PlaygroundBridge.kt    JVM-side surface (version, runFile, replCreate, replExecute, replDispose)
│     ReplSession.kt         wraps net.postchain.rell.base.repl.ReplInterpreter
│     BufferedReplChannel.kt Rt_Printer + ReplOutputChannel that emits JSON events
├── web/                   Vanilla TypeScript SPA, built by Bun.
│   index.html
│   src/
│     main.ts                SPA entry, mode switch, share button
│     output.ts              output panel
│     bridge/
│       protocol.ts          postMessage protocol types
│       client.ts            promise-friendly wrapper around the worker
│       worker.ts            Web Worker; loads CheerpJ + the bridge JAR
│     editor/
│       editor.ts            Monaco mount
│       rell-language.ts     Monarch grammar for Rell
│     modes/
│       file-mode.ts         one-file mode
│       repl-mode.ts         interactive REPL mode
│     util/share.ts          gzip+base64url URL-hash sharing
│   scripts/
│     build.ts               Bun build → web/dist/
│     dev.ts                 Bun dev server (Bun.serve, on-the-fly TS)
│     fetch-cheerpj.ts       optional: vendor the CheerpJ loader into public/
└── .gitlab-ci.yml         builds bridge JAR + SPA, deploys to GitLab Pages.
```

## Build

Requires JDK 21+ and [Bun](https://bun.sh) 1.1+.

```sh
# Step 1: assemble the bridge fat JAR. Output:
#   bridge/build/libs/rell-playground-bridge-all.jar (~78 MB)
# also copied to web/public/jvm/.
./gradlew :bridge:build

# Step 2: install web dependencies and build the SPA bundle.
cd web
bun install
bun run build      # → web/dist/

# Or, for dev:
bun run dev        # http://localhost:5173
```

The first Gradle build downloads Rell artifacts from the GitLab Maven repo
configured in `settings.gradle.kts`. CI passes `gitlabAuthHeaderValue` for
authenticated access.

### Self-hosting CheerpJ (optional)

The worker loads the CheerpJ runtime from `cjrtnc.leaningtech.com` by
default. For fully offline / no-third-party-requests deployment, vendor the
loader (and run-time WASM blobs) under `web/public/cheerpj/` and change the
URL in `src/bridge/worker.ts` to `/cheerpj/loader.js`.
`scripts/fetch-cheerpj.ts` has a starting point — but it only fetches the
loader script. A complete mirror requires copying all files served from
`cjrtnc.leaningtech.com/4.2/`, which is several MB.

### CheerpJ licensing

CheerpJ is free for non-commercial / OSS use. Commercial deployments
require a license from Leaning Technologies — see
https://leaningtech.com/cheerpj/ for terms.

## Deploy

`pages` job in `.gitlab-ci.yml` publishes `web/dist/` to GitLab Pages on every
push to the default branch. Pages serves at
`https://chromaway.gitlab.io/rell-playground/`. The SPA uses relative URLs
throughout so it survives any base path.
