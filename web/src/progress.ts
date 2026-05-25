// Topbar progress bar. Renders byte-level download progress emitted by the
// worker for CheerpJ runtime + bridge JAR fetches.

export interface ProgressBar {
  show(label: string): void;
  set(loaded: number, total: number, label?: string): void;
  hide(): void;
}

export function createProgressBar(): ProgressBar {
  const root = document.getElementById("progress");
  const text = document.getElementById("progress-text");
  const pct = document.getElementById("progress-pct");
  const bar = document.getElementById("progress-bar");
  if (!root || !text || !pct || !bar) throw new Error("progress DOM missing");

  return {
    show(label: string): void {
      text.textContent = label;
      pct.textContent = "";
      bar.style.width = "0%";
      bar.classList.add("indeterminate");
      root.hidden = false;
    },
    set(loaded: number, total: number, label?: string): void {
      // `set` is the only entry point for the worker's progress events, so make it
      // re-show the bar if it was previously hidden — saves callers from pairing every
      // `set` with a `show`.
      root.hidden = false;
      if (label) text.textContent = label;
      if (total > 0) {
        bar.classList.remove("indeterminate");
        const ratio = Math.min(1, loaded / total);
        bar.style.width = `${(ratio * 100).toFixed(1)}%`;
        pct.textContent = `${formatBytes(loaded)} / ${formatBytes(total)}`;
      } else {
        bar.classList.add("indeterminate");
        pct.textContent = loaded > 0 ? formatBytes(loaded) : "";
      }
    },
    hide(): void {
      root.hidden = true;
    },
  };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
