/*
 * Copyright (C) 2026 ChromaWay AB. See LICENSE for license information.
 */

package com.chromia.rellplayground

import net.postchain.rell.api.base.RellApiBaseUtils
import net.postchain.rell.base.compiler.base.core.C_CompilerOptions
import net.postchain.rell.base.compiler.base.utils.C_SourceDir
import net.postchain.rell.base.model.ModuleName
import net.postchain.rell.base.repl.NullReplInterpreterProjExt
import net.postchain.rell.base.repl.ReplInterpreter
import net.postchain.rell.base.repl.ReplInterpreterConfig
import net.postchain.rell.base.runtime.Rt_ModuleArgsSource

/**
 * Treats the user's source as a single-file Rell module named `main` and
 * tries to invoke a top-level `query main()` against it. Entities,
 * operations, queries, etc. are legal here (REPL mode rejects them).
 *
 * Wiring through [ReplInterpreter] keeps three guarantees we already rely on
 * elsewhere in the bridge:
 *   * DDL emission via the REPL's `sqlUpdate` hook → captured by
 *     [CapturingSqlManager] as `sql` events before the no-conn throw.
 *   * Output funneled through [BufferedReplChannel] (so `print(...)`,
 *     compiler messages, runtime exceptions all reach the SPA in the same
 *     JSON envelope shape as REPL mode).
 *   * No code path through any DB-touching helper that doesn't live in the
 *     existing REPL infrastructure.
 */
class ModuleSession(userCode: String) {
    private val channel = BufferedReplChannel()
    private val sourceDir: C_SourceDir = C_SourceDir.mapDirOf(mapOf(MAIN_FILE to userCode))
    // `main.rell` at the source-dir root maps to the EMPTY/root module,
    // *not* a module literally named "main". (Path-to-module follows the
    // dir layout: foo/bar.rell -> module foo.bar, main.rell -> root.)
    private val mainModule: ModuleName = ModuleName.EMPTY

    // Retry the create-probe up to three times before giving up: the first JVM-in-JS touch of
    // jOOQ / Jackson / kotlin-reflect lazy-init can throw once and then never again. See
    // [ReplSession] for the same workaround on REPL mode.
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
            sourceDir = sourceDir,
            module = mainModule,
            rtGlobalCtx = globalCtx,
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
        result
    }

    /**
     * Run `query main()` if it exists; otherwise just surface whatever DDL
     * + compile messages the module-load already produced (so the SQL pane
     * still gets the `CREATE TABLE …` lines for entity declarations).
     */
    fun runMain(): String {
        if (interpreter == null) {
            channel.printCompilerError("module:not_ready", "Module 'main' failed to compile (see messages above)")
            return channel.finish(ok = false)
        }
        return try {
            // The interpreter has already loaded `main` (its constructor ran
            // executeCode("", forceSqlUpdate = true) which emits DDL). If the
            // user wrote a top-level `main()` query, invoke it; otherwise
            // skip — DDL alone is a legitimate output.
            interpreter.execute("main();")
            channel.finish(ok = true)
        } catch (e: Throwable) {
            channel.printPlatformRuntimeError(e)
            channel.finish(ok = false)
        }
    }

    companion object {
        private const val MAIN_FILE = "main.rell"
    }
}
