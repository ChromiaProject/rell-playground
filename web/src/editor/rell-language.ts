// Minimal Monaco language definition for Rell. Keyword and literal sets follow
// the rell3 grammar (rell-base/frontend: Rell.g4 + parser/grammar.kt); types are
// the built-in library type names. Good enough for highlighting; not a full LSP.

import type * as Monaco from "monaco-editor";

const KEYWORDS = [
  "abstract", "and", "break", "class", "continue", "create", "delete", "else",
  "entity", "enum", "false", "for", "function", "guard", "if", "import", "in",
  "include", "index", "key", "limit", "module", "mutable", "namespace", "not",
  "null", "object", "offset", "operation", "or", "override", "query", "record",
  "return", "struct", "true", "update", "val", "var", "virtual", "when", "while",
];

const TYPES = [
  "boolean", "integer", "big_integer", "decimal", "text", "byte_array", "rowid",
  "range", "json", "gtv", "unit", "signer", "guid", "list", "set", "map",
  "timestamp", "name", "pubkey", "tuid",
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
      "=", ">", "<", "!", "~", "?", ":", "==", "<=", ">=", "!=", "===", "!==",
      "+=", "-=", "*=", "/=", "%=", "++", "--", "+", "-", "*", "/", "%", "&",
      "^", "->", "?.", "?:", "??", "!!", "@", "@?", "@*", "@+",
    ],
    symbols: /[=><!~?:&|+\-*/^%@]+/,
    escapes: /\\(?:[btnfr"'\\]|u[0-9A-Fa-f]{4})/,
    tokenizer: {
      root: [
        // Byte-array literals (x'ff00' / x"ff00") before identifiers, else `x` lexes as one.
        [/x'([0-9a-fA-F]{2})*'/, "number.hex"],
        [/x"([0-9a-fA-F]{2})*"/, "number.hex"],
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
        // Annotations (@log, @test, @mount(...)); at-expressions put `?`/`*`/`+`
        // or whitespace after `@`, so `@ident` is unambiguous.
        [/@[a-zA-Z_]\w*/, "annotation"],
        [/[{}()[\]]/, "@brackets"],
        [/\$/, "variable"],
        [/@symbols/, { cases: { "@operators": "operator", "@default": "" } }],
        [/\d*\.\d+([eE][-+]?\d+)?/, "number.float"],
        [/\d+[eE][-+]?\d+/, "number.float"],
        [/0[xX][0-9a-fA-F]+L?/, "number.hex"],
        [/\d+L?/, "number"],
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
