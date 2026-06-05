// SQL panel: collects SQL fragments emitted by the bridge (one per Rell
// @-expression / database operation) and renders them in the right-pane "SQL"
// tab.

export interface SqlPanel {
  clear(): void;
  /** Reconcile a fresh run's entries over the existing ones (see OutputPanel). */
  beginRender(): void;
  endRender(): void;
  append(text: string): void;
  /** Number of entries currently shown; used by the tab indicator. */
  count(): number;
}

export function createSqlPanel(root: HTMLElement): SqlPanel {
  let n = 0;
  // Entry index while reconciling a run; null outside a render pass.
  let cursor: number | null = null;
  return {
    clear(): void {
      root.textContent = "";
      n = 0;
      cursor = null;
    },
    beginRender(): void {
      cursor = 0;
    },
    endRender(): void {
      if (cursor === null) return;
      while (root.children.length > cursor) root.lastElementChild!.remove();
      n = cursor;
      cursor = null;
    },
    append(text: string): void {
      const i = cursor;
      if (i !== null) {
        cursor = i + 1;
        const existing = root.children[i] as HTMLElement | undefined;
        if (existing) {
          if (existing.textContent !== text) existing.textContent = text;
          return;
        }
      } else {
        n++;
      }
      const div = document.createElement("div");
      div.className = "sql-entry";
      div.textContent = text;
      root.appendChild(div);
    },
    count(): number {
      return n;
    },
  };
}
