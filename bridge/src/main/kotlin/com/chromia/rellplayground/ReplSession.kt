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
import net.postchain.rell.base.sql.NoConnSqlManager

/**
 * Holds a [ReplInterpreter] plus the [BufferedReplChannel] that captures
 * one command's worth of output. Database-less by construction:
 * [NoConnSqlManager] + [NullReplInterpreterProjExt].
 */
class ReplSession {
    private val channel = BufferedReplChannel()
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
            sqlMgr = NoConnSqlManager(),
            projExt = NullReplInterpreterProjExt,
            outChannel = channel,
            moduleArgsSource = Rt_ModuleArgsSource.NULL,
        )
        ReplInterpreter.create(config)
    }

    val ready: Boolean get() = interpreter != null

    /** Run one command; returns the JSON-encoded events captured for it. */
    fun execute(command: String): String {
        if (interpreter == null) {
            return BufferedReplChannel().apply {
                printCompilerError("repl:not_ready", "REPL failed to initialise")
            }.finish(ok = false)
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
