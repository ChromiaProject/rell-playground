/*
 * Copyright (C) 2026 ChromaWay AB. See LICENSE for license information.
 */

package org.teavm.classlib.org.slf4j;

import org.slf4j.Logger;
import org.slf4j.Marker;
import org.slf4j.event.Level;
import org.slf4j.helpers.AbstractLogger;

/**
 * Drop-on-the-floor Logger. The `T` prefix matches teavm-classlib's
 * `stripPrefixFromPackageHierarchyClasses` directive; after rename this becomes
 * `org.slf4j.NoOpLogger`, distinct from SLF4J's own `org.slf4j.helpers.NOPLogger`.
 */
final class TNoOpLogger extends AbstractLogger {
    static final TNoOpLogger INSTANCE = new TNoOpLogger();

    private TNoOpLogger() {
        this.name = "rell-playground";
    }

    @Override
    protected String getFullyQualifiedCallerName() {
        return TNoOpLogger.class.getName();
    }

    @Override
    protected void handleNormalizedLoggingCall(Level level, Marker marker, String msg,
                                               Object[] arguments, Throwable throwable) {
        // No-op.
    }

    @Override public boolean isTraceEnabled() { return false; }
    @Override public boolean isTraceEnabled(Marker m) { return false; }
    @Override public boolean isDebugEnabled() { return false; }
    @Override public boolean isDebugEnabled(Marker m) { return false; }
    @Override public boolean isInfoEnabled() { return false; }
    @Override public boolean isInfoEnabled(Marker m) { return false; }
    @Override public boolean isWarnEnabled() { return false; }
    @Override public boolean isWarnEnabled(Marker m) { return false; }
    @Override public boolean isErrorEnabled() { return false; }
    @Override public boolean isErrorEnabled(Marker m) { return false; }
}
