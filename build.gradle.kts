plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.teavm) apply false
    alias(libs.plugins.node.gradle) apply false
}

group = "com.chromia.rellplayground"
version = "0.1.0"

subprojects {
    group = rootProject.group
    version = rootProject.version
}

// Convenience root tasks. `./gradlew assemble` builds the bridge JS (TeaVM) and the SPA bundle
// (Vite via :web); `./gradlew dev` runs the Vite dev server with a fresh bridge JS.
tasks.register("assembleAll") {
    group = LifecycleBasePlugin.BUILD_GROUP
    description = "Builds bridge TeaVM JS + SPA production bundle."
    dependsOn(":bridge:build", ":web:assemble")
}

tasks.register("dev") {
    group = "application"
    description = "Builds the bridge JS once, then starts the Vite dev server on :5173."
    dependsOn(":bridge:copyTeavmToWeb", ":web:viteDev")
}
