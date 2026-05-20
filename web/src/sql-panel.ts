// SQL panel: collects SQL fragments emitted by the bridge (one per Rell
// @-expression / database operation) and renders them in the right-pane "SQL"
// tab.

export interface SqlPanel {
  clear(): void;
  append(text: string): void;
  /** Number of entries currently shown; used by the tab indicator. */
  count(): number;
}

export function createSqlPanel(root: HTMLElement): SqlPanel {
  let n = 0;
  return {
    clear(): void {
      root.textContent = "";
      n = 0;
    },
    append(text: string): void {
      const div = document.createElement("div");
      div.className = "sql-entry";
      div.textContent = text;
      root.appendChild(div);
      n++;
    },
    count(): number {
      return n;
    },
  };
}
