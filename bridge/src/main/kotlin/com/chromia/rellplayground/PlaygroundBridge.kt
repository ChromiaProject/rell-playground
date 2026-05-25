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
        return Rt_RellVersion.getInstance().buildDescriptor
    }

    /**
     * Plain one-file mode: run the whole source as a single REPL command in a
     * fresh, throwaway session. Good for pure functions, `print`, expression
     * evaluation, struct/enum defs — anything that doesn't need a database.
     * Entity / query / operation declarations are rejected here (REPL limit);
     * use [runModule] for those.
     */
    @JvmStatic
    fun runFile(code: String): String {
        return ReplSession().execute(code)
    }

    /**
     * SQL dry-run mode: treat the user's source as Rell module `main` (root),
     * load it (DDL flows through [CapturingSqlManager] → SQL pane), and invoke
     * `query main()` if defined. Modules can declare entities/queries/etc.
     * The browser has no Postgres so execution still fails with "no_sql", but
     * the SQL postchain *would* issue is surfaced to the SQL pane.
     */
    @JvmStatic
    fun runModule(code: String): String {
        return ModuleSession(code).runMain()
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
