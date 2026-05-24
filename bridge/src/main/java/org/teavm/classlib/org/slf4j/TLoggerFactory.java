/*
 * Copyright (C) 2026 ChromaWay AB. See LICENSE for license information.
 */

package org.teavm.classlib.org.slf4j;

import org.slf4j.ILoggerFactory;
import org.slf4j.Logger;

/**
 * Replacement for `org.slf4j.LoggerFactory` on the TeaVM build. The real LoggerFactory's
 * static init scans the classpath for a ServiceLoader-discovered SLF4J binding; that scan
 * needs `ClassLoader.getResources` (not in TeaVM's classlib), `LinkedBlockingQueue`, and
 * a heap of reflective helpers we'd otherwise have to stub three times deep. Once the
 * scan fails, every subsequent `LoggerFactory.getLogger(...)` throws IllegalStateException
 * — which surfaces in the Rell REPL the first time any rell-base `companion object:
 * KLogging()` resolves its logger.
 *
 * teavm-classlib's existing T-prefix renamer rewrites this class to `org.slf4j.LoggerFactory`
 * (see `mapPackageHierarchy|org.teavm.classlib.org.slf4j=org.slf4j` in our
 * `META-INF/teavm.properties`), so SLF4J's real implementation never makes it into the
 * generated JS. `getLogger` returns the same no-op {@link TNoOpLogger} singleton regardless
 * of name — the playground discards all log output anyway.
 */
public final class TLoggerFactory {

    private static final TNoOpLoggerFactory FACTORY = new TNoOpLoggerFactory();

    private TLoggerFactory() {
    }

    public static Logger getLogger(String name) {
        return FACTORY.getLogger(name);
    }

    public static Logger getLogger(Class<?> cls) {
        return FACTORY.getLogger(cls == null ? "?" : cls.getName());
    }

    public static ILoggerFactory getILoggerFactory() {
        return FACTORY;
    }

    public static org.slf4j.spi.SLF4JServiceProvider getProvider() {
        // kotlin-logging 3.x reaches into getProvider() through a couple of paths; returning
        // null is enough — kotlin-logging falls back to its own KLoggerJava implementation
        // which calls back into our `getLogger` above, where the cycle terminates.
        return null;
    }
}
