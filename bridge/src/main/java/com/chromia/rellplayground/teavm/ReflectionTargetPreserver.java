/*
 * Copyright (C) 2026 ChromaWay AB. See LICENSE for license information.
 */

package com.chromia.rellplayground.teavm;

import java.util.HashSet;
import java.util.Set;
import org.teavm.dependency.AbstractDependencyListener;
import org.teavm.dependency.DependencyAgent;
import org.teavm.dependency.DependencyNode;
import org.teavm.dependency.MethodDependency;
import org.teavm.model.MethodReference;
import org.teavm.model.ValueType;

/**
 * Works around a TeaVM 0.15 reflection-emit crash. When {@code Class.newInstance},
 * {@code Class.getDeclaredAnnotations} or {@code Class.getDeclaredClasses} is reachable, the
 * dependency analyser records every class that flows into them as a reflection target — including
 * the inner classes ({@code $DefaultImpls}, {@code $WhenMappings}, …) of every reachable class.
 * Many of those targets are never otherwise reached, so {@code TeaVM.link()} (which copies only
 * {@code getReachableClasses()} into the emit source) drops them. The JS {@code ClassInfoGenerator}
 * and the WasmGC {@code ReflectionMetadataGenerator} then iterate the same target set and
 * dereference each one's now-null {@code ClassReader}, NPEing the whole emit phase with no hint of
 * which class is to blame.
 *
 * <p>The fix pulls every reflection target that has bytecode back into the reachable set, so it
 * survives into {@code cutClasses} and the emit phase finds a non-null {@code ClassReader}. Linking
 * is only legal while the analyser is propagating (not in {@code completing}), so we attach a
 * consumer to each sink's class-value node in {@link #methodReached} and link targets as they
 * arrive. The set converges because the targets are overwhelmingly leaf inner classes.
 *
 * <p>Installed by {@link RellPlaygroundPlugin}. The TeaVM bug should also be reported upstream
 * (konsoletyper/teavm) — the generators ought to null-check or skip pruned targets.
 */
public final class ReflectionTargetPreserver extends AbstractDependencyListener {
    private static final Set<MethodReference> REFLECTIVE_SINKS = Set.of(
        new MethodReference(Class.class, "newInstance", Object.class),
        new MethodReference(Class.class, "getDeclaredAnnotations", java.lang.annotation.Annotation[].class),
        new MethodReference(Class.class, "getDeclaredClasses", Class[].class));

    private final Set<String> linked = new HashSet<>();

    @Override
    public void methodReached(DependencyAgent agent, MethodDependency method) {
        if (!REFLECTIVE_SINKS.contains(method.getReference())) {
            return;
        }
        DependencyNode classValues = method.getVariable(0).getClassValueNode();
        classValues.addConsumer(type -> {
            ValueType valueType = type.getValueType();
            if (!(valueType instanceof ValueType.Object)) {
                return;
            }
            var className = ((ValueType.Object) valueType).getClassName();
            // Only pull in targets that actually have bytecode; `linked` keeps this idempotent so
            // repeated propagation doesn't re-link and the analysis still converges.
            if (linked.add(className) && agent.getClassSource().get(className) != null) {
                agent.linkClass(className).initClass(null);
            }
        });
    }
}
