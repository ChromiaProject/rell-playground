rootProject.name = "rell-playground"

enableFeaturePreview("TYPESAFE_PROJECT_ACCESSORS")

pluginManagement {
    repositories {
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    // PREFER (not FAIL) project repos: the node-gradle plugin registers a "Node.js" ivy-style
    // repository in :web's build script for Node downloads, and FAIL_ON_PROJECT_REPOS would
    // reject it. PREFER keeps settings as the default for Maven artifacts while letting
    // plugins layer their own download sources on top.
    repositoriesMode = RepositoriesMode.PREFER_SETTINGS

    repositories {
        mavenCentral()
        maven("https://gitlab.com/api/v4/projects/50818999/packages/maven") { name = "chromia-parent" }
        maven("https://gitlab.com/api/v4/projects/32294340/packages/maven") { name = "postchain" }
        maven("https://gitlab.com/api/v4/projects/64941451/packages/maven") { name = "chromia-cli-tools" }
        maven("https://gitlab.com/api/v4/projects/46288950/packages/maven") { name = "chromia-misc" }
        maven("https://gitlab.com/api/v4/projects/32802097/packages/maven") { name = "rell" }
        // node-gradle uses an ivy-pattern lookup against nodejs.org/dist; declare it in
        // settings so PREFER_SETTINGS resolves it instead of the plugin's project-scoped
        // attempt (which our chromia gitlab repos obviously can't serve).
        ivy {
            name = "Node.js"
            setUrl("https://nodejs.org/dist")
            patternLayout {
                artifact("v[revision]/[artifact](-v[revision]-[classifier]).[ext]")
            }
            metadataSources { artifact() }
            content { includeModule("org.nodejs", "node") }
        }
    }
}

include("bridge")
include("web")
