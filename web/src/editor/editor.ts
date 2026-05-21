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
  // Web-worker URLs for Monaco's language services. Monaco needs to know
  // where its workers live; we point at the JSON/CSS/etc workers shipped
  // by the monaco-editor package and bundled into ./public/monaco-workers
  // by scripts/build.ts.
  (self as unknown as { MonacoEnvironment?: { getWorkerUrl(_: string, label: string): string } }).MonacoEnvironment = {
    getWorkerUrl(_moduleId: string, label: string) {
      const map: Record<string, string> = {
        json: "./monaco-workers/json.worker.js",
        css: "./monaco-workers/css.worker.js",
        html: "./monaco-workers/html.worker.js",
        typescript: "./monaco-workers/ts.worker.js",
        javascript: "./monaco-workers/ts.worker.js",
      };
      return map[label] ?? "./monaco-workers/editor.worker.js";
    },
  };

  registerRellLanguage(monaco);

  const startText = initial ?? localStorage.getItem(STORAGE_KEY) ?? DEFAULT_FILE;

  const editor = monaco.editor.create(container, {
    value: startText,
    language: "rell",
    theme: "vs-dark",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 14,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 4,
    insertSpaces: true,
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
