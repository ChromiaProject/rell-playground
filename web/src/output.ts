// Append-only output panel. Cheap DOM: one <div> per line, scroll-pinned to bottom.

import type { StreamEvent } from "./bridge/client.ts";

type LineKind = "stdout" | "value" | "error" | "warning" | "control" | "input" | "system";

export class OutputPanel {
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  clear(): void {
    this.root.textContent = "";
  }

  appendLine(text: string, kind: LineKind = "stdout"): void {
    const atBottom =
      this.root.scrollTop + this.root.clientHeight >= this.root.scrollHeight - 4;
    const el = document.createElement("div");
    el.className = `line ${kind}`;
    el.textContent = text;
    this.root.appendChild(el);
    if (atBottom) this.root.scrollTop = this.root.scrollHeight;
  }

  appendEvent(e: StreamEvent): void {
    switch (e.kind) {
      case "stdout":
        for (const line of e.text.split("\n")) this.appendLine(line, "stdout");
        return;
      case "value":
        this.appendLine(e.text, "value");
        return;
      case "control":
        this.appendLine(e.message, "control");
        return;
      case "compiler": {
        const prefix = e.pos ? `${e.pos} ` : "";
        const kind: LineKind = e.severity === "warning" ? "warning" : "error";
        this.appendLine(`${prefix}${e.severity}: ${e.message} [${e.code}]`, kind);
        return;
      }
      case "runtimeError": {
        this.appendLine(`runtime error: ${e.message}`, "error");
        if (e.stack) for (const line of e.stack.split("\n")) this.appendLine(line, "error");
        return;
      }
      // sql + progress are surfaced elsewhere (SqlPanel, ProgressBar).
      case "sql":
      case "progress":
        return;
    }
  }
}
