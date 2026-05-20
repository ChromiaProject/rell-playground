// One-file mode: paste a complete program (or a REPL-able fragment), click Run.
// Fresh session per run; output panel cleared at the start.

import type { BridgeClient } from "../bridge/client.ts";
import type { EditorHandle } from "../editor/editor.ts";
import type { OutputPanel } from "../output.ts";

export interface FileMode {
  run(): Promise<void>;
}

export function createFileMode(
  bridge: BridgeClient,
  editor: EditorHandle,
  output: OutputPanel,
  setBusy: (busy: boolean) => void,
): FileMode {
  return {
    async run() {
      const code = editor.getValue();
      if (!code.trim()) return;
      output.clear();
      setBusy(true);
      try {
        await bridge.runFile(code, (e) => output.appendEvent(e));
      } catch (e) {
        output.appendLine(
          `error: ${e instanceof Error ? e.message : String(e)}`,
          "error",
        );
      } finally {
        setBusy(false);
      }
    },
  };
}
