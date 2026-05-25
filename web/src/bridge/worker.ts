/// <reference lib="webworker" />

// TeaVM-backed worker. Imports the AOT-compiled bridge as an ESM module and dispatches
// PlaygroundJsBridge.* @JSExport functions. Output is batched per call (Rell synchronously
// fills the BufferedReplChannel before returning), so we receive a JSON envelope and forward
// each event back to the main thread.

import type { WorkerEvent, WorkerRequest } from "./protocol.ts";

// TeaVM emits this module as ESM with one named export per @JSExport-annotated static method
// on PlaygroundJsBridge. It's copied into web/public/teavm/ by :bridge:copyTeavmToWeb; that
// directory is served verbatim by Vite (no transform pipeline). A static `import` of a /public
// asset is rejected by Vite ("non-asset file inside /public"); a *dynamic* import with
// `@vite-ignore` keeps the URL out of Vite's static module graph and resolves it at runtime.
type TeaVMBridge = {
  version(): string;
  runFile(code: string): string;
  runModule(code: string): string;
  replCreate(): number;
  replExecute(sessionId: number, command: string): string;
  replDispose(sessionId: number): void;
};

// Build the URL at runtime so Vite's static `import("/public-path")` check (which fires
// *before* `/* @vite-ignore */` is honoured) can't see the literal path. The dynamic
// `import(<variable>)` falls through to the browser's native ESM loader, which fetches
// the file straight from /public without going through Vite's transform pipeline.
//
// Dev (`vite dev`) serves the worker source from `/src/bridge/worker.ts` and `/teavm/...`
// from the public directory at origin root. Prod serves the worker from
// `<base>assets/worker.<hash>.js`, so the bridge lives at `../teavm/...` relative to it
// — using an absolute `/teavm/...` would escape the GitHub Pages sub-path
// (`/rell-playground/`) and land at the wrong origin path.
const bridgeUrl = new URL(
    import.meta.env.DEV ? "/teavm/rell-playground-bridge.js" : "../teavm/rell-playground-bridge.js",
    self.location.href,
).href;
const bridgeReady: Promise<TeaVMBridge> = import(/* @vite-ignore */ bridgeUrl);

type ReplEvent =
  | { type: "stdout"; text: string }
  | { type: "value"; text: string }
  | { type: "control"; code: string; message: string }
  | { type: "compiler"; severity: string; code: string; message: string; pos?: string }
  | { type: "runtimeError"; message: string; stack?: string }
  | { type: "sql"; text: string };

type Envelope = { ok: boolean; events: ReplEvent[] };

declare const self: DedicatedWorkerGlobalScope;

function post(event: WorkerEvent): void {
  self.postMessage(event);
}

function forwardEnvelope(requestId: number, raw: string): boolean {
  let env: Envelope;
  try {
    env = JSON.parse(raw) as Envelope;
  } catch {
    post({
      kind: "runtimeError",
      requestId,
      message: `bridge returned non-JSON: ${raw.slice(0, 200)}`,
      stack: null,
    });
    return false;
  }
  for (const e of env.events) {
    switch (e.type) {
      case "stdout":
        post({ kind: "stdout", requestId, text: e.text });
        break;
      case "value":
        post({ kind: "value", requestId, text: e.text });
        break;
      case "control":
        post({ kind: "control", requestId, code: e.code, message: e.message });
        break;
      case "compiler":
        post({
          kind: "compiler",
          requestId,
          severity: e.severity === "warning" ? "warning" : "error",
          code: e.code,
          message: e.message,
          pos: e.pos ?? null,
        });
        break;
      case "runtimeError":
        post({
          kind: "runtimeError",
          requestId,
          message: e.message,
          stack: e.stack ?? null,
        });
        break;
      case "sql":
        post({ kind: "sql", requestId, text: e.text });
        break;
    }
  }
  return env.ok;
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    const bridge = await bridgeReady;
    switch (req.kind) {
      case "init":
        // `await bridgeReady` above resolved — top-level static initialisers in the TeaVM
        // module have run. Tell the SPA the worker is ready.
        post({ kind: "progress", requestId: req.requestId, label: "", loaded: 0, total: 0, done: true });
        post({ kind: "done", requestId: req.requestId, ok: true });
        return;
      case "version": {
        const v = bridge.version();
        post({ kind: "done", requestId: req.requestId, ok: true, result: v });
        return;
      }
      case "runFile": {
        const raw = bridge.runFile(req.code);
        const ok = forwardEnvelope(req.requestId, raw);
        post({ kind: "done", requestId: req.requestId, ok });
        return;
      }
      case "runModule": {
        const raw = bridge.runModule(req.code);
        const ok = forwardEnvelope(req.requestId, raw);
        post({ kind: "done", requestId: req.requestId, ok });
        return;
      }
      case "replCreate": {
        const id = bridge.replCreate();
        post({ kind: "done", requestId: req.requestId, ok: id >= 0, result: id });
        return;
      }
      case "replExecute": {
        const raw = bridge.replExecute(req.sessionId, req.command);
        const ok = forwardEnvelope(req.requestId, raw);
        post({ kind: "done", requestId: req.requestId, ok });
        return;
      }
      case "replDispose": {
        bridge.replDispose(req.sessionId);
        post({ kind: "done", requestId: req.requestId, ok: true });
        return;
      }
    }
  } catch (e) {
    post({
      kind: "runtimeError",
      requestId: req.requestId,
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? (e.stack ?? null) : null,
    });
    post({ kind: "done", requestId: req.requestId, ok: false });
  }
};
