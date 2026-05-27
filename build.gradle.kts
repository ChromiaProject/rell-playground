import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.teavm.gradle.api.OptimizationLevel

// Minimal reproducer for konsoletyper/teavm#1191 (WasmGC NPE in
// ReflectionMetadataGenerator.generate, line 138).
//
// Failing config: backend = WasmGC, optimization = BALANCED, fastGlobalAnalysis = true.
// Same NPE fires at NONE / AGGRESSIVE × fast on/off — see issue for the full matrix.

buildscript {
    // ASM is used by the `generateTeavmStubs` task below to emit empty stub classes for
    // five java.util.concurrent.* types TeaVM's classlib omits.
    repositories { mavenCentral() }
    dependencies { classpath("org.ow2.asm:asm:9.10.1") }
}

plugins {
    kotlin("jvm") version "2.3.0"
    id("org.teavm") version "0.15.0-dev-2"
}

description = "Minimal reproducer for konsoletyper/teavm#1191."

kotlin.compilerOptions { jvmTarget = JvmTarget.JVM_21 }

java.toolchain.languageVersion = JavaLanguageVersion.of(21)

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

// ---- Stubs --------------------------------------------------------------------------------
//
// rell-base's static-init touches five java.util.concurrent.* classes TeaVM-classlib does not
// emulate. We emit empty bytecode for each at `org/teavm/classlib/<pkg>/T<Class>` so
// teavm-classlib's existing T-prefix renamer (`mapPackageHierarchy|org.teavm.classlib.java=java`
// + `stripPrefixFromPackageHierarchyClasses|org.teavm.classlib.java=T`) surfaces them as the
// requested `<pkg>.<Class>` classes. MissingMethodInjector then grafts the called methods onto
// the empty bytecode so reachability analysis converges.

data class Stub(val name: String, val isInterface: Boolean = true)

fun stubInternalName(name: String): String {
    val lastSlash = name.lastIndexOf('/')
    val pkg = name.substring(0, lastSlash)
    val cls = name.substring(lastSlash + 1)
    return "org/teavm/classlib/$pkg/T$cls"
}

val stubs = listOf(
    Stub("java/util/concurrent/atomic/AtomicIntegerArray", isInterface = false),
    Stub("java/util/concurrent/atomic/AtomicLongArray", isInterface = false),
    Stub("java/util/concurrent/atomic/AtomicReferenceArray", isInterface = false),
    Stub("java/util/concurrent/locks/Lock", isInterface = true),
    Stub("java/util/concurrent/locks/ReentrantLock", isInterface = false),
)

val stubsClassesDir = layout.buildDirectory.dir("generated/teavm-stubs/classes")

val generateTeavmStubs by tasks.registering {
    description = "Emits empty stub bytecode for the five JDK classes TeaVM-classlib omits."
    group = LifecycleBasePlugin.BUILD_GROUP

    inputs.property("stubs", stubs.joinToString { "${it.name}|${it.isInterface}" })
    outputs.dir(stubsClassesDir)

    doLast {
        val classVersion = 55 // Java 11 class format; TeaVM accepts anything <= 21.
        val outDir = stubsClassesDir.get().asFile
        outDir.deleteRecursively()
        outDir.mkdirs()

        for (stub in stubs) {
            val internalName = stubInternalName(stub.name)
            val cw = org.objectweb.asm.ClassWriter(0)
            val access = if (stub.isInterface) {
                org.objectweb.asm.Opcodes.ACC_PUBLIC or
                        org.objectweb.asm.Opcodes.ACC_INTERFACE or
                        org.objectweb.asm.Opcodes.ACC_ABSTRACT
            } else {
                org.objectweb.asm.Opcodes.ACC_PUBLIC or org.objectweb.asm.Opcodes.ACC_SUPER
            }
            cw.visit(classVersion, access, internalName, null, "java/lang/Object", null)
            if (!stub.isInterface) {
                val mv = cw.visitMethod(org.objectweb.asm.Opcodes.ACC_PUBLIC, "<init>", "()V", null, null)
                mv.visitCode()
                mv.visitVarInsn(org.objectweb.asm.Opcodes.ALOAD, 0)
                mv.visitMethodInsn(org.objectweb.asm.Opcodes.INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false)
                mv.visitInsn(org.objectweb.asm.Opcodes.RETURN)
                mv.visitMaxs(1, 1)
                mv.visitEnd()
            }
            cw.visitEnd()
            val classFile = outDir.resolve("$internalName.class")
            classFile.parentFile.mkdirs()
            classFile.writeBytes(cw.toByteArray())
        }
    }
}

val teavmStubsJar by tasks.registering(Jar::class) {
    description = "Packages the stub bytecode into a JAR."
    group = LifecycleBasePlugin.BUILD_GROUP
    dependsOn(generateTeavmStubs)
    from(stubsClassesDir)
    archiveBaseName = "teavm-stubs"
    destinationDirectory = layout.buildDirectory.dir("generated/teavm-stubs")
}

dependencies {
    // Stubs jar must come first on the TeaVM classpath so our empty bytecode wins over any
    // transitive copy.
    implementation(files(teavmStubsJar.flatMap { it.archiveFile }))

    implementation("net.postchain.rell:rell-base:0.16.0-SNAPSHOT")

    compileOnly("org.teavm:teavm-jso:0.15.0-dev-2")
    compileOnly("org.teavm:teavm-core:0.15.0-dev-2")

    teavm("org.teavm:teavm-jso-apis:0.15.0-dev-2")
}

teavm {
    all {
        mainClass = "com.chromia.rellplayground.PlaygroundJsBridge"
        fastGlobalAnalysis = true
        preservedClasses.add("com.chromia.rellplayground.PlaygroundJsBridge")
    }
    wasmGC {
        optimization = OptimizationLevel.BALANCED
        outOfProcess = true
        processMemory = 8192
        obfuscated = true
        sourceMap = false
        targetFileName = "repro-1191.wasm"
    }
}
