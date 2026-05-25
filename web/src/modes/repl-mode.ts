// Interactive REPL mode. The editor still works (for multi-line defs);
// pressing Run executes the editor content as one REPL command. The
// input bar at the bottom executes single-line commands.
//
// One persistent session per mode lifecycle; switching tabs disposes
// the session and creates a new one when REPL mode is re-entered.

import { BridgeCancelled, type BridgeClient, type StreamEvent } from "../bridge/client.ts";
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
  onEvent: (e: StreamEvent) => void,
  clearPanels: () => void,
): ReplMode {
  let sessionId: number | null = null;

  async function ensureSession(): Promise<number> {
    if (sessionId !== null) return sessionId;
    const id = await bridge.replCreate(onEvent);
    sessionId = id;
    output.appendLine(`REPL session #${id} ready.`, "system");
    return id;
  }

  // BridgeCancelled bubbles up here when the user switches modes (or hits Stop)
  // mid-call. The cancellation site already announced the halt, so swallow it.
  const swallowCancelled = (e: unknown): void => {
    if (e instanceof BridgeCancelled) return;
    throw e;
  };

  return {
    async enter() {
      clearPanels();
      output.appendLine("Starting REPL...", "system");
      setBusy(true);
      try {
        await ensureSession();
      } catch (e) {
        swallowCancelled(e);
      } finally {
        setBusy(false);
      }
    },
    async leave() {
      if (sessionId !== null) {
        try {
          await bridge.replDispose(sessionId);
        } catch (e) {
          swallowCancelled(e);
        } finally {
          sessionId = null;
        }
      }
    },
    async runEditor() {
      const code = editor.getValue();
      if (!code.trim()) return;
      setBusy(true);
      try {
        const id = await ensureSession();
        await bridge.replExecute(id, code, onEvent);
      } catch (e) {
        swallowCancelled(e);
      } finally {
        setBusy(false);
      }
    },
    async submitLine(command) {
      if (!command.trim()) return;
      output.appendLine(command, "input");
      setBusy(true);
      try {
        const id = await ensureSession();
        await bridge.replExecute(id, command, onEvent);
      } catch (e) {
        swallowCancelled(e);
      } finally {
        setBusy(false);
      }
    },
  };
}
