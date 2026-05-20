// Wire protocol between the SPA and the worker hosting the TeaVM bridge.
// Plain structured-cloneable shapes — no functions cross the boundary.

export type WorkerRequest =
  | { kind: "init"; requestId: number }
  | { kind: "version"; requestId: number }
  | { kind: "runFile"; requestId: number; code: string }
  | { kind: "replCreate"; requestId: number }
  | { kind: "replExecute"; requestId: number; sessionId: number; command: string }
  | { kind: "replDispose"; requestId: number; sessionId: number };

export type WorkerEvent =
  | { kind: "stdout"; requestId: number; text: string }
  | { kind: "value"; requestId: number; text: string }
  | { kind: "control"; requestId: number; code: string; message: string }
  | {
      kind: "compiler";
      requestId: number;
      severity: "error" | "warning";
      code: string;
      message: string;
      pos: string | null;
    }
  | { kind: "runtimeError"; requestId: number; message: string; stack: string | null }
  | { kind: "sql"; requestId: number; text: string }
  | {
      kind: "progress";
      requestId: number;
      label: string;
      loaded: number;
      total: number;
      done: boolean;
    }
  | { kind: "done"; requestId: number; ok: boolean; result?: number | string | null };
