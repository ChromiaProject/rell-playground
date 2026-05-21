/*
 * Copyright (C) 2026 ChromaWay AB. See LICENSE for license information.
 */

package com.chromia.rellplayground

import net.postchain.rell.base.compiler.base.utils.C_Message
import net.postchain.rell.base.compiler.base.utils.C_MessageType
import net.postchain.rell.base.repl.ReplOutputChannel
import net.postchain.rell.base.repl.ReplValueFormat
import net.postchain.rell.base.repl.ReplValueFormatter
import net.postchain.rell.base.runtime.Rt_Exception
import net.postchain.rell.base.runtime.Rt_Printer
import net.postchain.rell.base.runtime.Rt_Value

/**
 * Captures all output for a single [com.chromia.rellplayground.PlaygroundBridge]
 * call. Implements both [Rt_Printer] (for Rell `print` / `log`) and
 * [ReplOutputChannel] (for REPL value display + compiler messages).
 *
 * Events are JSON-encoded in-place to keep the cross-runtime payload minimal —
 * the SPA worker parses one string per call.
 */
class BufferedReplChannel : ReplOutputChannel {
    private var events = StringBuilder("[")
    private var first = true
    private var format = ReplValueFormat.DEFAULT

    /** Discard any captured events and start a fresh batch. */
    fun reset() {
        events = StringBuilder("[")
        first = true
    }

    val printer: Rt_Printer = object : Rt_Printer {
        override fun print(str: String) = appendEvent("stdout", "text" to str)
    }

    override fun printInfo(msg: String) = appendEvent("stdout", "text" to msg)

    override fun printCompilerError(code: String, msg: String) =
        appendEvent("compiler", "severity" to "error", "code" to code, "message" to msg)

    override fun printCompilerMessage(message: C_Message) {
        val severity = if (message.type == C_MessageType.ERROR) "error" else "warning"
        appendEvent(
            "compiler",
            "severity" to severity,
            "code" to message.code,
            "message" to message.text,
            "pos" to message.pos.strLine(),
        )
    }

    override fun printRuntimeError(e: Rt_Exception) {
        val stack = e.info.stack.joinToString("\n") { it.toString() }
        appendEvent("runtimeError", "message" to (e.message ?: "runtime error"), "stack" to stack)
    }

    override fun printPlatformRuntimeError(e: Throwable) {
        appendEvent(
            "runtimeError",
            "message" to "platform error: ${e.message ?: e::class.simpleName.orEmpty()}",
            "stack" to e.stackTraceToString(),
        )
    }

    override fun setValueFormat(format: ReplValueFormat) {
        this.format = format
    }

    override fun printValue(value: Rt_Value) {
        val text = ReplValueFormatter.format(value, format) ?: return
        appendEvent("value", "text" to text)
    }

    override fun printControl(code: String, msg: String) =
        appendEvent("control", "code" to code, "message" to msg)

    /**
     * Record one SQL statement that Rell handed to its [SqlExecutor]. Called
     * from [CapturingSqlExecutor] before the executor throws "no_sql" (since
     * we have no database). The SPA routes `sql` events to the SQL pane;
     * everything else falls through to the output panel.
     */
    fun appendSql(sql: String) = appendEvent("sql", "text" to sql)

    fun finish(ok: Boolean): String {
        events.append("]")
        return """{"ok":$ok,"events":$events}"""
    }

    private fun appendEvent(type: String, vararg fields: Pair<String, String>) {
        if (!first) events.append(',')
        first = false
        events.append("{\"type\":").append(jsonString(type))
        for ((k, v) in fields) {
            events.append(',').append(jsonString(k)).append(':').append(jsonString(v))
        }
        events.append('}')
    }

    private fun jsonString(s: String): String {
        val out = StringBuilder(s.length + 2)
        out.append('"')
        for (ch in s) {
            when (ch) {
                '\\' -> out.append("\\\\")
                '"' -> out.append("\\\"")
                '\n' -> out.append("\\n")
                '\r' -> out.append("\\r")
                '\t' -> out.append("\\t")
                '\b' -> out.append("\\b")
                else -> if (ch.code < 0x20) {
                    out.append("\\u").append(ch.code.toString(16).padStart(4, '0'))
                } else {
                    out.append(ch)
                }
            }
        }
        out.append('"')
        return out.toString()
    }
}
