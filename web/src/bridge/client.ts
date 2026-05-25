// Promise-friendly wrapper around the worker. Demultiplexes events by
// requestId; lets the SPA fire one operation at a time with a streaming
// `onEvent` callback for stdout/value/error lines.

import type { WorkerEvent, WorkerRequest } from "./protocol.ts";

export type StreamEvent = Exclude<WorkerEvent, { kind: "done" }>;

/**
 * Thrown when {@link BridgeClient.reset} cancels in-flight calls (e.g. user clicks
 * Stop, or switches mode mid-run). Mode handlers should silently swallow this —
 * the output panel has already been cleared/announced by the cancellation site.
 */
export class BridgeCancelled extends Error {
  constructor(message = "worker terminated") {
    super(message);
    this.name = "BridgeCancelled";
  }
}

export interface BridgeClient {
  init(onEvent?: (e: StreamEvent) => void): Promise<void>;
  version(): Promise<string>;
  runFile(code: string, onEvent: (e: StreamEvent) => void): Promise<boolean>;
  runModule(code: string, onEvent: (e: StreamEvent) => void): Promise<boolean>;
  replCreate(onEvent: (e: StreamEvent) => void): Promise<number>;
  replExecute(
    sessionId: number,
    command: string,
    onEvent: (e: StreamEvent) => void,
  ): Promise<boolean>;
  replDispose(sessionId: number): Promise<void>;
  /** Terminate the worker and reset state. Used by the Stop button. */
  reset(): void;
}

type Pending = {
  onEvent: (e: StreamEvent) => void;
  resolve: (v: { ok: boolean; result?: number | string | null }) => void;
  reject: (e: Error) => void;
};

const noopStream = (_e: StreamEvent): void => {};

export function createBridgeClient(workerUrl: URL): BridgeClient {
  let worker = spawn(workerUrl);
  let nextRequestId = 1;
  let pending = new Map<number, Pending>();

  function spawn(url: URL): Worker {
    // ESM worker — Vite bundles `worker.ts` as an ES module so the TeaVM-generated bridge
    // can be loaded via top-level `import` rather than `self.importScripts`. The dev server
    // injects HMR glue into the module shape; the prod build outputs a hashed `.js`.
    const w = new Worker(url, { type: "module" });
    w.onmessage = (ev: MessageEvent<WorkerEvent>) => {
      const e = ev.data;
      const p = pending.get(e.requestId);
      if (!p) return;
      if (e.kind === "done") {
        pending.delete(e.requestId);
        p.resolve({ ok: e.ok, result: e.result ?? null });
      } else {
        p.onEvent(e);
      }
    };
    w.onerror = (ev) => {
      const err = new Error(ev.message || "worker error");
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    };
    return w;
  }

  type RequestBody =
    | { kind: "init" }
    | { kind: "version" }
    | { kind: "runFile"; code: string }
    | { kind: "runModule"; code: string }
    | { kind: "replCreate" }
    | { kind: "replExecute"; sessionId: number; command: string }
    | { kind: "replDispose"; sessionId: number };

  function send(
    req: RequestBody,
    onEvent: (e: StreamEvent) => void = noopStream,
  ): Promise<{ ok: boolean; result?: number | string | null }> {
    const requestId = nextRequestId++;
    return new Promise((resolve, reject) => {
      pending.set(requestId, { onEvent, resolve, reject });
      worker.postMessage({ ...req, requestId } as WorkerRequest);
    });
  }

  return {
    async init(onEvent: (e: StreamEvent) => void = noopStream) {
      await send({ kind: "init" }, onEvent);
    },
    async version() {
      const r = await send({ kind: "version" });
      return typeof r.result === "string" ? r.result : "unknown";
    },
    async runModule(code, onEvent) {
      const r = await send({ kind: "runModule", code }, onEvent);
      return r.ok;
    },
    async runFile(code, onEvent) {
      const r = await send({ kind: "runFile", code }, onEvent);
      return r.ok;
    },
    async replCreate(onEvent) {
      const r = await send({ kind: "replCreate" }, onEvent);
      if (!r.ok || typeof r.result !== "number") throw new Error("REPL session creation failed");
      return r.result;
    },
    async replExecute(sessionId, command, onEvent) {
      const r = await send({ kind: "replExecute", sessionId, command }, onEvent);
      return r.ok;
    },
    async replDispose(sessionId) {
      await send({ kind: "replDispose", sessionId });
    },
    reset() {
      worker.terminate();
      const cancelled = new BridgeCancelled();
      for (const p of pending.values()) p.reject(cancelled);
      pending.clear();
      worker = spawn(workerUrl);
    },
  };
}
