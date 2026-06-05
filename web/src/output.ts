// Append-only output panel. Cheap DOM: one <div> per line, scroll-pinned to bottom.

import type { StreamEvent } from "./bridge/client.ts";

type LineKind = "stdout" | "value" | "error" | "warning" | "control" | "input" | "system";

export class OutputPanel {
  private readonly root: HTMLElement;
  // Line index while a run is being re-rendered; null outside a render pass
  // (REPL transcript, system lines) → appends always add a new line.
  private cursor: number | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  clear(): void {
    this.root.textContent = "";
    this.cursor = null;
  }

  // Reconcile a fresh run's output over whatever is already shown, line by line,
  // instead of wiping to blank first. Re-running an identical program then mutates
  // no DOM at all (no flicker); a changed run only rewrites the lines that differ.
  // Pair with endRender() to drop any leftover trailing lines.
  beginRender(): void {
    this.cursor = 0;
  }

  endRender(): void {
    if (this.cursor === null) return;
    while (this.root.children.length > this.cursor) this.root.lastElementChild!.remove();
    this.cursor = null;
  }

  appendLine(text: string, kind: LineKind = "stdout"): void {
    const atBottom =
      this.root.scrollTop + this.root.clientHeight >= this.root.scrollHeight - 4;
    const cls = `line ${kind}`;
    const i = this.cursor;
    if (i !== null) {
      this.cursor = i + 1;
      const existing = this.root.children[i] as HTMLElement | undefined;
      if (existing) {
        // In-place update; skip the assignment when unchanged so identical
        // re-runs touch nothing.
        if (existing.className !== cls) existing.className = cls;
        if (existing.textContent !== text) existing.textContent = text;
        if (atBottom) this.root.scrollTop = this.root.scrollHeight;
        return;
      }
    }
    const el = document.createElement("div");
    el.className = cls;
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
