// Minimal Monaco language definition for Rell. Adapted from rell-vscode's
// TextMate grammar; covers keywords, types, comments, strings, numbers,
// operators. Good enough for highlighting; not a full LSP.

import type * as Monaco from "monaco-editor";

const KEYWORDS = [
  "abstract", "and", "as", "break", "byte_array", "by", "continue", "create",
  "decimal", "delete", "else", "entity", "enum", "external", "false", "for",
  "function", "guard", "if", "import", "in", "include", "integer", "interface",
  "limit", "list", "log", "map", "module", "mount", "namespace", "not", "null",
  "object", "offset", "operation", "or", "override", "print", "query", "range",
  "return", "rowid", "set", "sort", "struct", "test", "text", "true", "tuple",
  "update", "val", "var", "virtual", "when", "where", "while",
];

const TYPES = [
  "boolean", "integer", "decimal", "text", "byte_array", "rowid", "json", "unit",
  "big_integer", "timestamp", "list", "set", "map", "range", "tuple", "gtv",
];

export function registerRellLanguage(monaco: typeof Monaco): void {
  if (monaco.languages.getLanguages().some((l) => l.id === "rell")) return;

  monaco.languages.register({ id: "rell", extensions: [".rell"], aliases: ["Rell"] });

  monaco.languages.setLanguageConfiguration("rell", {
    comments: { lineComment: "//", blockComment: ["/*", "*/"] },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"', notIn: ["string"] },
      { open: "'", close: "'", notIn: ["string"] },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });

  monaco.languages.setMonarchTokensProvider("rell", {
    defaultToken: "",
    tokenPostfix: ".rell",
    keywords: KEYWORDS,
    typeKeywords: TYPES,
    operators: [
      "=", ">", "<", "!", "~", "?", ":", "==", "<=", ">=", "!=", "&&", "||",
      "++", "--", "+", "-", "*", "/", "%", "&", "|", "^", "@", "@?", "@*", "@+",
    ],
    symbols: /[=><!~?:&|+\-*/^%@]+/,
    escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4})/,
    tokenizer: {
      root: [
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              "@typeKeywords": "type",
              "@keywords": "keyword",
              "@default": "identifier",
            },
          },
        ],
        { include: "@whitespace" },
        [/[{}()[\]]/, "@brackets"],
        [/@symbols/, { cases: { "@operators": "operator", "@default": "" } }],
        [/\d+\.\d+([eE][-+]?\d+)?/, "number.float"],
        [/0[xX][0-9a-fA-F]+/, "number.hex"],
        [/\d+/, "number"],
        [/[;,.]/, "delimiter"],
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/'([^'\\]|\\.)*$/, "string.invalid"],
        [/"/, "string", "@string_double"],
        [/'/, "string", "@string_single"],
      ],
      whitespace: [
        [/[ \t\r\n]+/, ""],
        [/\/\*/, "comment", "@comment"],
        [/\/\/.*$/, "comment"],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
      string_double: [
        [/[^\\"]+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/"/, "string", "@pop"],
      ],
      string_single: [
        [/[^\\']+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/'/, "string", "@pop"],
      ],
    },
  });
}
