/*
 * Copyright (C) 2026 ChromaWay AB. See LICENSE for license information.
 */

package com.chromia.rellplayground.teavm;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.teavm.model.AccessLevel;
import org.teavm.model.ClassHolder;
import org.teavm.model.ClassHolderTransformer;
import org.teavm.model.ClassHolderTransformerContext;
import org.teavm.model.ElementModifier;
import org.teavm.model.MethodDescriptor;
import org.teavm.model.MethodHolder;
import org.teavm.model.ValueType;
import org.teavm.model.emit.ProgramEmitter;

/**
 * Minimal reproducer plumbing:
 *   1. Stubs method bodies on the seven Atomic / Lock classes we ship as empty stubs
 *      (TeaVM-classlib omits them; Rt_RellVersion's lazy-init touches them).
 *   2. Replaces the body of {@code Rt_RellVersion$Companion.getBuildProperties()} with
 *      {@code return null} so it doesn't pull in {@code Class.getResource} / {@code Properties.load}
 *      (neither of which is implemented in TeaVM's classlib).
 *
 * With these two pieces in place, TeaVM's dependency analyser converges and emits the WasmGC
 * target — and that's when the NPE at {@code ReflectionMetadataGenerator.generate:138} fires.
 */
final class MissingMethodInjector implements ClassHolderTransformer {

    private static final Map<String, List<String>> MISSING_METHODS = new HashMap<>();
    private static final java.util.Set<String> REPLACE_BODY_METHODS = new java.util.HashSet<>();

    private static void addMethods(String className, List<String> methods) {
        MISSING_METHODS.merge(className, methods, (a, b) -> {
            var combined = new java.util.ArrayList<String>(a.size() + b.size());
            combined.addAll(a);
            combined.addAll(b);
            return combined;
        });
    }

    private static void addReplaceBodyMethods(String className, List<String> methods) {
        for (var m : methods) REPLACE_BODY_METHODS.add(className + "#" + m);
    }

    static {
        // JDK 17+ reflection methods missing from TeaVM-classlib's TClass / TClassLoader / TMethod.
        addMethods("java.lang.Class", List.of(
                "getEnclosingConstructor()Ljava/lang/reflect/Constructor;",
                "getEnclosingMethod()Ljava/lang/reflect/Method;",
                "getGenericInterfaces()[Ljava/lang/reflect/Type;",
                "getGenericSuperclass()Ljava/lang/reflect/Type;",
                "isAnonymousClass()Z"
        ));
        addMethods("java.lang.ClassLoader", List.of(
                "getResource(Ljava/lang/String;)Ljava/net/URL;",
                "loadClass(Ljava/lang/String;)Ljava/lang/Class;"
        ));
        addMethods("java.lang.reflect.Method", List.of(
                "getDefaultValue()Ljava/lang/Object;"
        ));
        addMethods("java.util.concurrent.atomic.AtomicIntegerArray", List.of(
                "<init>(I)V",
                "get(I)I",
                "length()I",
                "set(II)V"
        ));
        addMethods("java.util.concurrent.atomic.AtomicLongArray", List.of(
                "<init>(I)V",
                "get(I)J",
                "lazySet(IJ)V",
                "length()I",
                "set(IJ)V"
        ));
        addMethods("java.util.concurrent.atomic.AtomicReferenceArray", List.of(
                "<init>(I)V",
                "get(I)Ljava/lang/Object;",
                "getAndSet(ILjava/lang/Object;)Ljava/lang/Object;",
                "lazySet(ILjava/lang/Object;)V",
                "length()I",
                "set(ILjava/lang/Object;)V"
        ));
        addMethods("java.util.concurrent.locks.Lock", List.of(
                "lock()V",
                "tryLock()Z",
                "tryLock(JLjava/util/concurrent/TimeUnit;)Z",
                "unlock()V"
        ));
        addMethods("java.util.concurrent.locks.ReentrantLock", List.of(
                "lock()V",
                "tryLock()Z",
                "unlock()V"
        ));

        // Critical: Rt_RellVersion.getBuildProperties() walks Class.getResource + Properties.load,
        // neither of which TeaVM-classlib implements. Replacing the body with `return null` kicks
        // its caller into a fallback path and stops the dependency analyser from chasing JVM-only
        // resource-loading code.
        addReplaceBodyMethods("net.postchain.rell.base.runtime.Rt_RellVersion$Companion", List.of(
                "getBuildProperties()Ljava/util/Map;"
        ));
    }

    @Override
    public void transformClass(ClassHolder cls, ClassHolderTransformerContext context) {
        var isInterface = cls.hasModifier(ElementModifier.INTERFACE);

        var methodEntries = MISSING_METHODS.get(cls.getName());
        if (methodEntries != null) {
            for (var entry : methodEntries) {
                var sigStart = entry.indexOf('(');
                var name = entry.substring(0, sigStart);
                var desc = MethodDescriptor.parse(name + entry.substring(sigStart));
                if (cls.getMethod(desc) != null) continue;

                var method = new MethodHolder(desc);
                method.setLevel(AccessLevel.PUBLIC);
                if (!isInterface && !"<init>".equals(name)) {
                    method.getModifiers().add(ElementModifier.FINAL);
                }
                method.setProgram(buildThrowStub(method, context));
                cls.addMethod(method);
            }
        }

        for (var method : cls.getMethods()) {
            var key = cls.getName() + "#" + method.getDescriptor().toString();
            if (REPLACE_BODY_METHODS.contains(key)) {
                method.getModifiers().remove(ElementModifier.NATIVE);
                method.setProgram(buildSilentStub(method, context));
            }
        }
    }

    private static org.teavm.model.Program buildThrowStub(MethodHolder method,
                                                          ClassHolderTransformerContext context) {
        var emitter = ProgramEmitter.create(method, context.getHierarchy());
        emitter.construct(UnsupportedOperationException.class,
                emitter.constant("not in TeaVM: " + method.getOwnerName() + "." + method.getName()))
                .raise();
        return emitter.getProgram();
    }

    private static org.teavm.model.Program buildSilentStub(MethodHolder method,
                                                           ClassHolderTransformerContext context) {
        var emitter = ProgramEmitter.create(method, context.getHierarchy());
        var ret = method.getResultType();
        if (ret == ValueType.VOID) {
            emitter.exit();
        } else if (ret instanceof ValueType.Primitive prim) {
            switch (prim.getKind()) {
                case BOOLEAN, BYTE, SHORT, CHARACTER, INTEGER -> emitter.constant(0).returnValue();
                case LONG -> emitter.constant(0L).returnValue();
                case FLOAT -> emitter.constant(0F).returnValue();
                case DOUBLE -> emitter.constant(0D).returnValue();
            }
        } else {
            emitter.constantNull(ret).returnValue();
        }
        return emitter.getProgram();
    }
}
