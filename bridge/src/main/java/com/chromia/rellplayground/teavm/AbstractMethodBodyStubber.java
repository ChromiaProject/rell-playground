/*
 * Copyright (C) 2026 ChromaWay AB. See LICENSE for license information.
 */

package com.chromia.rellplayground.teavm;

import java.util.Set;
import org.teavm.model.ClassHolder;
import org.teavm.model.ClassHolderTransformer;
import org.teavm.model.ClassHolderTransformerContext;
import org.teavm.model.ElementModifier;
import org.teavm.model.MethodHolder;
import org.teavm.model.Program;
import org.teavm.model.emit.ProgramEmitter;

/**
 * Works around a TeaVM 0.15 WasmGC codegen crash. {@code WasmGCMethodGenerator.createInstanceFunction}
 * / {@code generateMethodBody} guard against {@code STATIC} and {@code NATIVE} methods but not
 * {@code ABSTRACT} ones, so when an abstract method becomes a virtual-dispatch target the generator
 * calls {@code generateRegularMethodBody}, which does {@code Objects.requireNonNull(getProgram())}
 * and NPEs. TeaVM catches the NPE and emits an {@code unreachable} body (so the {@code .wasm} is
 * fine), but it also calls {@code diagnostics.error}, which fails the build.
 *
 * <p>Giving the offending abstract methods a real (throwing) body removes the null program, so no
 * exception fires. The bodies are dead: every concrete implementor of these interfaces overrides
 * them, so virtual dispatch never lands on the synthetic body. {@code throw} (rather than a silent
 * return) preserves TeaVM's trap semantics and surfaces a clear error if one is ever reached.
 *
 * <p>Scoped to the specific interfaces TeaVM trips on (extend {@link #DEABSTRACT_CLASSES} as new
 * ones surface) — de-abstracting the whole hierarchy would be wrong. The underlying bug should be
 * fixed upstream (konsoletyper/teavm — skip abstract methods in the WasmGC method generator).
 */
final class AbstractMethodBodyStubber implements ClassHolderTransformer {
    private static final Set<String> DEABSTRACT_CLASSES = Set.of(
        // Reached via Rell's INSERT path: TableImpl.field -> Tools.tableField -> Fields.field.
        "org.jooq.Fields");

    @Override
    public void transformClass(ClassHolder cls, ClassHolderTransformerContext context) {
        if (!DEABSTRACT_CLASSES.contains(cls.getName())) {
            return;
        }
        for (MethodHolder method : cls.getMethods()) {
            if (method.hasModifier(ElementModifier.ABSTRACT)
                    && !method.hasModifier(ElementModifier.NATIVE)
                    && method.getProgram() == null) {
                method.getModifiers().remove(ElementModifier.ABSTRACT);
                method.setProgram(buildThrowStub(method, context));
            }
        }
    }

    private static Program buildThrowStub(MethodHolder method, ClassHolderTransformerContext context) {
        var emitter = ProgramEmitter.create(method, context.getHierarchy());
        emitter.construct(UnsupportedOperationException.class,
                emitter.constant("not in TeaVM: " + method.getOwnerName() + "." + method.getName()))
                .raise();
        return emitter.getProgram();
    }
}
