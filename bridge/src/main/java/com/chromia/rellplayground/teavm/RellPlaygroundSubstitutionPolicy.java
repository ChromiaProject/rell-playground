package com.chromia.rellplayground.teavm;

import java.util.function.Predicate;
import org.teavm.extension.spi.substitution.SimpleSubstitutionPolicy;
import org.teavm.extension.spi.substitution.SubstitutionSink;

/**
 * Redirects the handful of non-{@code java.*} packages we ship empty stubs for to our
 * {@code org.teavm.classlib.<pkg>.T<Class>} overlay classes — the exact transformation
 * teavm-classlib applies to {@code java.*} (see {@code ClasslibSubstitutionPolicy}).
 *
 * <p>This replaces the {@code mapPackageHierarchy} / {@code stripPrefixFromPackageHierarchyClasses}
 * directives our stubs jar used to carry in {@code META-INF/teavm.properties}. TeaVM 0.15.0-dev-3
 * deleted the classpath property-renamer from teavm-core (konsoletyper/teavm#1191) and moved the
 * whole mechanism to this {@link org.teavm.extension.spi.substitution.SubstitutionPolicy} SPI, so
 * without this class every stubbed class surfaces as "was not found" at link time.
 *
 * <p>Registered via {@code META-INF/services/org.teavm.extension.spi.substitution.SubstitutionPolicy};
 * TeaVM loads it with a {@code ServiceLoader} over the program classpath, alongside
 * {@link RellPlaygroundPlugin}.
 */
public class RellPlaygroundSubstitutionPolicy extends SimpleSubstitutionPolicy {
    // Package roots whose `<root>.….<Class>` references resolve to our
    // `org.teavm.classlib.<root>.….T<Class>` stubs. `java.*` is owned by teavm-classlib.
    private static final String[] ROOTS = {
        "jakarta",
        "javax",
        "org.w3c",
        "org.xml",
        "org.glassfish",
        "com.beanit",
        "com.google",
        "io.r2dbc",
        "org.jooq",
        "org.reactivestreams",
        // SLF4J shim: only `org.teavm.classlib.org.slf4j.TLoggerFactory` exists, so LoggerFactory
        // resolves to our no-op (sidestepping SLF4J's provider-discovery static init); every other
        // org.slf4j.* class has no T-stub and falls back to the real slf4j-api type.
        "org.slf4j",
    };

    @Override
    public void contribute(SubstitutionSink sink) {
        Predicate<String> inAnyRoot = inPackage(ROOTS[0], true);
        for (int i = 1; i < ROOTS.length; i++) {
            inAnyRoot = inAnyRoot.or(inPackage(ROOTS[i], true));
        }
        sink.selectClasses(inAnyRoot)
                .packagePrefix("org.teavm.classlib.")
                .simpleNamePrefix("T");
    }
}
