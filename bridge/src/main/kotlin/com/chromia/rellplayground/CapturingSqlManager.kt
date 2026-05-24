/*
 * Copyright (C) 2026 ChromaWay AB. See LICENSE for license information.
 */

package com.chromia.rellplayground

import net.postchain.rell.base.runtime.Rt_Exception
import net.postchain.rell.base.sql.AbstractSqlManager
import net.postchain.rell.base.sql.ResultSetRow
import net.postchain.rell.base.sql.SqlExecutor
import net.postchain.rell.base.sql.SqlPreparator
import java.sql.Connection

/**
 * A "dry-run" [SqlManager]: records every SQL string Rell hands the executor
 * into [channel] (rendered in the SPA's SQL pane) and then lets execution
 * *continue* against an empty result set, instead of failing like
 * [net.postchain.rell.base.sql.NoConnSqlManager].
 *
 * Why capture-and-continue rather than capture-and-throw: a single Rell
 * routine often issues several statements (e.g. an `operation` doing
 * create/update/delete plus a read). Throwing on the first one would surface
 * only that one. By returning empty results we capture the *whole* CRUD
 * sequence in one run, and the routine completes without a spurious
 * "No database connection" error cluttering the output pane.
 *
 * Caveat: queries assuming rows exist (e.g. `entity @ {…}` cardinality-one)
 * will hit a normal Rell "no records" error — that's a real diagnostic, not
 * noise, so we let it through. The raw-`Connection` path (helpers that build
 * their own statements) can't be faked, so it still throws.
 */
class CapturingSqlManager(private val channel: BufferedReplChannel) : AbstractSqlManager() {
    override val hasConnection = false

    override fun <T> execute0(tx: Boolean, code: (SqlExecutor) -> T): T {
        return code(CapturingSqlExecutor(channel))
    }
}

private class CapturingSqlExecutor(private val channel: BufferedReplChannel) : SqlExecutor() {
    override fun hasRealConnection() = false

    override fun <T> connection(code: (Connection) -> T): T {
        // No SQL string at this entry point and no way to fake a JDBC
        // Connection — refuse like NoConnSqlExecutor does.
        throw Rt_Exception.common("no_sql", "No database connection")
    }

    override fun execute(sql: String) {
        channel.appendSql(sql)
    }

    override fun execute(sql: String, preparator: SqlPreparator) {
        channel.appendSql(sql)
    }

    override fun executeQuery(sql: String, preparator: SqlPreparator, consumer: (ResultSetRow) -> Unit) {
        channel.appendSql(sql)
        // Empty result set: invoke the consumer zero times.
    }
}

