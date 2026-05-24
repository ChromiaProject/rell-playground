/*
 * Copyright (C) 2026 ChromaWay AB. See LICENSE for license information.
 */

package org.teavm.classlib.org.slf4j;

import org.slf4j.ILoggerFactory;
import org.slf4j.Logger;

/**
 * No-op ILoggerFactory returning the singleton TNoOpLogger for every name.
 * Class name carries the `T` prefix expected by teavm-classlib's
 * `stripPrefixFromPackageHierarchyClasses` rule — the renamer blindly strips the first char
 * of every class in this package, so unprefixed names get mangled.
 */
final class TNoOpLoggerFactory implements ILoggerFactory {
    @Override
    public Logger getLogger(String name) {
        return TNoOpLogger.INSTANCE;
    }
}
