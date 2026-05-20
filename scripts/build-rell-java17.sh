#!/usr/bin/env bash
# Build a Java 17 variant of the Rell artifacts that the bridge depends on,
# and publish them to the local Maven cache (~/.m2). CheerpJ 4.x maxes out at
# JRE 17, so we re-target Rell's published bytecode (Java 21) down to 17.
#
# Used by:
#   - .gitlab-ci.yml (`rell-java17` job) — the resulting fat JAR is the
#     pipeline artifact handed to the `build` job.
#   - local dev: run once after a clean checkout if you can't / don't want to
#     consume the GitLab artifact.
#
# Requires: JDK 21 (sets `org.gradle.java.installations.fromEnv=JAVA_HOME`).

set -euo pipefail

REPO="${RELL_REPO_URL:-https://gitlab.com/chromaway/rell.git}"
TAG="${RELL_TAG:-0.15.4}"
WORK="${RELL_WORK_DIR:-${RUNNER_TEMP:-/tmp}/rell-${TAG}}"

if [[ ! -d "${WORK}" ]]; then
  git clone --depth 1 --branch "${TAG}" "${REPO}" "${WORK}"
fi

# Patch jvmTarget + javac --release in the root build script. Idempotent — runs
# of this script on an already-patched tree no-op.
ROOT_BUILD="${WORK}/build.gradle.kts"
if ! grep -q "options.release.set(17)" "${ROOT_BUILD}"; then
  python3 - "${ROOT_BUILD}" <<'PY'
import re, sys, pathlib
p = pathlib.Path(sys.argv[1])
src = p.read_text()
src = src.replace("JvmTarget.JVM_21", "JvmTarget.JVM_17")
needle = "compilerOptions.jvmTarget = JvmTarget.JVM_17"
insert = """compilerOptions.jvmTarget = JvmTarget.JVM_17
        }

        // CheerpJ 4.x supports up to Java 17 only — emit Java 17 bytecode
        // from javac too (the Kotlin change alone leaves ANTLR-generated
        // Java + small bits of javac-built code at Java 21).
        tasks.withType<JavaCompile>().configureEach {
            options.release.set(17)"""
src = src.replace(needle + "\n        }", insert + "\n        }", 1)
p.write_text(src)
PY
fi

# Patch UniqueStack.pop: `list.removeLast()` on a MutableList compiles to
# java.util.List.removeLast() (Java 21 native), which doesn't exist on JRE 17.
# Use index-based removal instead. Idempotent.
MANAGER_KT="${WORK}/rell-base/src/main/kotlin/net/postchain/rell/base/utils/futures/manager.kt"
if [[ -f "${MANAGER_KT}" ]] && ! grep -q "removeAt(list.size - 1)" "${MANAGER_KT}"; then
  python3 - "${MANAGER_KT}" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1])
src = p.read_text()
old = "        list.removeLast()\n        set.remove(last)"
new = "        // removeAt(size-1) instead of removeLast(): Kotlin 2.x compiles\n        // `list.removeLast()` on a MutableList to a call against\n        // java.util.List.removeLast() (Java 21 native). CheerpJ ships a\n        // Java 17 JRE, where that method doesn't exist — invoking it throws\n        // NoSuchMethodError. Use the index-based form to stay JRE-17 safe.\n        list.removeAt(list.size - 1)\n        set.remove(last)"
if old in src:
    src = src.replace(old, new, 1)
    p.write_text(src)
PY
fi

cd "${WORK}"
./gradlew --no-daemon \
  :rell-tools:publishToMavenLocal \
  :rell-api-shell:publishToMavenLocal \
  :rell-api-base:publishToMavenLocal \
  :rell-api-gtx:publishToMavenLocal \
  :rell-api-native:publishToMavenLocal \
  :rell-base:publishToMavenLocal \
  :rell-gtx:publishToMavenLocal \
  -x test
