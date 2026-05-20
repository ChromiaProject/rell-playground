// SPA entry. Wires the editor, output panel, mode switch, and worker bridge.

import { createBridgeClient } from "./bridge/client.ts";
import { mountEditor } from "./editor/editor.ts";
import { OutputPanel } from "./output.ts";
import { createFileMode } from "./modes/file-mode.ts";
import { createReplMode } from "./modes/repl-mode.ts";
import { createProgressBar } from "./progress.ts";
import { createSqlPanel } from "./sql-panel.ts";
import type { StreamEvent } from "./bridge/client.ts";
import { decode, encode } from "./util/share.ts";

type Mode = "file" | "repl";

async function main(): Promise<void> {
  const outputEl = document.getElementById("output");
  const sqlEl = document.getElementById("sql");
  const editorEl = document.getElementById("editor");
  const runBtn = document.getElementById("run-btn") as HTMLButtonElement | null;
  const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement | null;
  const shareBtn = document.getElementById("share-btn") as HTMLButtonElement | null;
  const versionTag = document.getElementById("version-tag");
  const replForm = document.getElementById("repl-form") as HTMLFormElement | null;
  const replInput = document.getElementById("repl-input") as HTMLInputElement | null;
  const tabOutput = document.getElementById("tab-output") as HTMLButtonElement | null;
  const tabSql = document.getElementById("tab-sql") as HTMLButtonElement | null;
  const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".mode-switch button"));

  if (!outputEl || !sqlEl || !editorEl || !runBtn || !stopBtn || !shareBtn || !versionTag ||
      !replForm || !replInput || !tabOutput || !tabSql) {
    throw new Error("missing required DOM nodes");
  }

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

  // Worker is emitted alongside main.[hash].js as ./worker.js (no hash) by
  // build.ts; dev.ts intercepts the same path and transpiles src/bridge/worker.ts
  // on demand. Either way `./worker.js` resolves relative to the bundle URL.
  const workerUrl = new URL("./worker.js", import.meta.url);
  const bridge = createBridgeClient(workerUrl);

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
    output.appendEvent(e);
  };

  progress.show("Loading Rell runtime…");
  output.appendLine("Loading Rell runtime...", "system");
  await bridge.init(route);
  progress.hide();
  const version = await bridge.version();
  // Full string is something like:
  //   "rell: 0.15.4; postchain: 3.49.10; branch: master; commit: …; dirty: true"
  // Showing the whole thing in the toolbar pushes other actions off-screen.
  // Surface a compact "rell X · postchain Y" label and stash the full string
  // on title= so it's still discoverable on hover.
  const m = /rell:\s*([^;]+);\s*postchain:\s*([^;]+)/i.exec(version);
  const rell = m?.[1]?.trim();
  const postchain = m?.[2]?.trim();
  versionTag.textContent = rell && postchain ? `rell ${rell} · postchain ${postchain}` : version;
  versionTag.title = version;
  output.appendLine(`Ready — ${version}`, "system");

  const busy = (b: boolean): void => {
    runBtn.disabled = b;
    stopBtn.disabled = !b;
  };

  const fileMode = createFileMode(bridge, editor, output, busy);
  const replMode = createReplMode(bridge, editor, output, busy);

  let mode: Mode = "file";
  const setMode = async (next: Mode) => {
    if (next === mode) return;
    if (mode === "repl") await replMode.leave();
    mode = next;
    for (const b of modeButtons) {
      const active = b.dataset["mode"] === mode;
      b.setAttribute("aria-selected", active ? "true" : "false");
    }
    replForm.hidden = mode !== "repl";
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
      if (m === "file" || m === "repl") void setMode(m);
    });
  }

  runBtn.addEventListener("click", () => {
    void (mode === "file" ? fileMode.run() : replMode.runEditor());
  });

  stopBtn.addEventListener("click", () => {
    bridge.reset();
    output.appendLine("Stopped. Worker restarted.", "system");
    if (mode === "repl") void replMode.enter();
    busy(false);
  });

  replForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const cmd = replInput.value;
    replInput.value = "";
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
