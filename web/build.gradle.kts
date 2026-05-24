import com.github.gradle.node.pnpm.task.PnpmTask

plugins {
    base
    alias(libs.plugins.node.gradle)
}

description = "SPA frontend. node-gradle drives pnpm install + Vite; output lands in web/dist/."

node {
    download = true
    version = "22.13.0"
    distBaseUrl = "https://nodejs.org/dist"

    // pnpm: faster, content-addressable installs and a single canonical lockfile. node-gradle
    // downloads pnpm itself when `download = true`, mirroring how it handles npm.
    pnpmVersion = "10.20.0"

    // node-gradle defaults to <project-build>/nodejs, but pinning to a per-project location lets
    // .gitignore catch the directory cleanly and makes `git clean -fdx` predictable.
    workDir = layout.buildDirectory.dir("nodejs").get().asFile
    npmWorkDir = layout.buildDirectory.dir("npm").get().asFile
    pnpmWorkDir = layout.buildDirectory.dir("pnpm").get().asFile
    nodeProjectDir = layout.projectDirectory.asFile
}

// The bridge's TeaVM output is copied into web/public/teavm by :bridge:build. Wire it as an
// explicit Gradle dependency so `:web:assemble` triggers a fresh JS build, and `pnpm run dev`
// sees the latest bridge module without manual coordination.
val bridgeJsReady by tasks.registering {
    description = "Ensures the bridge's TeaVM JS module is fresh under web/public/teavm/."
    dependsOn(":bridge:copyTeavmToWeb")
}

val viteBuild by tasks.registering(PnpmTask::class) {
    description = "Builds the production SPA bundle into web/dist/."
    group = LifecycleBasePlugin.BUILD_GROUP
    dependsOn(tasks.pnpmInstall)
    dependsOn(bridgeJsReady)
    args = listOf("run", "build")

    // Drive incremental rebuild from source — Vite handles its own cache, but Gradle needs
    // an inputs/outputs declaration to participate in --no-daemon and CI caching.
    inputs.dir(layout.projectDirectory.dir("src"))
    inputs.dir(layout.projectDirectory.dir("public"))
    inputs.file(layout.projectDirectory.file("index.html"))
    inputs.file(layout.projectDirectory.file("package.json"))
    inputs.file(layout.projectDirectory.file("pnpm-lock.yaml"))
    inputs.file(layout.projectDirectory.file("vite.config.ts"))
    inputs.file(layout.projectDirectory.file("tsconfig.json"))
    outputs.dir(layout.projectDirectory.dir("dist"))
}

val viteDev by tasks.registering(PnpmTask::class) {
    description = "Starts the Vite dev server on http://localhost:5173/."
    group = "application"
    dependsOn(tasks.pnpmInstall)
    dependsOn(bridgeJsReady)
    args = listOf("run", "dev")
    // Long-running task: do not declare outputs (would make Gradle treat the running server
    // as "UP-TO-DATE" on subsequent invocations).
}

val typecheck by tasks.registering(PnpmTask::class) {
    description = "Runs the TypeScript type-checker over the SPA sources."
    group = LifecycleBasePlugin.VERIFICATION_GROUP
    dependsOn(tasks.pnpmInstall)
    args = listOf("run", "typecheck")
    inputs.dir(layout.projectDirectory.dir("src"))
    inputs.dir(layout.projectDirectory.dir("test"))
    inputs.file(layout.projectDirectory.file("package.json"))
    inputs.file(layout.projectDirectory.file("pnpm-lock.yaml"))
    inputs.file(layout.projectDirectory.file("tsconfig.json"))
    outputs.upToDateWhen { true }
}

// Vitest integration suite over the TeaVM-compiled bridge JS — loads the 80 MB bridge module
// once per worker and asserts on the JSON envelopes its @JSExport methods return. Bumps the
// V8 heap to 8 GB via NODE_OPTIONS because the bridge JS is large enough that the default
// 4 GB ceiling OOMs Vitest's transform step.
val vitestRun by tasks.registering(PnpmTask::class) {
    description = "Runs the bridge survival/integration suite (Vitest) against the TeaVM JS."
    group = LifecycleBasePlugin.VERIFICATION_GROUP
    dependsOn(tasks.pnpmInstall)
    dependsOn(bridgeJsReady)
    args = listOf("run", "test")
    environment.put("NODE_OPTIONS", "--max-old-space-size=8192")
    inputs.dir(layout.projectDirectory.dir("test"))
    inputs.dir(layout.projectDirectory.dir("public/teavm"))
    inputs.file(layout.projectDirectory.file("package.json"))
    inputs.file(layout.projectDirectory.file("pnpm-lock.yaml"))
    inputs.file(layout.projectDirectory.file("tsconfig.json"))
    outputs.upToDateWhen { true }
}

tasks.assemble {
    dependsOn(viteBuild)
}

tasks.check {
    dependsOn(typecheck, vitestRun)
}
