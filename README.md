# Reproducer for konsoletyper/teavm#1191

## Reproduce

```sh
# With Docker:
docker build -t repro-1191 . && docker run --rm repro-1191

# Without Docker (JDK 21 + network: Maven Central, teavm.org, ChromaWay GitLab):
./gradlew :generateWasmGC
```

## Output

```
> Task :generateWasmGC FAILED
Caused by: java.lang.NullPointerException
    at org.teavm.backend.wasm.intrinsics.reflection.ReflectionMetadataGenerator.generate(ReflectionMetadataGenerator.java:138)
    at org.teavm.backend.wasm.intrinsics.WasmGCIntrinsics.fillReflection(WasmGCIntrinsics.java:119)
    at org.teavm.backend.wasm.intrinsics.WasmGCIntrinsics.apply(WasmGCIntrinsics.java:98)
    at org.teavm.backend.wasm.WasmGCTarget.emit(WasmGCTarget.java:322)
```

## Notes

- TeaVM `0.15.0-dev-2`, WasmGC, BALANCED × `fastGlobalAnalysis=true`. NPE invariant across `{NONE, BALANCED, AGGRESSIVE}` × `fast ∈ {false, true}`.
- Line 138 is `annotationsByClass.get(className)`; the real null is `annotationsByClass` itself — returned by `collectAnnotations()` when `classes.get(className)` misses for a class reachable via `Class.getDeclaredAnnotations`'s dep graph.
- JS-backend sibling at `ClassInfoGenerator.writeSimpleConstructors:241` is #1189 — also still reproducing on dev-2.
