/*
 * Copyright (C) 2026 ChromaWay AB. See LICENSE for license information.
 */

package com.chromia.rellplayground.teavm;

import org.teavm.vm.spi.TeaVMHost;
import org.teavm.vm.spi.TeaVMPlugin;

/**
 * TeaVM plugin that injects empty stub bodies for ~80 JDK methods referenced — but never
 * actually called at runtime — through reflection-heavy library static initialisers (jOOQ,
 * jackson, kotlin-reflect, SLF4J). TeaVM's classlib doesn't ship these methods on TClass /
 * TClassLoader / TMethodHandles / reflect.*; without a body, dependency analysis aborts.
 *
 * The injected bodies all `throw new UnsupportedOperationException("not in TeaVM")` — if any
 * of these is actually reached at runtime it surfaces a clear error rather than the silent
 * "Class not found" emitted by the dependency analyser, but in practice none should fire:
 * CapturingSqlExecutor short-circuits the JDBC path, kotlin-logging never resolves an SLF4J
 * binding so LoggerFactory never finishes init, and the Rell REPL doesn't invoke `json`
 * stdlib calls (which is the only path into Jackson's ObjectMapper init).
 *
 * Registered via META-INF/services/org.teavm.vm.spi.TeaVMPlugin.
 */
public final class RellPlaygroundPlugin implements TeaVMPlugin {
    @Override
    public void install(TeaVMHost host) {
        host.add(new MissingMethodInjector());
        host.add(new GenericParametersNormalizer());
        host.add(new AbstractMethodBodyStubber());
        host.add(new ReflectionTargetPreserver());
    }
}
