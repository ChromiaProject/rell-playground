/*
 * Copyright (C) 2026 ChromaWay AB. See LICENSE for license information.
 */

package com.chromia.rellplayground

import net.postchain.rell.api.base.RellApiBaseUtils
import net.postchain.rell.base.compiler.base.core.C_CompilerOptions
import net.postchain.rell.base.compiler.base.utils.C_SourceDir
import net.postchain.rell.base.repl.NullReplInterpreterProjExt
import net.postchain.rell.base.repl.ReplInterpreter
import net.postchain.rell.base.repl.ReplInterpreterConfig
import net.postchain.rell.base.runtime.Rt_ModuleArgsSource

/**
 * Holds a [ReplInterpreter] plus the [BufferedReplChannel] that captures
 * one command's worth of output. Database-less by construction:
 * [NoConnSqlManager] + [NullReplInterpreterProjExt].
 */
class ReplSession {
    private val channel = BufferedReplChannel()

    /**
     * Result of [ReplInterpreter.create] plus the events the create-probe captured. The probe
     * runs `executeCode("", true)` to confirm the engine is usable; on the TeaVM build, that
     * probe trips lazy static-init of jOOQ / Jackson / kotlin-reflect the first time a
     * brand-new JVM-in-JS instance touches them, so it fails non-deterministically once per
     * worker, then never again. We retry the probe up to three times before giving up — and
     * if every attempt fails, we preserve the events from the *last* attempt so
     * [execute] can replay them instead of swallowing them behind an opaque
     * "REPL failed to initialise" error.
     */
    private val interpreter: ReplInterpreter? = run {
        val compilerOptions = C_CompilerOptions.DEFAULT
        val globalCtx = RellApiBaseUtils.createGlobalContext(
            compilerOptions,
            typeCheck = false,
            outPrinter = channel.printer,
            logPrinter = channel.printer,
        )
        val config = ReplInterpreterConfig(
            compilerOptions = compilerOptions,
            sourceDir = C_SourceDir.EMPTY,
            module = null,
            rtGlobalCtx = globalCtx,
            // CapturingSqlManager records every SQL string Rell hands to its
            // executor before the executor throws "no_sql". Browser mode has
            // no Postgres so DB-touching code still fails at runtime — but the
            // jOOQ-generated SQL surfaces in the SPA's SQL pane.
            sqlMgr = CapturingSqlManager(channel),
            projExt = NullReplInterpreterProjExt,
            outChannel = channel,
            moduleArgsSource = Rt_ModuleArgsSource.NULL,
        )
        var result: ReplInterpreter? = null
        repeat(3) {
            channel.reset()
            result = ReplInterpreter.create(config)
            if (result != null) return@run result
        }
        result // null — channel still holds the last attempt's events
    }

    val ready: Boolean get() = interpreter != null

    /** Run one command; returns the JSON-encoded events captured for it. */
    fun execute(command: String): String {
        if (interpreter == null) {
            // Replay the events captured during the failed init probe so the caller sees the
            // real underlying exception (or compiler error), not just "repl:not_ready".
            channel.printCompilerError("repl:not_ready", "REPL failed to initialise")
            return channel.finish(ok = false)
        }
        channel.reset()
        return try {
            interpreter.execute(command)
            channel.finish(ok = true)
        } catch (e: Throwable) {
            channel.printPlatformRuntimeError(e)
            channel.finish(ok = false)
        }
    }

    fun mustQuit(): Boolean = interpreter?.mustQuit() == true
}
