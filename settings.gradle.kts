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
        maven("https://gitlab.com/api/v4/projects/50818999/packages/maven") { name = "chromia-parent" }
        maven("https://gitlab.com/api/v4/projects/32294340/packages/maven") { name = "postchain" }
        maven("https://gitlab.com/api/v4/projects/64941451/packages/maven") { name = "chromia-cli-tools" }
        maven("https://gitlab.com/api/v4/projects/46288950/packages/maven") { name = "chromia-misc" }
        maven("https://gitlab.com/api/v4/projects/32802097/packages/maven") { name = "rell" }
    }
}
