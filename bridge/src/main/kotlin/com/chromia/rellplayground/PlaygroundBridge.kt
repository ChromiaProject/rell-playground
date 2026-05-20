/*
 * Copyright (C) 2026 ChromaWay AB. See LICENSE for license information.
 */

package com.chromia.rellplayground

import net.postchain.rell.base.runtime.Rt_RellVersion

/**
 * JVM-side surface that the SPA worker calls into via CheerpJ's Java↔JS bridge.
 * Every method returns a JSON-encoded string so the cross-runtime payload is
 * simple to parse on the SPA side.
 *
 * State (session map, id counter) lives on the JVM heap inside this object —
 * the worker holds an `await lib.com.chromia.rellplayground.PlaygroundBridge`
 * reference and calls these instance methods repeatedly.
 *
 * Result envelope:
 *   `{"ok": boolean, "events": [ { "type": "stdout"|"value"|"compiler"|... , ... }, ... ]}`
 * One-file mode discards the session after `runFile`. REPL mode keeps it
 * around between `replExecute` calls.
 */
@Suppress("unused")
object PlaygroundBridge {
    private val sessions = HashMap<Int, ReplSession>()
    private var nextId = 1

    @JvmStatic
    fun version(): String {
        return Rt_RellVersion.getInstance()?.buildDescriptor ?: "rell (unknown version)"
    }

    /** One-file mode: fresh session, executes whole source as one REPL command, dropped after. */
    @JvmStatic
    fun runFile(code: String): String {
        val session = ReplSession()
        return session.execute(code)
    }

    /** Returns a session id, or `-1` if the REPL failed to initialise. */
    @JvmStatic
    fun replCreate(): Int {
        val session = ReplSession()
        if (!session.ready) return -1
        val id = nextId++
        sessions[id] = session
        return id
    }

    /** Run a REPL command. JSON-encoded result; SPA decides how to render each event. */
    @JvmStatic
    fun replExecute(sessionId: Int, command: String): String {
        val session = sessions[sessionId]
            ?: return """{"ok":false,"events":[{"type":"runtimeError","message":"invalid REPL session: $sessionId"}]}"""
        val result = session.execute(command)
        if (session.mustQuit()) sessions.remove(sessionId)
        return result
    }

    @JvmStatic
    fun replDispose(sessionId: Int) {
        sessions.remove(sessionId)
    }
}
