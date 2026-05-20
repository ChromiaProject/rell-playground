import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.gradle.api.tasks.bundling.ZipEntryCompression

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.shadow)
}

description =
    "Kotlin/JVM bridge for the playground. Produces a fat JAR loaded by CheerpJ in the browser; exposes runFile / replCreate / replExecute as plain methods that the SPA worker invokes through the CheerpJ JS↔Java bridge."

kotlin {
    // CheerpJ 4.x supports JREs 8/11/17 only. Build at Java 17 — matches the
    // downgraded Rell artifacts (see .gitlab-ci.yml `rell-java17` job).
    compilerOptions.jvmTarget = JvmTarget.JVM_17
    compilerOptions.optIn.add("net.postchain.rell.api.base.InternalRellApi")
}

java.toolchain.languageVersion = JavaLanguageVersion.of(21)

tasks.withType<JavaCompile>().configureEach {
    options.release = 17
}

dependencies {
    implementation(libs.rell.tools)
    implementation(libs.rell.api.shell)
    implementation(libs.rell.api.base)
    implementation(libs.rell.api.gtx)
    implementation(libs.rell.base)
    implementation(libs.rell.gtx)
}

// Shadow fat JAR. CheerpJ takes a single JAR (or directory of JARs) for its
// classpath; bundling everything keeps the SPA-side classpath setup to one
// path string. Output: bridge/build/libs/rell-playground-bridge-all.jar
tasks.shadowJar {
    archiveBaseName.set("rell-playground-bridge")
    archiveClassifier.set("all")
    archiveVersion.set("")
    mergeServiceFiles()
    // Store entries uncompressed — the JAR per-entry deflate prevents the
    // outer Brotli pass (see `brotliBridgeJar` below) from collapsing
    // cross-entry redundancy in the Kotlin/Rell constant pools.
    entryCompression = ZipEntryCompression.STORED
    // Drop module-info from every input JAR — multi-release JARs confuse CheerpJ.
    exclude("META-INF/versions/*/module-info.class")
    exclude("module-info.class")
    // Drop signature files: shadow can't preserve them coherently.
    exclude("META-INF/*.SF", "META-INF/*.DSA", "META-INF/*.RSA")

    // ---- Browser-side slimming ----
    // The playground runs runFile / REPL only — no network, no DB, no CLI shell,
    // no node-native bridges. Dropping these gets the JAR from ~78 MB down to
    // ~30 MB without changing any runtime functionality reachable from the bridge.

    // Networking / RPC / HTTP clients — REPL has no outbound I/O.
    exclude("io/netty/**")
    exclude("io/grpc/**")
    exclude("org/apache/hc/**")
    exclude("org/http4k/**")
    // gRPC's shaded native TLS libs (per-platform .so/.dll/.jnilib).
    exclude("META-INF/native/**")

    // DB drivers / pools / migrations — entity-backed Rell features are off in browser mode.
    exclude("org/postgresql/**")
    exclude("org/apache/commons/dbcp2/**")
    exclude("org/apache/commons/dbutils/**")
    exclude("com/zaxxer/hikari/**")

    // Docker / testcontainers / dev tooling.
    exclude("com/github/dockerjava/**")
    exclude("net/postchain/devtools/**")
    exclude("io/micrometer/**")

    // CLI rendering — REPL goes through our worker bridge, not jline.
    exclude("org/jline/**")
    exclude("com/github/ajalt/mordant/**")

    // JNA — no native access in CheerpJ.
    exclude("com/sun/jna/**")
    exclude("net/java/dev/jna/**")

    // Multi-release JAR variants — CheerpJ provides one JRE; the v9+ overlays
    // are dead weight when Main-Release classes already cover Java 8 baselines.
    exclude("META-INF/versions/**")

    // Build metadata (Maven POMs/modules) — pure noise inside the runtime.
    exclude("META-INF/maven/**")

    // Compile-time annotation jars that leaked into the runtime classpath.
    exclude("org/checkerframework/**")
    exclude("org/jspecify/**")

    // Native-image / GraalVM config — irrelevant under CheerpJ.
    exclude("META-INF/native-image/**")
}

// Mirror the fat JAR into web/public so the SPA serve path stays self-contained.
val copyJarToWeb by tasks.registering(Copy::class) {
    group = LifecycleBasePlugin.BUILD_GROUP
    description = "Copies the shadow JAR into web/public for the SPA to serve."
    dependsOn(tasks.shadowJar)
    from(tasks.shadowJar.get().archiveFile)
    into(rootProject.layout.projectDirectory.dir("web/public/jvm"))
    rename(".*", "rell-playground-bridge-all.jar")
}

// Gzip-compress the (stored-uncompressed) shadow JAR. The worker fetches
// .jar.gz and decodes via DecompressionStream("gzip") — gzip over the raw JAR
// catches cross-entry redundancy that per-entry deflate would hide.
//
// We use gzip (not brotli) because DecompressionStream("br") is not yet
// universally supported in browsers (Chrome rejects it as of 2026-05); gzip
// is in every shipping engine.
val gzipBridgeJar by tasks.registering(Exec::class) {
    group = LifecycleBasePlugin.BUILD_GROUP
    description = "Gzip-compresses the shadow JAR alongside the original."
    dependsOn(copyJarToWeb)
    val webJvm = rootProject.layout.projectDirectory.dir("web/public/jvm")
    val jar = webJvm.file("rell-playground-bridge-all.jar").asFile
    val gz = webJvm.file("rell-playground-bridge-all.jar.gz").asFile
    inputs.file(jar)
    outputs.file(gz)
    // -9 = best ratio; the build runs once per release, CPU is fine.
    // -c writes to stdout; we redirect so the source .jar is left intact and
    // the output lands at the expected path even when --output / -o aren't
    // supported by every gzip flavor (BSD vs GNU). No mv needed.
    commandLine("sh", "-c", "gzip -9 -c '${jar.absolutePath}' > '${gz.absolutePath}'")
}

tasks.build {
    dependsOn(copyJarToWeb)
    dependsOn(gzipBridgeJar)
}
