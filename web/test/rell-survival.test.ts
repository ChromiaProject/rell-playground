/*
 * Rell-on-TeaVM survival kit.
 *
 * The point of this suite is *not* to verify Rell language semantics — rell3's own
 * test/runtime owns that. The point is to catch regressions in the TeaVM bridge: when a
 * jOOQ / Jackson / kotlin-reflect static-init path picks up new dependencies, when
 * stubs decay, or when rell3 grows a new code path that touches a JDK method we haven't
 * shimmed, *something* in the suite below stops printing the expected string.
 *
 * Each test calls `runFile(code)` (REPL semantics — no entities/queries/operations) and
 * asserts on the resulting stdout/value events. Compiler diagnostics fail the test loudly
 * via `compilerErrors`, so a missed feature won't be silently masked by a parse error.
 *
 * If you're adding a new test:
 *   - keep it self-contained — one `print(...)` per line, eyeballable expected output;
 *   - assert on `stdoutOf(env)` rather than the full envelope (REPL spelling drifts);
 *   - if you need REPL value-print semantics, use `valuesOf(env)` instead.
 */

import { describe, expect, test } from "vitest";
import {
  compilerErrors,
  runFile,
  runtimeErrors,
  stdoutOf,
  valuesOf,
  getBridge,
} from "./bridge-fixture.ts";

const TIMEOUT_MS = 60_000;

function expectClean(env: { ok: boolean; events: unknown[] }, code: string): void {
  const compilerProblems = compilerErrors(env as any);
  const runtimeProblems = runtimeErrors(env as any);
  if (compilerProblems.length > 0 || runtimeProblems.length > 0) {
    throw new Error(
      `Rell snippet failed:\n--- code ---\n${code}\n--- compiler ---\n${compilerProblems.join(
        "\n",
      )}\n--- runtime ---\n${runtimeProblems.join("\n")}`,
    );
  }
  expect(env.ok).toBe(true);
}

describe("bridge sanity", { timeout: TIMEOUT_MS }, () => {
  test("version() returns a non-empty string", async () => {
    const bridge = await getBridge();
    const v = bridge.version();
    expect(v).toMatch(/rell: \S+/);
  });

  test("runFile on empty input completes without errors", async () => {
    const env = await runFile("");
    // `ok` may be false (the REPL probe writes nothing and uses `ok=true`, but a zero-event
    // envelope from a downstream code path could come through as `ok=false`); what matters
    // is that no compiler/runtime diagnostics are raised on an empty file.
    expect(compilerErrors(env)).toEqual([]);
    expect(runtimeErrors(env)).toEqual([]);
  });
});

describe("primitives and arithmetic", { timeout: TIMEOUT_MS }, () => {
  test("integer literals + addition", async () => {
    const code = `print(2 + 3);`;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env)).toBe("5");
  });

  test("integer subtraction, multiplication, division, modulo", async () => {
    const code = `print(10 - 3); print(4 * 7); print(20 / 6); print(20 % 6);`;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env).split("\n")).toEqual(["7", "28", "3", "2"]);
  });

  test("integer min/max boundaries", async () => {
    const code = `print(integer.MAX_VALUE); print(integer.MIN_VALUE);`;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env).split("\n")).toEqual([
      "9223372036854775807",
      "-9223372036854775808",
    ]);
  });

  test("decimal arithmetic", async () => {
    const code = `print(1.5 + 2.25); print(10.0 / 4.0);`;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env).split("\n")).toEqual(["3.75", "2.5"]);
  });

  test("big_integer literals", async () => {
    const code = `print(big_integer("123456789012345678901234567890"));`;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env)).toBe("123456789012345678901234567890");
  });

  test("boolean operators", async () => {
    const code = `print(true and false); print(true or false); print(not true);`;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env).split("\n")).toEqual(["false", "true", "false"]);
  });
});

describe("strings", { timeout: TIMEOUT_MS }, () => {
  test("concatenation and length", async () => {
    const code = `val s = "hello" + ", " + "world"; print(s); print(s.size());`;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env).split("\n")).toEqual(["hello, world", "12"]);
  });

  test("upper/lower case and contains", async () => {
    const code = `
      val s = "RellPlayground";
      print(s.upper_case());
      print(s.lower_case());
      print(s.contains("Play"));
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env).split("\n")).toEqual([
      "RELLPLAYGROUND",
      "rellplayground",
      "true",
    ]);
  });

  test("interpolation", async () => {
    const code = `val n = 42; print("n is %d".format(n));`;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env)).toBe("n is 42");
  });
});

describe("control flow", { timeout: TIMEOUT_MS }, () => {
  test("if / else", async () => {
    const code = `
      val x = 7;
      if (x > 5) { print("big"); } else { print("small"); }
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env)).toBe("big");
  });

  test("when expression", async () => {
    const code = `
      val day = 3;
      val name = when (day) {
        1 -> "Mon";
        2 -> "Tue";
        3 -> "Wed";
        else -> "?";
      };
      print(name);
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env)).toBe("Wed");
  });

  test("for loop over a range", async () => {
    const code = `
      var total: integer = 0;
      for (i in range(1, 6)) total += i;
      print(total);
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env)).toBe("15");
  });

  test("while loop", async () => {
    const code = `
      var n = 0;
      var i = 1;
      while (i <= 4) { n += i; i += 1; }
      print(n);
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env)).toBe("10");
  });
});

describe("functions", { timeout: TIMEOUT_MS }, () => {
  test("simple function call", async () => {
    const code = `
      function square(x: integer): integer = x * x;
      print(square(9));
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env)).toBe("81");
  });

  test("recursion: factorial", async () => {
    const code = `
      function fact(n: integer): integer {
        if (n <= 1) return 1;
        return n * fact(n - 1);
      }
      print(fact(10));
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env)).toBe("3628800");
  });

  test("mutual recursion", async () => {
    const code = `
      function is_even(n: integer): boolean {
        if (n == 0) return true;
        return is_odd(n - 1);
      }
      function is_odd(n: integer): boolean {
        if (n == 0) return false;
        return is_even(n - 1);
      }
      print(is_even(10));
      print(is_odd(7));
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env).split("\n")).toEqual(["true", "true"]);
  });

  test("default arguments", async () => {
    const code = `
      function greet(name: text, greeting: text = "hi"): text = greeting + ", " + name;
      print(greet("Alice"));
      print(greet("Bob", "hello"));
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env).split("\n")).toEqual(["hi, Alice", "hello, Bob"]);
  });

  test("named arguments", async () => {
    const code = `
      function rect(width: integer, height: integer): integer = width * height;
      print(rect(height = 3, width = 5));
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env)).toBe("15");
  });
});

describe("collections", { timeout: TIMEOUT_MS }, () => {
  test("list literal + iteration", async () => {
    const code = `
      val xs = [1, 2, 3, 4];
      var s = 0;
      for (x in xs) s += x;
      print(s);
      print(xs.size());
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env).split("\n")).toEqual(["10", "4"]);
  });

  test("set membership", async () => {
    const code = `
      val s = set<integer>([1, 2, 3]);
      print(2 in s);
      print(4 in s);
      print(s.size());
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env).split("\n")).toEqual(["true", "false", "3"]);
  });

  test("map lookup", async () => {
    const code = `
      val m = map<text, integer>(["a": 1, "b": 2, "c": 3]);
      print(m["b"]);
      print(m.size());
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env).split("\n")).toEqual(["2", "3"]);
  });

  test("list operations: filter, map, sum", async () => {
    const code = `
      val xs = [1, 2, 3, 4, 5];
      val evens = xs @* { $ % 2 == 0 };
      print(evens);
      val doubled = xs @* { } ( $ * 2 );
      print(doubled);
      print(xs @ { } ( @sum 1 ));
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env).split("\n")).toEqual(["[2, 4]", "[2, 4, 6, 8, 10]", "5"]);
  });
});

describe("tuples", { timeout: TIMEOUT_MS }, () => {
  test("tuple construction + projection", async () => {
    const code = `
      val t = (1, "two", true);
      print(t[0]);
      print(t[1]);
      print(t[2]);
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env).split("\n")).toEqual(["1", "two", "true"]);
  });

  test("named-field tuples", async () => {
    const code = `
      val p = (name = "Alice", age = 30);
      print(p.name);
      print(p.age);
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env).split("\n")).toEqual(["Alice", "30"]);
  });
});

describe("structs and enums", { timeout: TIMEOUT_MS }, () => {
  test("struct definition and access", async () => {
    const code = `
      struct Point { x: integer; y: integer; }
      val p = Point(x = 3, y = 4);
      print(p.x);
      print(p.y);
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env).split("\n")).toEqual(["3", "4"]);
  });

  test("enum declaration and value print", async () => {
    const code = `
      enum Color { RED, GREEN, BLUE }
      val c = Color.GREEN;
      print(c);
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env)).toBe("GREEN");
  });
});

describe("nullables", { timeout: TIMEOUT_MS }, () => {
  test("nullable variable, null check, !! force", async () => {
    const code = `
      val x: integer? = if (true) 5 else null;
      if (x != null) print(x * 2);
      print(x!! + 1);
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env).split("\n")).toEqual(["10", "6"]);
  });

  test("elvis operator ?:", async () => {
    const code = `
      val a: integer? = null;
      val b: integer? = 7;
      print(a ?: -1);
      print(b ?: -1);
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env).split("\n")).toEqual(["-1", "7"]);
  });

  test("safe call ?.", async () => {
    const code = `
      val s: text? = "abc";
      val n: text? = null;
      print(s?.size());
      print(n?.size());
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env).split("\n")).toEqual(["3", "null"]);
  });
});

describe("type conversion + stdlib", { timeout: TIMEOUT_MS }, () => {
  test("integer.from_text", async () => {
    const code = `print(integer.from_text("42"));`;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env)).toBe("42");
  });

  test("text.from_bytes / byte_array", async () => {
    const code = `
      val bs = x"68656C6C6F";
      print(text.from_bytes(bs));
      print(bs.size());
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env).split("\n")).toEqual(["hello", "5"]);
  });

  test("abs / min / max stdlib", async () => {
    const code = `
      print(abs(-5));
      print(min(3, 7));
      print(max(3, 7));
    `;
    const env = await runFile(code);
    expectClean(env, code);
    expect(stdoutOf(env).split("\n")).toEqual(["5", "3", "7"]);
  });
});

describe("error surfaces", { timeout: TIMEOUT_MS }, () => {
  // `env.ok` is the bridge-level outcome (caught Throwable vs no Throwable). Compiler errors
  // surface as compiler-event entries while the bridge still finishes with `ok=true`, and Rell
  // runtime errors are printed via printRuntimeError without rethrowing past `executeCode`.
  // So the assertion shape is: at least one diagnostic of the expected kind, regardless of `ok`.
  test("compile error: undeclared variable", async () => {
    const env = await runFile(`print(no_such_var);`);
    const errs = compilerErrors(env);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.join("\n")).toMatch(/no_such_var|unknown_name|undefined/i);
  });

  test("runtime error: division by zero", async () => {
    const env = await runFile(`print(1 / 0);`);
    const errs = runtimeErrors(env);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.join("\n")).toMatch(/div|zero|arith/i);
  });

  test("runtime error: nullable !! on null", async () => {
    const code = `val x: integer? = null; print(x!!);`;
    const env = await runFile(code);
    expect(runtimeErrors(env).length).toBeGreaterThan(0);
    expect(runtimeErrors(env).join("\n")).toMatch(/null/i);
  });
});

describe("REPL session continuity", { timeout: TIMEOUT_MS }, () => {
  test("definitions persist across commands", async () => {
    const bridge = await getBridge();
    const id = bridge.replCreate();
    expect(id).toBeGreaterThanOrEqual(0);
    try {
      const def = JSON.parse(bridge.replExecute(id, `function double(n: integer): integer = n * 2;`));
      expect(compilerErrors(def)).toEqual([]);
      const call = JSON.parse(bridge.replExecute(id, `double(21)`));
      expectClean(call, "double(21)");
      // REPL prints the value via `value` events, not stdout.
      expect(valuesOf(call)).toContain("42");
    } finally {
      bridge.replDispose(id);
    }
  });

  test("variables persist across commands", async () => {
    const bridge = await getBridge();
    const id = bridge.replCreate();
    try {
      const v1 = JSON.parse(bridge.replExecute(id, `val msg = "hi";`));
      expect(compilerErrors(v1)).toEqual([]);
      const v2 = JSON.parse(bridge.replExecute(id, `print(msg + ", world");`));
      expectClean(v2, "print(msg + ...)");
      expect(stdoutOf(v2)).toBe("hi, world");
    } finally {
      bridge.replDispose(id);
    }
  });
});
