rootProject.name = "repro-1191"

pluginManagement {
    repositories {
        mavenCentral()
        gradlePluginPortal()
        maven("https://teavm.org/maven/repository/") { name = "teavm-dev" }
    }
}

dependencyResolutionManagement {
    repositories {
        mavenCentral()
        maven("https://teavm.org/maven/repository/") { name = "teavm-dev" }
        // Chromia GitLab Maven repos serving rell-base + its transitives. `rell-base` lives
        // on `rell`; `net.postchain:postchain*` on `postchain`; the parent POM both reference
        // on `chromia-parent`. None of these artifacts are mirrored to Maven Central.
        maven("https://gitlab.com/api/v4/projects/32802097/packages/maven") { name = "rell" }
        maven("https://gitlab.com/api/v4/projects/32294340/packages/maven") { name = "postchain" }
        maven("https://gitlab.com/api/v4/projects/50818999/packages/maven") { name = "chromia-parent" }
    }
}
