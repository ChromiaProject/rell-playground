// SPA entry. Wires the editor, output panel, mode switch, and worker bridge.

// Vite worker query: this static import resolves to the worker's bundled URL (dev: the
// transpiled source; prod: the hashed asset). Strapping the URL onto a `Worker` is
// Vite's recommended ESM-friendly shape — it survives the prod hashing pass without us
// having to hand-roll `new URL("./worker.js", import.meta.url)` glue.
import workerUrl from "./bridge/worker.ts?worker&url";
import { createBridgeClient } from "./bridge/client.ts";
import { mountEditor, mountReplInput, DEFAULT_FILE, SQL_EXAMPLE } from "./editor/editor.ts";
import { OutputPanel } from "./output.ts";
import { createFileMode } from "./modes/file-mode.ts";
import { createReplMode } from "./modes/repl-mode.ts";
import { createProgressBar } from "./progress.ts";
import { createSqlPanel } from "./sql-panel.ts";
import type { StreamEvent } from "./bridge/client.ts";
import { decode, encode } from "./util/share.ts";

type Mode = "file" | "sql" | "repl";

type Theme = "light" | "dark";
const THEME_STORAGE_KEY = "rell-playground:theme";

function readTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "dark" ? "dark" : "light";
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* private mode */ }
  // Notify any subscribers (Monaco) that the theme changed.
  document.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
}

async function main(): Promise<void> {

  const outputEl = document.getElementById("output");
  const sqlEl = document.getElementById("sql");
  const editorEl = document.getElementById("editor");
  const runBtn = document.getElementById("run-btn") as HTMLButtonElement | null;
  const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement | null;
  const shareBtn = document.getElementById("share-btn") as HTMLButtonElement | null;
  const themeToggle = document.getElementById("theme-toggle") as HTMLButtonElement | null;
  const versionTag = document.getElementById("version-tag");
  const replForm = document.getElementById("repl-form") as HTMLElement | null;
  const replInputEl = document.getElementById("repl-input") as HTMLElement | null;
  const tabOutput = document.getElementById("tab-output") as HTMLButtonElement | null;
  const tabSql = document.getElementById("tab-sql") as HTMLButtonElement | null;
  const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".mode-switch button"));

  if (!outputEl || !sqlEl || !editorEl || !runBtn || !stopBtn || !shareBtn || !themeToggle || !versionTag ||
      !replForm || !replInputEl || !tabOutput || !tabSql) {
    throw new Error("missing required DOM nodes");
  }

  // Reflect current theme in the toggle glyph, and wire the click.
  const refreshToggleGlyph = (): void => {
    themeToggle.textContent = readTheme() === "dark" ? "☀" : "☾";
  };
  refreshToggleGlyph();
  themeToggle.addEventListener("click", () => {
    applyTheme(readTheme() === "dark" ? "light" : "dark");
    refreshToggleGlyph();
  });

  // Optional shared buffer from URL hash. Overrides the localStorage cache.
  let initial: string | undefined;
  if (location.hash.length > 1) {
    const decoded = await decode(location.hash.slice(1));
    if (decoded !== null) initial = decoded;
  }

  const output = new OutputPanel(outputEl);
  const sql = createSqlPanel(sqlEl);
  const progress = createProgressBar();
  const editor = await mountEditor(editorEl, initial);
  const replInput = mountReplInput(replInputEl);

  // Output / SQL tab switching.
  const setTab = (which: "output" | "sql"): void => {
    const isOutput = which === "output";
    outputEl.hidden = !isOutput;
    sqlEl.hidden = isOutput;
    tabOutput.classList.toggle("active", isOutput);
    tabSql.classList.toggle("active", !isOutput);
    tabOutput.setAttribute("aria-selected", isOutput ? "true" : "false");
    tabSql.setAttribute("aria-selected", isOutput ? "false" : "true");
  };
  tabOutput.addEventListener("click", () => setTab("output"));
  tabSql.addEventListener("click", () => setTab("sql"));

  const bridge = createBridgeClient(new URL(workerUrl, import.meta.url));

  // Tracked so route() can reveal the Output tab if a SQL dry-run hits a
  // real diagnostic (compile error / non-trivial runtime error) — see below.
  let currentMode: Mode = "file";
  let revealOutputOnError = (): void => {};

  // Funnel stream events: progress → bar, sql → panel, everything else → output.
  const route = (e: StreamEvent): void => {
    if (e.kind === "progress") {
      if (e.done) progress.hide();
      else progress.set(e.loaded, e.total, e.label);
      return;
    }
    if (e.kind === "sql") {
      sql.append(e.text);
      return;
    }
    // In SQL dry-run mode the Output tab is hidden (the pane would otherwise
    // just show empty results). But a compile error or genuine runtime error
    // IS worth showing — surface the Output tab when one arrives.
    if (currentMode === "sql" && (e.kind === "compiler" || e.kind === "runtimeError")) {
      revealOutputOnError();
    }
    output.appendEvent(e);
  };

  progress.show("Loading Rell runtime…");
  output.appendLine("Loading Rell runtime...", "system");
  await bridge.init(route);
  progress.hide();
  const version = await bridge.version();
  // Full string is something like:
  //   "rell: 0.15.4; postchain: 3.49.10; branch: master; commit: …; dirty: true"
  // Surface just the Rell version in the topbar — postchain is irrelevant for
  // the in-browser playground (no node, no consensus). The full descriptor stays
  // on `title=` for discoverability.
  const m = /rell:\s*([^;]+)/i.exec(version);
  const rell = m?.[1]?.trim();
  versionTag.textContent = rell ? `rell ${rell}` : version;
  versionTag.title = version;
  output.appendLine(`Ready — ${version}`, "system");

  // Phased indeterminate progress bar during Run/SQL/REPL execution. The worker call
  // (`bridge.runFile` etc.) is one synchronous JVM-in-JS block so we can't get genuine
  // sub-phase signals from inside; instead we flip the label on a timer to communicate
  // that something is happening. Thresholds are tuned to typical TeaVM-bridge timings:
  // a trivial `print` round-trips in ~200 ms, a fact(10) in ~500 ms, and a SQL dry-run
  // with several entities takes 2–4 s on first hit.
  let phaseTimer: ReturnType<typeof setInterval> | null = null;
  const phaseLabel = (ms: number): string => {
    if (ms < 600) return "Compiling Rell…";
    if (ms < 2500) return "Running…";
    return "Working…";
  };
  const stopPhases = (): void => {
    if (phaseTimer !== null) {
      clearInterval(phaseTimer);
      phaseTimer = null;
    }
  };
  const startPhases = (): void => {
    stopPhases();
    const t0 = performance.now();
    progress.show(phaseLabel(0));
    phaseTimer = setInterval(() => {
      progress.set(0, 0, phaseLabel(performance.now() - t0));
    }, 150);
  };

  const busy = (b: boolean): void => {
    runBtn.disabled = b;
    stopBtn.disabled = !b;
    if (b) startPhases();
    else {
      stopPhases();
      progress.hide();
    }
  };

  const clearPanels = (): void => {
    output.clear();
    sql.clear();
  };
  // Plain "Run" → bridge.runFile (REPL-on-one-command). SQL dry-run →
  // bridge.runModule (module compile + SQL capture). Same UI machinery.
  const fileMode = createFileMode(
    (code, onEvent) => bridge.runFile(code, onEvent), editor, output, busy, route, clearPanels);
  const sqlMode = createFileMode(
    (code, onEvent) => bridge.runModule(code, onEvent), editor, output, busy, route, clearPanels);
  const replMode = createReplMode(bridge, editor, output, busy, route, clearPanels);

  // Which output tabs a mode exposes:
  //   file / repl → Output only (no SQL is generated worth showing)
  //   sql         → SQL only, Output hidden until a real diagnostic appears
  const applyTabsForMode = (m: Mode): void => {
    const sqlOnly = m === "sql";
    tabSql.hidden = !sqlOnly;
    tabOutput.hidden = sqlOnly;
    setTab(sqlOnly ? "sql" : "output");
  };
  revealOutputOnError = (): void => {
    tabOutput.hidden = false;
    setTab("output");
  };

  // Swap the editor's contents to a mode's example, but only if the user
  // hasn't typed their own program (i.e. the buffer still holds the *other*
  // mode's pristine default or is empty). Never clobbers real edits.
  const KNOWN_DEFAULTS = new Set([DEFAULT_FILE.trim(), SQL_EXAMPLE.trim(), ""]);
  const maybeLoadExample = (m: Mode): void => {
    if (m === "repl") return; // REPL shares whatever's in the editor
    const want = m === "sql" ? SQL_EXAMPLE : DEFAULT_FILE;
    const cur = editor.getValue().trim();
    if (cur !== want.trim() && KNOWN_DEFAULTS.has(cur)) {
      editor.setValue(want);
    }
  };

  let mode: Mode = "file";
  applyTabsForMode(mode);

  // Cancel any in-flight bridge call. The worker is single-threaded JVM-in-JS, so
  // a pending compile/run can't be observed mid-flight — the only way to abort
  // is to terminate the worker (which `bridge.reset` does) and respawn. Any pending
  // promises reject with "worker terminated"; their try/finally blocks fire setBusy(false).
  const cancelInFlight = (reason: string): void => {
    if (!runBtn.disabled) return; // not busy → nothing to cancel
    bridge.reset();
    output.appendLine(reason, "system");
    busy(false);
  };

  const setMode = async (next: Mode) => {
    if (next === mode) return;
    // Switching modes while a previous run is still compiling/executing leaves
    // the user staring at a "Working…" spinner that's still tied to the old
    // mode's panels. Halt the worker so the new mode starts clean.
    cancelInFlight(`Cancelled: switched to ${next} mode.`);
    if (mode === "repl") await replMode.leave();
    mode = next;
    currentMode = next;
    // Mode switches reset both panes: a REPL transcript / dry-run SQL is
    // meaningless after toggling. Keeps the user from staring at stale output.
    clearPanels();
    for (const b of modeButtons) {
      const active = b.dataset["mode"] === mode;
      b.setAttribute("aria-selected", active ? "true" : "false");
    }
    replForm.hidden = mode !== "repl";
    // Drive CSS off `body[data-mode=...]`. REPL hides the editor entirely and
    // gives the output panel the full width — the input bar at the bottom is
    // the only way to send commands in that mode.
    document.body.dataset["mode"] = mode;
    // No editor in REPL mode → Run button has nothing meaningful to do.
    runBtn.hidden = mode === "repl";
    applyTabsForMode(mode);
    maybeLoadExample(mode);
    if (mode === "repl") {
      await replMode.enter();
      replInput.focus();
    } else {
      editor.focus();
    }
  };
  for (const b of modeButtons) {
    b.addEventListener("click", () => {
      const m = b.dataset["mode"];
      if (m === "file" || m === "sql" || m === "repl") void setMode(m);
    });
  }

  const runCurrent = (): void => {
    if (mode === "file") void fileMode.run();
    else if (mode === "sql") void sqlMode.run();
    else void replMode.runEditor();
  };
  runBtn.addEventListener("click", runCurrent);

  stopBtn.addEventListener("click", () => {
    bridge.reset();
    output.appendLine("Stopped. Worker restarted.", "system");
    if (mode === "repl") void replMode.enter();
    busy(false);
  });

  replInput.onSubmit((cmd) => {
    void replMode.submitLine(cmd);
  });

  shareBtn.addEventListener("click", async () => {
    const encoded = await encode(editor.getValue());
    const url = `${location.origin}${location.pathname}#${encoded}`;
    try {
      await navigator.clipboard.writeText(url);
      output.appendLine("Share URL copied to clipboard.", "system");
    } catch {
      output.appendLine(`Share URL: ${url}`, "system");
    }
    history.replaceState(null, "", `#${encoded}`);
  });

  document.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
      ev.preventDefault();
      runBtn.click();
    }
  });

  editor.focus();
}

void main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  const el = document.getElementById("output");
  if (el) {
    const line = document.createElement("div");
    line.className = "line error";
    line.textContent = `fatal: ${e instanceof Error ? e.message : String(e)}`;
    el.appendChild(line);
  }
});
