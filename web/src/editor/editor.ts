// Monaco setup. Loaded lazily because Monaco is ~2 MB; we only block the
// app shell, not the first paint.

import * as monaco from "monaco-editor";
import { registerRellLanguage } from "./rell-language.ts";

const STORAGE_KEY = "rell-playground:buffer";

export interface EditorHandle {
  getValue(): string;
  setValue(value: string): void;
  onChange(cb: (value: string) => void): void;
  focus(): void;
  dispose(): void;
}

export interface ReplInputHandle {
  getValue(): string;
  setValue(value: string): void;
  onSubmit(cb: (value: string) => void): void;
  focus(): void;
  dispose(): void;
}

// Plain "Run" example: pure functions + print. No database needed.
export const DEFAULT_FILE = `// One-file Rell program. Press Run.
function fact(n: integer): integer {
    if (n <= 1) return 1;
    return n * fact(n - 1);
}

print(fact(10));
`;

// "SQL dry-run" example: declares entities + a query that issues several
// reads. The browser has no Postgres, so nothing actually executes — but
// Rell compiles every @-expression to SQL and the "SQL" pane shows what
// postchain would issue (each at-expression below → its own SELECT).
//
// The file is loaded as module 'main' (root); the playground invokes
// 'query main()' if present.
//
// NOTE: write operations (create / update / delete) need a transaction
// runner the in-browser REPL doesn't provide, so this demo sticks to reads.
export const SQL_EXAMPLE = `// SQL dry-run. Press Run — see the "SQL" pane for generated statements.
// No database is attached; queries run against an empty result set.

entity user {
    key name: text;
    mutable age: integer;
}

entity post {
    key id: integer;
    index author: user;
    body: text;
}

// Each at-expression compiles to its own SELECT.
query main() {
    // Filter + sort + projection.
    val adults = user @* { .age >= 18 } ( @sort .name, .age );

    // Aggregate: count per author (GROUP BY).
    val post_counts = post @* {} ( @group .author.name, @sum 1 );

    return (adults = adults, post_counts = post_counts);
}
`;

export async function mountEditor(container: HTMLElement, initial?: string): Promise<EditorHandle> {
  // Vite-native Monaco workers: each `?worker` import bundles the matching language service
  // as a separate ESM worker chunk. Monaco picks one via the `label` from the language id.
  const editorWorker = (await import("monaco-editor/esm/vs/editor/editor.worker.js?worker")).default;
  const jsonWorker = (await import("monaco-editor/esm/vs/language/json/json.worker.js?worker")).default;
  const cssWorker = (await import("monaco-editor/esm/vs/language/css/css.worker.js?worker")).default;
  const htmlWorker = (await import("monaco-editor/esm/vs/language/html/html.worker.js?worker")).default;
  const tsWorker = (await import("monaco-editor/esm/vs/language/typescript/ts.worker.js?worker")).default;

  (self as unknown as { MonacoEnvironment?: { getWorker(moduleId: string, label: string): Worker } }).MonacoEnvironment = {
    getWorker(_moduleId: string, label: string): Worker {
      if (label === "json") return new jsonWorker();
      if (label === "css" || label === "scss" || label === "less") return new cssWorker();
      if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
      if (label === "typescript" || label === "javascript") return new tsWorker();
      return new editorWorker();
    },
  };

  registerRellLanguage(monaco);

  const startText = initial ?? localStorage.getItem(STORAGE_KEY) ?? DEFAULT_FILE;

  // Match Monaco's theme to the document's data-theme. The HTML head's inline
  // bootstrap sets it before this code runs, so the editor opens on the right
  // theme without a visible flash.
  const monacoTheme = (): string =>
    document.documentElement.getAttribute("data-theme") === "dark" ? "vs-dark" : "vs";

  const editor = monaco.editor.create(container, {
    value: startText,
    language: "rell",
    theme: monacoTheme(),
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 14,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 4,
    insertSpaces: true,
  });

  // Track theme switches from main.ts and update Monaco's global theme.
  // `monaco.editor.setTheme` is global (affects every editor on the page).
  document.addEventListener("themechange", () => {
    monaco.editor.setTheme(monacoTheme());
  });

  const listeners: Array<(value: string) => void> = [];
  editor.onDidChangeModelContent(() => {
    const v = editor.getValue();
    localStorage.setItem(STORAGE_KEY, v);
    for (const l of listeners) l(v);
  });

  return {
    getValue: () => editor.getValue(),
    setValue: (v: string) => editor.setValue(v),
    onChange: (cb) => listeners.push(cb),
    focus: () => editor.focus(),
    dispose: () => editor.dispose(),
  };
}

/**
 * Mount a single-line Rell editor inside `container` for use as the REPL prompt.
 * Pressing Enter fires the submit callback and clears the buffer; Shift+Enter
 * inserts a newline so users can paste multi-line snippets when needed.
 *
 * Assumes {@link mountEditor} has already run (Monaco environment + Rell language
 * are global state on `self.MonacoEnvironment` / `monaco.languages`).
 */
export function mountReplInput(container: HTMLElement): ReplInputHandle {
  const submitListeners: Array<(value: string) => void> = [];

  const monacoTheme = (): string =>
    document.documentElement.getAttribute("data-theme") === "dark" ? "vs-dark" : "vs";

  const editor = monaco.editor.create(container, {
    value: "",
    language: "rell",
    theme: monacoTheme(),
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 13,
    minimap: { enabled: false },
    lineNumbers: "off",
    glyphMargin: false,
    folding: false,
    lineDecorationsWidth: 0,
    lineNumbersMinChars: 0,
    overviewRulerLanes: 0,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    scrollBeyondLastLine: false,
    scrollbar: { vertical: "hidden", horizontal: "hidden", handleMouseWheel: false },
    wordWrap: "off",
    automaticLayout: true,
    contextmenu: false,
    renderLineHighlight: "none",
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    parameterHints: { enabled: false },
    tabSize: 4,
    insertSpaces: true,
    padding: { top: 4, bottom: 4 },
  });

  document.addEventListener("themechange", () => {
    monaco.editor.setTheme(monacoTheme());
  });

  // Enter submits; Shift+Enter inserts a newline (Monaco's default Enter binding).
  // `keybindingContext: "editorTextFocus && !suggestWidgetVisible"` matches the
  // standard Enter behaviour without stealing it when a completion is open.
  editor.addCommand(
    monaco.KeyCode.Enter,
    () => {
      const value = editor.getValue();
      if (!value.trim()) return;
      editor.setValue("");
      for (const l of submitListeners) l(value);
    },
    "editorTextFocus && !suggestWidgetVisible",
  );

  return {
    getValue: () => editor.getValue(),
    setValue: (v: string) => editor.setValue(v),
    onSubmit: (cb) => submitListeners.push(cb),
    focus: () => editor.focus(),
    dispose: () => editor.dispose(),
  };
}
