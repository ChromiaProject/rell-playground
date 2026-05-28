/*
 * Copyright (C) 2026 ChromaWay AB. See LICENSE for license information.
 */

package com.chromia.rellplayground.teavm;

import org.teavm.model.ClassHolder;
import org.teavm.model.ClassHolderTransformer;
import org.teavm.model.ClassHolderTransformerContext;
import org.teavm.model.GenericTypeParameter;

/**
 * Works around a second null-handling bug in TeaVM 0.15's WasmGC reflection metadata generator.
 * {@code ClassReader.getGenericParameters()} returns {@code null} for any class without a generic
 * signature, but {@code ReflectionMetadataGenerator.generateClassMetadata} forwards that null
 * straight into {@code generateTypeParameters}, which does {@code for (var p : params)} and NPEs —
 * for any class that has annotations / reflectable members / inner classes (so it isn't skipped)
 * yet no type variables.
 *
 * <p>Normalising the model so every class reports an empty array instead of null sidesteps it.
 * Like the rest of this package this is a TeaVM workaround that should be fixed upstream
 * (konsoletyper/teavm — the generator should treat null as "no type parameters").
 */
final class GenericParametersNormalizer implements ClassHolderTransformer {
    private static final GenericTypeParameter[] EMPTY = new GenericTypeParameter[0];

    @Override
    public void transformClass(ClassHolder cls, ClassHolderTransformerContext context) {
        if (cls.getGenericParameters() == null) {
            cls.setGenericParameters(EMPTY);
        }
    }
}
