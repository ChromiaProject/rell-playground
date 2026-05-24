/*
 * Copyright (C) 2026 ChromaWay AB. See LICENSE for license information.
 */

@file:JvmName("PlaygroundJsBridge")

package com.chromia.rellplayground

import org.teavm.jso.JSExport

// TeaVM JS entry points. Each top-level function below compiles to a `public static` method
// on the file class `com.chromia.rellplayground.PlaygroundJsBridge`, and `@JSExport` carries
// it across the JVM/JS boundary as a named ESM export. The SPA worker imports the resulting
// module and calls these directly — no Java↔JS bridge ceremony, no instance handle.
//
// `@JSExport` on Kotlin `object`-member methods (even with `@JvmStatic`) is not picked up by
// TeaVM's annotation scan; the export plumbing only sees free functions / file-class static
// methods. Hence the surface lives here and just forwards to the JVM-side [PlaygroundBridge].

@JSExport
fun version(): String = PlaygroundBridge.version()

@JSExport
fun runFile(code: String): String = PlaygroundBridge.runFile(code)

@JSExport
fun runModule(code: String): String = PlaygroundBridge.runModule(code)

@JSExport
fun replCreate(): Int = PlaygroundBridge.replCreate()

@JSExport
fun replExecute(sessionId: Int, command: String): String =
    PlaygroundBridge.replExecute(sessionId, command)

@JSExport
fun replDispose(sessionId: Int) {
    PlaygroundBridge.replDispose(sessionId)
}

/**
 * TeaVM compilation root. No-op: every `@JSExport` function above is its own additional root
 * in the reachability analyser, so the JS module exposes them directly. `main` is never
 * called from JS.
 */
fun main() {}
