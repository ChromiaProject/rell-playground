plugins {
    alias(libs.plugins.kotlin.jvm) apply false
}

group = "com.chromia.rellplayground"
version = "0.1.0"

subprojects {
    group = rootProject.group
    version = rootProject.version
}
