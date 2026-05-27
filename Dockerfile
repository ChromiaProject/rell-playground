FROM eclipse-temurin:21-jdk

WORKDIR /repro

# Prime the Gradle distribution + dependency cache in a separate layer so iterating on
# sources doesn't redo network I/O. The first `gradlew` invocation downloads Gradle itself;
# `dependencies` triggers Maven resolution for everything on the build script's classpath.
COPY gradle/ gradle/
COPY gradlew gradlew.bat ./
COPY settings.gradle.kts build.gradle.kts ./
RUN ./gradlew --no-daemon help > /dev/null

# Now the sources.
COPY src/ src/

ENTRYPOINT ["./gradlew", "--no-daemon", "--console=plain", "--stacktrace", ":generateWasmGC"]
