// Test fixture that loads the TeaVM-compiled bridge JS once per Vitest worker and exposes
// typed helpers for asserting on the JSON envelopes its @JSExport methods return.
//
// The bridge runs in Node — no Worker, no Vite, no DOM. TeaVM's emitted module is plain
// ESM and the entry points are pure functions: `version()`, `runFile(code)`, `runModule(code)`,
// `replCreate()`, `replExecute(id, command)`, `replDispose(id)`. Each "run*" call returns a
// JSON string of the shape `{"ok": boolean, "events": [...]}` — we parse it once and let
// tests grep `events` by type.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

export type BridgeEvent =
  | { type: "stdout"; text: string }
  | { type: "value"; text: string }
  | { type: "control"; code: string; message: string }
  | {
      type: "compiler";
      severity: "error" | "warning";
      code: string;
      message: string;
      pos?: string;
    }
  | { type: "runtimeError"; message: string; stack?: string }
  | { type: "sql"; text: string };

export interface BridgeEnvelope {
  ok: boolean;
  events: BridgeEvent[];
}

export interface TeaVMBridge {
  version(): string;
  runFile(code: string): string;
  runModule(code: string): string;
  replCreate(): number;
  replExecute(sessionId: number, command: string): string;
  replDispose(sessionId: number): void;
}

let bridgePromise: Promise<TeaVMBridge> | null = null;

/**
 * Resolves the bridge JS path relative to this fixture, importing it once per Vitest
 * worker. The path checks both `web/public/teavm/` (the canonical dev location, populated
 * by `:bridge:copyTeavmToWeb`) and `bridge/build/generated/teavm/js/` (the raw TeaVM
 * output, so the test kit also works when run before `copyTeavmToWeb` fires).
 */
export function getBridge(): Promise<TeaVMBridge> {
  if (bridgePromise) return bridgePromise;
  bridgePromise = (async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(here, "../public/teavm/rell-playground-bridge.js"),
      resolve(here, "../../bridge/build/generated/teavm/js/rell-playground-bridge.js"),
    ];
    const path = candidates.find((p) => existsSync(p));
    if (!path) {
      throw new Error(
        `bridge JS not found. Run \`./gradlew :bridge:copyTeavmToWeb\` first. Tried:\n  ${candidates.join(
          "\n  ",
        )}`,
      );
    }
    // file:// URL so Node treats it as ESM regardless of cwd.
    const url = "file://" + path;
    const mod = (await import(url)) as TeaVMBridge;
    return mod;
  })();
  return bridgePromise;
}

/**
 * Run a one-shot Rell snippet (REPL semantics: no entities/queries/operations) and
 * return the parsed event envelope. Each call gets a fresh session.
 */
export async function runFile(code: string): Promise<BridgeEnvelope> {
  const b = await getBridge();
  return JSON.parse(b.runFile(code)) as BridgeEnvelope;
}

/**
 * Run a Rell snippet as module `main` (SQL dry-run semantics: entities + a top-level
 * `query main()` are allowed). DDL strings surface as `sql` events.
 */
export async function runModule(code: string): Promise<BridgeEnvelope> {
  const b = await getBridge();
  return JSON.parse(b.runModule(code)) as BridgeEnvelope;
}

/** Concatenate every `stdout` text on this envelope into one newline-joined string. */
export function stdoutOf(env: BridgeEnvelope): string {
  return env.events
    .filter((e): e is Extract<BridgeEvent, { type: "stdout" }> => e.type === "stdout")
    .map((e) => e.text)
    .join("\n");
}

/** Concatenate every `value` text (REPL value print). */
export function valuesOf(env: BridgeEnvelope): string[] {
  return env.events
    .filter((e): e is Extract<BridgeEvent, { type: "value" }> => e.type === "value")
    .map((e) => e.text);
}

/** Filter compiler-error messages so a test failure points at the real diagnostic. */
export function compilerErrors(env: BridgeEnvelope): string[] {
  return env.events
    .filter(
      (e): e is Extract<BridgeEvent, { type: "compiler" }> =>
        e.type === "compiler" && e.severity === "error",
    )
    .map((e) => `${e.code}: ${e.message}${e.pos ? ` @${e.pos}` : ""}`);
}

/** Filter runtime errors. */
export function runtimeErrors(env: BridgeEnvelope): string[] {
  return env.events
    .filter((e): e is Extract<BridgeEvent, { type: "runtimeError" }> => e.type === "runtimeError")
    .map((e) => e.message);
}

/** SQL strings the dry-run mode would have issued to postgres. */
export function sqlOf(env: BridgeEnvelope): string[] {
  return env.events
    .filter((e): e is Extract<BridgeEvent, { type: "sql" }> => e.type === "sql")
    .map((e) => e.text);
}
