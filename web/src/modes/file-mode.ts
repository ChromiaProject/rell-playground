// One-file mode: paste a complete program (or a REPL-able fragment), click Run.
// Fresh session per run; output + SQL panels cleared at the start.

import { BridgeCancelled, type StreamEvent } from "../bridge/client.ts";
import type { EditorHandle } from "../editor/editor.ts";
import type { OutputPanel } from "../output.ts";

export interface FileMode {
  run(): Promise<void>;
}

export function createFileMode(
  // The runner picks the bridge entry point: bridge.runFile (plain) or
  // bridge.runModule (SQL dry-run). Everything else is identical.
  runner: (code: string, onEvent: (e: StreamEvent) => void) => Promise<boolean>,
  editor: EditorHandle,
  output: OutputPanel,
  setBusy: (busy: boolean) => void,
  // Event router lives in main.ts so SQL events flow to the SQL pane,
  // progress events to the bar, and everything else to output. Passing it
  // in (rather than building a fresh one here) keeps panel routing in a
  // single place.
  onEvent: (e: StreamEvent) => void,
  // Bracket the run with a reconciling render pass instead of a clear: an
  // identical re-run rewrites no DOM (no flicker). beginRender opens the pass,
  // endRender drops any lines left over from a longer previous run.
  beginRender: () => void,
  endRender: () => void,
): FileMode {
  return {
    async run() {
      const code = editor.getValue();
      if (!code.trim()) return;
      beginRender();
      setBusy(true);
      try {
        await runner(code, onEvent);
      } catch (e) {
        // Bridge resets (Stop / mode switch) reject pending calls with BridgeCancelled.
        // The cancellation site already announced the halt — no need to surface an error.
        if (e instanceof BridgeCancelled) return;
        output.appendLine(
          `error: ${e instanceof Error ? e.message : String(e)}`,
          "error",
        );
      } finally {
        endRender();
        setBusy(false);
      }
    },
  };
}
