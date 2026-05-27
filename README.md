# Reproducer for konsoletyper/teavm#1191

Minimal reproducer for a `NullPointerException` raised by TeaVM `0.15.0-dev-2` when
compiling a WasmGC target whose reachable code touches `net.postchain.rell:rell-base`'s
`Rt_RellVersion`.

## Stack trace

```
Caused by: java.lang.NullPointerException
    at org.teavm.backend.wasm.intrinsics.reflection.ReflectionMetadataGenerator.generate(ReflectionMetadataGenerator.java:138)
    at org.teavm.backend.wasm.intrinsics.WasmGCIntrinsics.fillReflection(WasmGCIntrinsics.java:119)
    at org.teavm.backend.wasm.intrinsics.WasmGCIntrinsics.apply(WasmGCIntrinsics.java:98)
    at org.teavm.backend.wasm.WasmGCTarget.emit(WasmGCTarget.java:322)
    at org.teavm.vm.TeaVM.build(TeaVM.java:473)
```

## Reading line 138

```java
// org/teavm/backend/wasm/intrinsics/reflection/ReflectionMetadataGenerator.java
public void generate() {
    var annotationsByClass = collectAnnotations();          // can return null (line 124)
    ...
    for (var className : classes.getClassNames()) {
        var annotations = annotationsByClass.get(className);   // <-- line 138, NPE here
        ...
    }
}

private Map<String, List<AnnotationReader>> collectAnnotations() {
    ...
    for (var type : methodDep.getVariable(0).getClassValueNode().getTypes()) {
        ...
        var className = ((ValueType.Object) type).getClassName();
        var cls = classes.get(className);
        if (cls == null) {
            return null;                                    // <-- triggered here
        }
        ...
    }
    return result;
}
```

The dependency analyser surfaces a class as a potential receiver of
`Class.getDeclaredAnnotations()`, but that class is missing from `classes`, so
`collectAnnotations()` returns `null` — and `generate()` dereferences it one line later.

## Failing config

```kotlin
teavm {
    all { fastGlobalAnalysis = true }
    wasmGC { optimization = OptimizationLevel.BALANCED }
}
```

The NPE is invariant across `optimization ∈ {NONE, BALANCED, AGGRESSIVE}` × `fastGlobalAnalysis ∈ {false, true}` — this repro pins `BALANCED + fast=true` as one representative cell.

## Reproduce

### With Docker

```sh
docker build -t repro-1191 .
docker run --rm repro-1191
```

Last lines of output:

```
> Task :generateWasmGC FAILED
...
Caused by: java.lang.NullPointerException
    at org.teavm.backend.wasm.intrinsics.reflection.ReflectionMetadataGenerator.generate(ReflectionMetadataGenerator.java:138)
```

### Without Docker

Requires JDK 21 and network access to Maven Central, `teavm.org/maven/repository`, and
ChromaWay's public GitLab Maven repositories (for `rell-api-base`).

```sh
./gradlew :generateWasmGC
```

## What's in this repro

```
src/main/kotlin/com/chromia/rellplayground/PlaygroundJsBridge.kt
  // 10-line bridge that exports `version()` via @JSExport. version() calls
  // `Rt_RellVersion.getInstance().buildDescriptor` — that's the only reach into rell-base.

src/main/java/com/chromia/rellplayground/teavm/MissingMethodInjector.java
  // ClassHolderTransformer that grafts a handful of method bodies onto:
  //  - TeaVM-classlib's TClass / TClassLoader / TMethod (JDK 17+ reflection additions)
  //  - the five java.util.concurrent.* stub classes shipped from the build script
  //  - Rt_RellVersion$Companion.getBuildProperties() (replaces the body with `return null`
  //    so it doesn't drag Class.getResource + Properties.load into reachability analysis)

src/main/java/com/chromia/rellplayground/teavm/RellPlaygroundPlugin.java
  // Registers MissingMethodInjector via TeaVM's SPI plugin mechanism.

src/main/resources/META-INF/services/org.teavm.vm.spi.TeaVMPlugin
  // SPI registration for RellPlaygroundPlugin.

build.gradle.kts
  // Emits empty stub bytecode for 5 java.util.concurrent.* classes TeaVM-classlib omits.
  // Configures the WasmGC backend at BALANCED + fast=true. Excludes JVM-only deps that
  // rell-api-base would transitively pull in.

settings.gradle.kts
  // Maven repo declarations for teavm.org, ChromaWay's GitLab repos.
```

Total: ~430 lines of source + the Gradle wrapper.

## Bisection notes (what's required, what isn't)

Removing any of the following makes the NPE disappear:

| Removed                                                            | Build outcome                        |
| ------------------------------------------------------------------ | ------------------------------------ |
| `rell-api-base` dependency                                         | succeeds, emits valid .wasm          |
| `PlaygroundJsBridge.version()` (or replace body with `"x"`)        | succeeds                             |
| `MissingMethodInjector` (drop SPI registration)                    | 48 missing-method diagnostics; halts before NPE site |
| Any of the 5 stubs                                                 | missing-class diagnostics; halts before NPE site |

So the trigger is: TeaVM 0.15.0-dev-2 + WasmGC backend + any reachable call into rell-base
that survives dependency analysis enough to invoke the reflection-metadata generator.

## Sibling issue

The JS-backend symmetric NPE is tracked in #1189
(`ClassInfoGenerator.writeSimpleConstructors:241`), also still reproducing on
`0.15.0-dev-2` at BALANCED / AGGRESSIVE.
