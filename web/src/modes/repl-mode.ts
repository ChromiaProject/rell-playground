// Interactive REPL mode. The editor still works (for multi-line defs);
// pressing Run executes the editor content as one REPL command. The
// input bar at the bottom executes single-line commands.
//
// One persistent session per mode lifecycle; switching tabs disposes
// the session and creates a new one when REPL mode is re-entered.

import type { BridgeClient } from "../bridge/client.ts";
import type { EditorHandle } from "../editor/editor.ts";
import type { OutputPanel } from "../output.ts";

export interface ReplMode {
  enter(): Promise<void>;
  leave(): Promise<void>;
  runEditor(): Promise<void>;
  submitLine(command: string): Promise<void>;
}

export function createReplMode(
  bridge: BridgeClient,
  editor: EditorHandle,
  output: OutputPanel,
  setBusy: (busy: boolean) => void,
): ReplMode {
  let sessionId: number | null = null;

  async function ensureSession(): Promise<number> {
    if (sessionId !== null) return sessionId;
    const id = await bridge.replCreate((e) => output.appendEvent(e));
    sessionId = id;
    output.appendLine(`REPL session #${id} ready.`, "system");
    return id;
  }

  return {
    async enter() {
      output.clear();
      output.appendLine("Starting REPL...", "system");
      setBusy(true);
      try {
        await ensureSession();
      } finally {
        setBusy(false);
      }
    },
    async leave() {
      if (sessionId !== null) {
        await bridge.replDispose(sessionId);
        sessionId = null;
      }
    },
    async runEditor() {
      const code = editor.getValue();
      if (!code.trim()) return;
      const id = await ensureSession();
      setBusy(true);
      try {
        await bridge.replExecute(id, code, (e) => output.appendEvent(e));
      } finally {
        setBusy(false);
      }
    },
    async submitLine(command) {
      if (!command.trim()) return;
      const id = await ensureSession();
      output.appendLine(command, "input");
      setBusy(true);
      try {
        await bridge.replExecute(id, command, (e) => output.appendEvent(e));
      } finally {
        setBusy(false);
      }
    },
  };
}
